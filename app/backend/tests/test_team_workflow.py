import pytest
from test_demo import client,account
from test_studio import project
from test_team import fake_model,wait_run
from test_agent_collaboration import setup_team
from services import studio,team_workflow as workflow


@pytest.fixture(autouse=True)
def quota(client):
    middleware=client.app.middleware_stack
    while middleware:
        if hasattr(middleware,'auth_requests'):middleware.auth_requests.clear()
        middleware=getattr(middleware,'app',None)


def test_strategy_changes_are_versioned_private_and_do_not_reset_delivery(client,monkeypatch):
    owner,pid,rid,_=setup_team(client,monkeypatch)
    run=wait_run(client,owner,rid);board=run['result']['workflow']
    assert [c['id'] for c in board['columns']]==['backlog','ready','doing','review','verifying','acceptance','done']
    assert board['cards'][0]['blocked'] and board['cards'][0]['state']=='review'
    assert all(c['owner'] and c['tasks'] and c['output'] for c in board['cards'])
    request={**board['policy'],'priority':'urgent','sla_minutes':20,'max_repairs':30,'revision':board['revision'],'reason':'集中处理已确认的阻塞'}
    endpoint='/api/v1/studio/runs/'+rid+'/strategy'
    other,_=account(client)
    assert client.patch(endpoint,headers=other,json=request).status_code==404
    assert client.patch(endpoint,json=request).status_code==401
    saved=client.patch(endpoint,headers=owner,json=request)
    assert saved.status_code==200 and saved.json()['revision']==1
    assert client.patch(endpoint,headers=owner,json=request).status_code==409
    fresh=client.get('/api/v1/studio/runs/'+rid,headers=owner).json()
    assert fresh['result']['team']==run['result']['team']
    assert fresh['result']['workflow']['policy']['max_repairs']==30
    assert fresh['result']['pending']==run['result']['pending']
    assert [c['state'] for c in fresh['result']['workflow']['cards']]==[c['state'] for c in board['cards']]
    assert fresh['result']['workflow']['policy_history'][0]['reason']==request['reason']
    assert all(c['lane']=='加急' for c in fresh['result']['workflow']['cards'])
    for extra in ({'wip':0},{'min_tests':0},{'max_repairs':31},{'states':['anything']},{'reason':''}):
        assert client.patch(endpoint,headers=owner,json={**request,'revision':1,**extra}).status_code==422
    client.delete('/api/v1/studio/runs/'+rid,headers=owner)
    assert client.patch(endpoint,headers=owner,json={**request,'revision':1}).status_code==409


def test_leader_strategy_chat_uses_policy_without_implementation_replan(client,monkeypatch):
    owner,pid,rid,calls=setup_team(client,monkeypatch)
    before=wait_run(client,owner,rid)
    async def reply(*args,**kwargs):
        assert args[4]=='chat_leader'
        return {'answer':'缩短 SLA 观察窗口','action':'strategy','strategy':{'sla_minutes':8}}
    monkeypatch.setattr(studio,'model_call',reply)
    response=client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=owner,json={'role':'leader','content':'只把本轮 SLA 调整到8分钟，不改需求'})
    assert response.status_code==200 and response.json()['run_id']==rid
    after=client.get('/api/v1/studio/runs/'+rid,headers=owner).json()
    assert after['result']['workflow']['policy']['sla_minutes']==8
    assert after['result']['team']==before['result']['team']
    assert after['status']=='awaiting_input'
    client.delete('/api/v1/studio/runs/'+rid,headers=owner)


@pytest.mark.parametrize('policy', [{'max_repairs':0},{'min_tests':4,'max_repairs':0}])
def test_strategy_quality_limits_are_enforced_without_leader_repair_calls(client,monkeypatch,policy):
    owner,_=account(client);pid=project(client,owner,mode='team');calls=[];leaders=[]
    base=fake_model(calls)
    async def model(*args,**kwargs):
        result=await base(*args,**kwargs)
        if args[4]=='team_leader':leaders.append(args[4]);result['policy']=policy
        return result
    async def build(*args,**kwargs):
        return {'ok':bool(policy.get('min_tests')),'artifact':{'js':'app','css':''},'logs':[],'error':'真实构建失败'}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'mode':'team','instruction':'counter','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    assert run['status']=='error',run
    assert len(leaders)==1
    assert not any(stage=='team_repair' for stage,_ in calls)
    assert client.get(f'/api/v1/af/projects/{pid}',headers=owner).json()['project']['current_version']==0
    assert any(c['blocked'] for c in run['result']['workflow']['cards'])


def test_cards_cannot_skip_dependencies_and_scope_revisions_archive_unique_ids(client,monkeypatch):
    owner,pid,rid,_=setup_team(client,monkeypatch)
    before=wait_run(client,owner,rid)
    with pytest.raises(ValueError):client.portal.call(workflow.move,rid,'qa','doing')
    from services.leadership import queue_feedback
    uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    client.portal.call(queue_feedback,uid,pid,'修改范围，仍需确认使用方式')
    after=wait_run(client,owner,rid)
    old_ids={c['id'] for c in before['result']['workflow']['cards']}
    assert not old_ids & {c['id'] for c in after['result']['workflow']['cards']}
    client.delete('/api/v1/studio/runs/'+rid,headers=owner)


def test_leader_display_first_preserves_custom_roster_and_role_assignment(client):
    owner,_=account(client);url='/api/v1/studio/agents'
    config=client.get(url,headers=owner).json()
    assert config['teams'][0]['member_ids'][0]=='default-leader'
    config['teams'][0]['member_ids']=['default-qa','default-engineer','default-leader','default-product']
    data={key:config[key] for key in ('agents','teams','active','active_team_id','revision')}
    saved=client.put(url,headers=owner,json=data).json()
    assert saved['teams'][0]['member_ids']==['default-leader','default-qa','default-engineer','default-product']
