import json
import pytest
from test_demo import client,account
from test_studio import project
from test_team import fake_model,wait_run
from services import studio


def setup_team(client,monkeypatch):
    owner,_=account(client);p=project(client,owner,mode="team");calls=[]
    monkeypatch.setattr(studio,'model_call',fake_model(calls,confirm=True))
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS independent test']}
    monkeypatch.setattr(studio,'runner_build',build)
    response=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'Build counter','mode':'team'})
    assert response.status_code==202,response.text
    return owner,p,response.json()['id'],calls


def decide(client,owner,run,action='approve',feedback=''):
    return client.post('/api/v1/studio/runs/'+run['id']+'/decision',headers=owner,json={'checkpoint_id':run['result']['pending']['id'],'action':action,'feedback':feedback})


@pytest.mark.parametrize('revision_action',['revise','approve'])
def test_checkpoints_block_work_survive_restart_and_apply_revision(client,monkeypatch,revision_action):
    owner,p,rid,calls=setup_team(client,monkeypatch)
    first=wait_run(client,owner,rid)
    assert first['status']=='awaiting_input'
    assert [stage for stage,_ in calls]==['team_product']
    client.portal.call(studio.recover)
    assert client.get('/api/v1/studio/runs/'+rid,headers=owner).json()['status']=='awaiting_input'
    assert client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'overlap'}).status_code==429
    other,_=account(client)
    assert decide(client,other,first).status_code==404
    assert decide(client,owner,first,revision_action,'Use a blue card').status_code==202
    revised=wait_run(client,owner,rid)
    assert revised['result']['pending']['id']!=first['result']['pending']['id']
    assert calls[1][1]['userDecisions'][0]['feedback']=='Use a blue card'
    assert calls[1][1]['request']=='Use a blue card'
    assert calls[1][1]['originalRequest']=='Build counter'
    assert decide(client,owner,first).status_code==409
    assert decide(client,owner,revised).status_code==202
    solution=wait_run(client,owner,rid)
    assert solution['result']['pending']['key']=='solution'
    assert not any(stage in {'team_code','team_qa'} for stage,_ in calls)
    assert client.get(f'/api/v1/af/projects/{p}',headers=owner).json()['project']['current_version']==0
    assert decide(client,owner,solution).status_code==202
    done=wait_run(client,owner,rid)
    assert done['status']=='done',done
    assert done['result']['team']['qa']['verified'] is True
    for stage,context in calls:
        if stage in {'team_code','team_qa'}:
            assert context['request']==context['approvedRequirements']['goal']
            assert context['history']==[]
            assert 'approvedSolution' in context
            assert context['userDecisions'][0]['feedback']=='Use a blue card'
    messages=client.get(f'/api/v1/studio/projects/{p}/conversations',headers=owner).json()['items']
    handoffs=[m for m in messages if m['kind']=='handoff']
    assert any(m['sender']=='product' and m['recipient']=='design' for m in handoffs)
    assert any(m['sender']=='engineer' and m['recipient']=='qa' for m in handoffs)
    starts=[m for m in messages if m['kind']=='tool_start']
    results=[m for m in messages if m['kind']=='tool_result']
    assert any(m['detail']['tool']=='runner.build_and_test' for m in starts)
    assert all(any(result['detail'].get('call_id')==start['detail']['call_id'] for result in results) for start in starts)
    designer=client.get(f'/api/v1/studio/projects/{p}/conversations?role=design',headers=owner).json()['items']
    assert all(m['sender']=='design' or m['recipient']=='design' for m in designer)
    assert any(m['sender']=='product' for m in designer)
    # A new edit must inherit the user's earlier decisions, not ask them again.
    next_calls=[]
    monkeypatch.setattr(studio,'model_call',fake_model(next_calls))
    next_id=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'Small follow-up','mode':'team'}).json()['id']
    assert wait_run(client,owner,next_id)['status']=='done'
    assert any('Use a blue card' in line for line in next_calls[0][1]['previousUserDecisions'])


def test_waiting_task_cancel_and_stale_project_cannot_resume(client,monkeypatch):
    owner,p,rid,_=setup_team(client,monkeypatch)
    pending=wait_run(client,owner,rid)
    assert client.post(f'/api/v1/af/projects/{p}/files',headers=owner,json={'files':[{'path':'App.jsx','content':'changed by another editor'}]}).status_code==200
    assert decide(client,owner,pending).status_code==409
    assert client.delete('/api/v1/studio/runs/'+rid,headers=owner).status_code==200
    assert decide(client,owner,pending).status_code==409
    assert wait_run(client,owner,rid)['status']=='cancelled'


def test_role_chat_is_durable_scoped_and_does_not_edit_files(client,monkeypatch):
    owner,p,rid,calls=setup_team(client,monkeypatch)
    pending=wait_run(client,owner,rid)
    pipeline=fake_model(calls,confirm=True)
    async def model(owner,pid,run,model,stage,messages,**kwargs):
        if stage=='chat_design':
            context=json.loads(messages[-1]['content'])
            assert context['question']=='What about blue?'
            return {'answer':'建议采用蓝色卡片，请在方案确认时提出修改。','plan':['保持清晰对比度']}
        return await pipeline(owner,pid,run,model,stage,messages,**kwargs)
    monkeypatch.setattr(studio,'model_call',model)
    root=f'/api/v1/studio/projects/{p}/conversations'
    assert client.post(root,headers=owner,json={'role':'design','content':'What about blue?'}).status_code==200
    items=client.get(root+'?role=design',headers=owner).json()['items']
    assert any(m['sender']=='user' and m['content']=='What about blue?' for m in items)
    assert any(m['sender']=='design' and '蓝色' in m['content'] for m in items)
    other,_=account(client)
    assert client.get(root,headers=other).status_code==404
    assert client.get(f'/api/v1/af/projects/{p}',headers=owner).json()['project']['current_version']==0
    assert decide(client,owner,pending).status_code==202
    solution=wait_run(client,owner,rid)
    design_context=next(ctx for stage,ctx in calls if stage=='team_design')
    assert any(m['content']=='What about blue?' for m in design_context['userDiscussions'])
    assert client.delete('/api/v1/studio/runs/'+rid,headers=owner).status_code==200
