import asyncio
import json
import pytest
from test_demo import client,account
from test_studio import project
from test_team import fake_model,wait_run
from services import studio
from services.leadership import LeadershipPlan,queue_feedback


def plan(order=('product','design','architect','engineer','qa')):
    return {'goal':'Deliver counter','summary':'Atlas coordinates delivery','stages':[{'role':role,'title':'阶段 '+role,'tasks':['具体任务 '+role],'delivery':'交付 '+role,'gatekeeper':'qa' if role in {'engineer','qa'} else 'leader'} for role in order]}


def test_plan_cannot_skip_independent_quality_gate():
    assert LeadershipPlan.model_validate(plan(('product','architect','design','engineer','qa')))
    invalid=plan();invalid['stages'][-1]['gatekeeper']='leader'
    with pytest.raises(ValueError):LeadershipPlan.model_validate(invalid)
    invalid=plan();invalid['stages'][-1]['role']='engineer'
    with pytest.raises(ValueError):LeadershipPlan.model_validate(invalid)
    with pytest.raises(ValueError):LeadershipPlan.model_validate(plan(('product','engineer','design','architect','qa')))


def test_legacy_configuration_gains_leader_without_resetting_custom_agents(client):
    from core.database import db_manager
    from models.studio import StudioAgentSettings
    from services.agent_profiles import defaults
    owner,_=account(client);uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    data=defaults();data['agents']=[a for a in data['agents'] if a['role']!='leader'];data['active'].pop('leader')
    data['agents'][3]['name']='专属工程师'
    async def insert():
        async with db_manager.session() as db:
            db.add(StudioAgentSettings(owner=str(uid),content=json.dumps(data),revision=7));await db.commit()
    client.portal.call(insert)
    result=client.get('/api/v1/studio/agents',headers=owner).json()
    assert result['revision']==7 and result['agents'][3]['name']=='专属工程师'
    assert result['active']['leader']=='default-leader'
    assert len(result['agents'])==6
    assert client.put('/api/v1/studio/agents',headers=owner,json={key:result[key] for key in ('agents','active','revision')}).status_code==200


def test_leader_controls_real_stage_order_and_dispatches(client,monkeypatch):
    owner,_=account(client);pid=project(client,owner,mode='team');calls=[]
    base=fake_model([])
    async def model(*args,**kwargs):
        stage=args[4];context=json.loads(args[5][-1]['content']);calls.append((stage,context))
        if stage=='team_leader':return plan(('product','architect','design','engineer','qa'))
        if stage in {'team_architect','team_design'}:return {'summary':stage,'items':['specific specification']}
        return await base(*args,**kwargs)
    async def build(*args,**kwargs):return {'ok':True,'artifact':{'js':'ok','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    assert run['status']=='done',run
    assert [stage for stage,_ in calls]==['team_leader','team_product','team_architect','team_design','team_code','team_qa']
    assert next(ctx for stage,ctx in calls if stage=='team_code')['assignment']['tasks']==['具体任务 engineer']
    assert run['result']['team']['qa']['verified'] is True
    assert {event.get('recipient') for event in run['events'] if event.get('role')=='leader' and event.get('kind')=='handoff'} >= {'product','design','architect','engineer','qa'}
    assert run['events'][-1]['role']=='leader'


def test_leader_consults_real_members_and_does_not_start_work_for_a_question(client,monkeypatch):
    owner,_=account(client);pid=project(client,owner,mode='team');calls=[]
    async def model(*args,**kwargs):
        stage=args[4];calls.append(stage)
        assert 'leader' in kwargs['agent_team']
        if stage=='chat_qa':return {'answer':'还没有本轮独立测试记录，建议验证添加任务。'}
        if len(calls)==1:return {'answer':'我先请 Pip 核实。','consult':[{'role':'qa','question':'验收状态如何？'}]}
        context=json.loads(args[5][-1]['content']);assert context['consultationResults'][0]['role']=='qa'
        return {'answer':'Pip 确认当前还没有验收结果，不能宣布完成。','action':'reply'}
    monkeypatch.setattr(studio,'model_call',model)
    response=client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=owner,json={'role':'leader','content':'现在验证过了吗？'})
    assert response.status_code==200,response.text
    assert response.json()['run_id'] is None and calls==['chat_leader','chat_qa','chat_leader']
    messages=client.get(f'/api/v1/studio/projects/{pid}/conversations?role=leader',headers=owner).json()['items']
    assert any(row['sender']=='leader' and row['recipient']=='qa' for row in messages)
    assert any(row['sender']=='qa' and row['recipient']=='leader' for row in messages)
    assert client.get(f'/api/v1/studio/projects/{pid}/runs',headers=owner).json()['items']==[]


def test_leader_starts_requested_implementation_and_viewer_cannot_dispatch(client,monkeypatch):
    owner,_=account(client);other,other_data=account(client);pid=project(client,owner,mode='team')
    async def model(*args,**kwargs):return {'answer':'我来安排添加筛选。','action':'implement','instruction':'为清单添加筛选，保留添加与删除。'}
    async def pause(*args):await asyncio.sleep(60)
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'execute',pause)
    body={'role':'leader','content':'帮我添加筛选'}
    assert client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=other,json=body).status_code==404
    assert client.post(f'/api/v1/studio/projects/{pid}/members',headers=owner,json={'email':other_data['email'],'role':'viewer'}).status_code==200
    assert client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=other,json=body).status_code==403
    response=client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=owner,json=body)
    assert response.status_code==200,response.text
    rid=response.json()['run_id'];assert rid and not response.json()['queued']
    assert client.get('/api/v1/studio/runs/'+rid,headers=owner).json()['agents']['leader']['role']=='leader'
    client.delete('/api/v1/studio/runs/'+rid,headers=owner)


