import asyncio
import json
import time

import pytest
from test_demo import client, account
from test_studio import project
from services import studio


def wait_run(client, owner, run_id):
    for _ in range(150):
        run = client.get('/api/v1/studio/runs/'+run_id, headers=owner).json()
        if run['status'] not in studio.ACTIVE:
            return run
        time.sleep(.02)
    pytest.fail('Team run did not complete')


def fake_model(calls, reject=False, confirm=False, max_repairs=2):
    question={'kind':'user_requested','question':'用户要求先确认部署范围','options':[{'label':'自己使用','description':'当前用户使用'},{'label':'团队使用','description':'团队共享'}],'recommended':0,'reason':'用户明确要求先确认'}
    async def call(owner, project_id, run_id, model, stage, messages, **kwargs):
        context = json.loads(messages[-1]['content'])
        if stage == 'team_leader':
            if 'failure' in context:return {'summary':'Arrange repair','tasks':['Fix the reported issue']}
            return {'goal':'counter','policy':{'max_repairs':max_repairs},'summary':'Coordinate counter delivery','stages':[{'role':role,'title':role,'tasks':['Implement counter scope'],'delivery':'verified output','gatekeeper':'qa' if role in {'engineer','qa'} else 'leader'} for role in ['product','design','architect','engineer','qa']]}
        calls.append((stage, context))
        if stage == 'team_product':
            return {'goal':'counter','tasks':['Build counter'],'acceptance':['increment works'],'questions':[question] if confirm else []}
        if stage in {'team_design','team_architect'}:
            assert context['handoffs']['product']['goal'] == 'counter'
            if stage == 'team_architect':
                assert 'design' in context['handoffs']
            return {'summary':stage,'items':['Keep existing CSS'],'questions':[dict(question,question='用户要求先确认设计范围')] if confirm and stage=='team_design' else []}
        if stage in {'team_code','team_repair'}:
            assert all(r in context['handoffs'] for r in ['product','design','architect'])
            return {'summary':'counter implemented','files':[{'path':'App.jsx','content':'export default function App(){return <h1>counter</h1>}'}], 'tests':[]}
        assert stage == 'team_qa'
        assert 'engineer' in context['handoffs']
        assert context['currentFiles'][0]['path'] == 'App.jsx'
        return {'approved':not reject,'summary':'Fix increment' if reject else 'Reviewed', 'issues':['Increment is missing'] if reject else [],'tests':[{'action':'visible','selector':'h1'},{'action':'text','selector':'h1','value':'counter'}]}
    return call


def test_team_handoffs_and_independent_test_failure_repairs_before_commit(client, monkeypatch):
    owner,_ = account(client)
    p = project(client,owner,mode="team")
    calls,checks = [],[]
    monkeypatch.setattr(studio,'model_call',fake_model(calls))
    async def build(files,tests=None):
        checks.append(tests)
        if len(checks)==2:
            return {'ok':False,'error':'Independent click failed'}
        return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'runner_build',build)
    response = client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'Build counter','mode':'team','interactive':False})
    assert response.status_code==202
    run_id=response.json()['id']
    run=wait_run(client,owner,run_id)
    assert run['status']=='done',run
    assert run['mode']=='team'
    assert [s for s,_ in calls]==['team_product','team_design','team_architect','team_code','team_qa','team_repair','team_qa']
    assert 'Independent click failed' in calls[5][1]['previousError']
    assert checks[0]==[] and len(checks[1])==2 and len(checks)==4
    assert run['result']['team']['qa']['verified'] is True
    assert 'adjustments' not in run['result']['team']['leader']
    assert calls[5][1]['repairRequest']['items']==['Independent click failed']
    assert run['result']['workflow']['metrics']['rework_count']==1
    assert all(c['state']=='done' for c in run['result']['workflow']['cards'])
    assert set(run['result']['team'])=={'leader','product','design','architect','engineer','qa'}
    assert len(client.get(f'/api/v1/af/projects/{p}/versions',headers=owner).json()['items'])==1
    restored=client.get('/api/v1/studio/runs/'+run_id,headers=owner).json()
    assert restored['result']['team']==run['result']['team']
    assert len([e for e in restored['events'] if e.get('output')])>=5