def test_feedback_during_verification_replans_before_any_commit_and_keeps_draft(client,monkeypatch):
    owner,_=account(client);pid=project(client,owner,mode='team');uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    base=fake_model([]);calls=[];checks=[];run_ids=[]
    async def model(*args,**kwargs):
        run_ids.append(args[2]);calls.append((args[4],json.loads(args[5][-1]['content'])))
        return await base(*args,**kwargs)
    async def build(files,tests=None):
        checks.append(files)
        if len(checks)==1:assert await queue_feedback(uid,pid,'保留当前代码，增加完成筛选')==run_ids[-1]
        return {'ok':True,'artifact':{'js':'ok','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    assert run['status']=='done',run
    plans=[ctx for stage,ctx in calls if stage=='team_leader']
    assert len(plans)==2 and '增加完成筛选' in plans[-1]['request']
    assert plans[-1]['currentFiles'][0]['content']==checks[0][0]['content']
    assert len(client.get(f'/api/v1/af/projects/{pid}/versions',headers=owner).json()['items'])==1
    assert run['result']['team']['qa']['verified']


def test_new_feedback_replaces_waiting_checkpoint_and_resumes_same_run(client,monkeypatch):
    owner,_=account(client);pid=project(client,owner,mode='team')
    uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    base=fake_model([],confirm=True);plans=[]
    async def model(*args,**kwargs):
        context=json.loads(args[5][-1]['content'])
        if args[4]=='team_leader':plans.append(context)
        value=await base(*args,**kwargs)
        if len(plans)>1:value.pop('questions',None)
        return value
    async def build(*args,**kwargs):return {'ok':True,'artifact':{'js':'ok','css':''},'logs':[]}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'counter','mode':'team'}).json()['id']
    waiting=wait_run(client,owner,rid)
    assert waiting['status']=='awaiting_input' and waiting['result']['pending']['role']=='leader'
    old_id=waiting['result']['pending']['id']
    assert client.portal.call(queue_feedback,uid,pid,'无需继续提问，先做单人版')==rid
    finished=wait_run(client,owner,rid)
    assert finished['status']=='done',finished
    assert len(plans)==2 and '先做单人版' in plans[-1]['request']
    assert not finished['result'].get('pending')
    assert client.post('/api/v1/studio/runs/'+rid+'/decision',headers=owner,json={'checkpoint_id':old_id,'action':'approve'}).status_code==409


def test_save_boundary_reports_feedback_not_scheduled(client,monkeypatch):
    owner,_=account(client);pid=project(client,owner,mode='team')
    async def pause(*args):await asyncio.sleep(60)
    async def model(*args,**kwargs):return {'answer':'准备安排修改','action':'implement','instruction':'调整标题'}
    monkeypatch.setattr(studio,'execute',pause);monkeypatch.setattr(studio,'model_call',model)
    rid=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'counter','mode':'team'}).json()['id']
    async def stage(value):await studio.change(rid,status='running',stage=value)
    client.portal.call(stage,'save')
    response=client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=owner,json={'role':'leader','content':'修改标题'})
    assert response.status_code==409
    rows=client.get(f'/api/v1/studio/projects/{pid}/conversations?role=leader',headers=owner).json()['items']
    assert '暂未安排' in rows[-1]['content']
    client.portal.call(stage,'leader')
    assert client.delete('/api/v1/studio/runs/'+rid,headers=owner).status_code==200


def test_visual_editor_commit_does_not_require_a_studio_run(client,monkeypatch):
    async def commit(*args):return 3
    monkeypatch.setattr(studio,'_commit_result',commit)
    assert client.portal.call(studio.commit_result,'owner',1,2,{},'visual')==3