def test_team_review_rejection_never_commits_and_retry_keeps_mode(client,monkeypatch):
    owner,_=account(client);p=project(client,owner,mode="team");calls=[]
    monkeypatch.setattr(studio,'model_call',fake_model(calls,reject=True))
    async def build(files,tests=None):
        return {'ok':True,'artifact':{'js':'valid syntax','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'runner_build',build)
    run_id=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'Build counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,run_id)
    assert run['status']=='error'
    assert run['result']['draft_files'][0]['path']=='App.jsx'
    assert '达到修复上限（2 次）' in run['error']
    assert [stage for stage,_ in calls].count('team_qa')==3
    assert client.get(f'/api/v1/af/projects/{p}',headers=owner).json()['project']['current_version']==0
    async def paused(*args,**kwargs):
        await asyncio.sleep(60)
    monkeypatch.setattr(studio,'model_call',paused)
    retried=client.post('/api/v1/studio/runs/'+run_id+'/retry',headers=owner)
    assert retried.status_code==202
    next_id=retried.json()['id']
    assert client.get('/api/v1/studio/runs/'+next_id,headers=owner).json()['mode']=='team'
    assert client.delete('/api/v1/studio/runs/'+next_id,headers=owner).status_code==200
    assert wait_run(client,owner,next_id)['status']=='cancelled'
    assert client.get(f'/api/v1/af/projects/{p}/versions',headers=owner).json()['items']==[]


@pytest.mark.parametrize('mode',['build','team'])
def test_unverified_files_are_durable_before_build_but_never_become_a_version(client,monkeypatch,mode):
    from sqlalchemy import select
    owner,_=account(client); p=project(client,owner,mode=mode); calls=[]; inspected=[]
    team_model=fake_model(calls)
    async def model(*args,**kwargs):
        if mode=='team':return await team_model(*args,**kwargs)
        if args[4]=='plan':return {'goal':'counter','tasks':['counter']}
        return {'files':[{'path':'App.jsx','content':'export default function App(){return <h1>draft</h1>}'}],'tests':[]}
    async def build(files,tests=None):
        async with studio.db_manager.session() as db:
            record=(await db.execute(select(studio.StudioRun).where(studio.StudioRun.project_id==p))).scalar_one()
            assert record.status=='running'
            assert json.loads(record.result)['draft_files']==files
            inspected.append(True)
        return {'ok':False,'error':'test assertion failed','logs':[]}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    run_id=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':mode,'interactive':False}).json()['id']
    run=wait_run(client,owner,run_id)
    assert run['status']=='error' and len(inspected)==3
    assert run['result']['draft_files'][0]['path']=='App.jsx'
    assert client.get(f'/api/v1/af/projects/{p}/files',headers=owner).json()['items']==[]
    assert client.get(f'/api/v1/af/projects/{p}/versions',headers=owner).json()['items']==[]
    other,_=account(client)
    assert client.get('/api/v1/studio/runs/'+run_id,headers=other).status_code==404


def test_team_applies_targeted_edits_then_runs_both_quality_gates(client,monkeypatch):
    owner,_=account(client);p=project(client,owner,mode='team');calls=[];checks=[]
    client.post(f'/api/v1/af/projects/{p}/files',headers=owner,json={'files':[{'path':'App.jsx','content':'export default function App(){return <h1>old</h1>}'}]})
    base=fake_model(calls)
    async def model(*args,**kwargs):
        if args[4]=='team_code':return {'summary':'targeted edit','edits':[{'path':'App.jsx','old':'<h1>old</h1>','new':'<h1>counter</h1>'}],'tests':[]}
        return await base(*args,**kwargs)
    async def build(files,tests=None):
        checks.append(tests)
        assert '<h1>counter</h1>' in files[0]['content']
        return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    run_id=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'change title','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,run_id)
    assert run['status']=='done',run
    assert len(checks)==2 and run['result']['team']['qa']['verified']
    assert run['result']['team']['engineer']['items']==['App.jsx']


def test_exhausted_output_strategy_stops_without_three_identical_code_attempts(client,monkeypatch):
    owner,_=account(client);p=project(client,owner,mode='team');calls=[];attempts=[]
    base=fake_model(calls)
    async def model(*args,**kwargs):
        if args[4] in {'team_code','team_repair'}:
            attempts.append(args[4]);raise studio.OutputLimitError('output could not complete')
        return await base(*args,**kwargs)
    monkeypatch.setattr(studio,'model_call',model)
    run_id=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'build','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,run_id)
    assert run['status']=='error' and attempts==['team_code']
    assert set(run['result']['team'])=={'leader','product','design','architect'}


@pytest.mark.parametrize('invalid',[
    {'approved':'true','summary':'ok','issues':[],'tests':[]},
    {'approved':True,'summary':'ok','issues':['still broken'],'tests':[{'action':'visible','selector':'h1'}]*2},
    {'approved':True,'summary':'ok','issues':[],'tests':[{'action':'execute','selector':'h1'}]*2},
    {'approved':True,'summary':'ok','issues':[],'tests':[{'action':'text','selector':'h1'}]*2},
])
def test_team_rejects_invalid_qa_protocol(invalid):
    from services.team import validate_review
    with pytest.raises(ValueError):
        validate_review(invalid)


def test_review_supports_disabled_and_real_reload_without_selectors():
    from services.team import validate_review
    review = validate_review({'approved':True,'summary':'source reviewed','issues':[], 'tests':[
        {'action':'disabled','selector':'button'}, {'action':'reload'},
        {'action':'clear_storage'}, {'action':'reload'}, {'action':'hidden','selector':'.habit'}]})
    assert len(review['tests']) == 5


def test_invalid_interaction_is_corrected_without_code_repair_and_still_requires_qa(client, monkeypatch):
    owner,_=account(client);p=project(client,owner,mode='team');calls=[];checks=[];diagnoses=[]
    base=fake_model(calls)
    corrected=[{'action':'disabled','selector':'button'},{'action':'text','selector':'h1','value':'counter'}]
    async def model(*args,**kwargs):
        if args[4]=='team_test_diagnosis':
            diagnoses.append(json.loads(args[5][-1]['content']))
            return {'verdict':'test_defect','reason':'empty input intentionally disables submit in source and requirements','tests':corrected}
        return await base(*args,**kwargs)
    async def build(files,tests=None):
        checks.append((files,tests))
        if len(checks)==1:return {'ok':False,'error':'button disabled','failure':{'kind':'interaction','action':'click','disabled':True},'logs':[]}
        return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    assert run['status']=='done',run
    assert len(diagnoses)==1 and len(checks)==3
    assert checks[0][0]==checks[1][0]==checks[2][0]
    assert checks[1][1]==corrected
    assert not any(s=='team_repair' for s,_ in calls)
    assert run['result']['team']['engineer']['test_corrections'][0]['after']==corrected
    assert run['result']['team']['qa']['verified'] is True
    assert run['result']['workflow']['metrics']['rework_count']==0


@pytest.mark.parametrize('verdict',['application_defect','test_defect'])
def test_test_diagnosis_never_bypasses_failed_execution_or_loops(client,monkeypatch,verdict):
    owner,_=account(client);p=project(client,owner,mode='team');calls=[];diagnoses=[]
    base=fake_model(calls)
    async def model(*args,**kwargs):
        if args[4]=='team_test_diagnosis':
            diagnoses.append(True)
            return {'verdict':verdict,'reason':'specific source evidence','tests':[{'action':'visible','selector':'h1'},{'action':'text','selector':'h1','value':'counter'}]}
        return await base(*args,**kwargs)
    async def build(files,tests=None):
        return {'ok':False,'error':'interaction still fails','failure':{'kind':'interaction','action':'click'}}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    assert run['status']=='error',run
    assert len(diagnoses)==1
    assert [s for s,_ in calls].count('team_repair')==2
    assert client.get(f'/api/v1/af/projects/{p}/versions',headers=owner).json()['items']==[]


@pytest.mark.parametrize('preference',[False,True])
def test_clear_request_and_routine_preferences_do_not_block(client,monkeypatch,preference):
    owner,_=account(client); p=project(client,owner,mode='team'); calls=[]
    base=fake_model(calls)
    async def model(*args,**kwargs):
        output=await base(*args,**kwargs)
        if preference and args[4] in {'team_product','team_design','team_architect'}:
            output['questions']=[{'kind':'preference','question':'先排查依赖还是初始化？','options':[{'label':'依赖','description':'先查构建'},{'label':'初始化','description':'先查启动'}],'recommended':0,'reason':'工程师可以自行决定'}]
        return output
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'Build counter','mode':'team'}).json()['id']
    done=wait_run(client,owner,rid)
    assert done['status']=='done',done
    assert not any(e.get('kind')=='confirmation' for e in done['events'])


def test_retry_resumes_draft_and_approved_handoffs(client,monkeypatch):
    owner,_=account(client); p=project(client,owner,mode='team'); calls=[]
    monkeypatch.setattr(studio,'model_call',fake_model(calls))
    async def fail(files,tests=None):return {'ok':False,'error':'specific failing assertion'}
    monkeypatch.setattr(studio,'runner_build',fail)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'Build counter','mode':'team'}).json()['id']
    failed=wait_run(client,owner,rid)
    assert failed['status']=='error'
    assert failed['result']['draft_files'][0]['path']=='App.jsx'
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'runner_build',build);calls.clear()
    next_id=client.post('/api/v1/studio/runs/'+rid+'/retry',headers=owner).json()['id']
    done=wait_run(client,owner,next_id)
    assert done['status']=='done',done
    assert [stage for stage,_ in calls]==['team_qa']
    assert calls[0][1]['currentFiles'][0]['path']=='App.jsx'
    assert done['result']['team']['engineer']==failed['result']['team']['engineer']


def test_malformed_handoff_is_repaired_and_nine_tasks_are_supported(client,monkeypatch):
    owner,_=account(client);p=project(client,owner,mode='team');calls=[];product_calls=[]
    base=fake_model(calls)
    async def model(*args,**kwargs):
        if args[4]=='team_product':
            context=json.loads(args[5][-1]['content']);product_calls.append(context)
            if len(product_calls)==1:return {'goal':'counter'}
            assert context['previousOutput']=={'goal':'counter'}
            return {'goal':'counter','tasks':['task '+str(i) for i in range(9)],'acceptance':['increment works']}
        return await base(*args,**kwargs)
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'Build counter','mode':'team'}).json()['id']
    done=wait_run(client,owner,rid)
    assert done['status']=='done',done
    assert len(product_calls)==2
    assert len(done['result']['team']['product']['tasks'])==9
