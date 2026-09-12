import asyncio
import json
import pytest
from test_demo import client, account
from services.studio import merge_patch


def test_model_json_accepts_fences_but_never_discards_a_second_object():
    from services.studio import parse_model_json
    assert parse_model_json('```json\n{"files": []}\n```')=={'files':[]}
    for raw in ['{"files": []}\n{"files": [1]}','[]','invalid']:
        with pytest.raises(ValueError):parse_model_json(raw)


def test_incremental_patch_preserves_unchanged_files():
    base=[{'path':'App.jsx','content':'old','language':'jsx'},{'path':'keep.css','content':'keep','language':'css'}]
    result=merge_patch(base,{'files':[{'path':'App.jsx','content':'new'}]})
    assert {f['path']:f['content'] for f in result}=={'App.jsx':'new','keep.css':'keep'}
    with pytest.raises(ValueError):merge_patch(base,{'files':[{'path':'../escape.jsx','content':'bad'}]})
    with pytest.raises(ValueError):merge_patch(base,{'files':[],'delete':['App.jsx']})


def project(client,headers,mode="build"):
    r=client.post('/api/v1/af/projects',headers=headers,json={'name':'studio test','agent_mode':mode})
    assert r.status_code==200
    return r.json()['project']['id']


def test_model_format_retry_counts_both_requests(client,monkeypatch):
    from types import SimpleNamespace
    from services import studio
    calls=[]
    async def create(**kwargs):
        calls.append(kwargs)
        content='{"goal":"counter"}\n{"tasks":[]}' if len(calls)==1 else '{"goal":"counter","tasks":["implement"]}'
        return SimpleNamespace(usage=SimpleNamespace(prompt_tokens=10,completion_tokens=20),choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=content))])
    class FakeService:
        def __init__(self):self.client=self
        def _require_ai_client(self):return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        async def close(self):pass
    monkeypatch.setattr(studio,'AIHubService',FakeService)
    async def event(*args,**kwargs):pass
    monkeypatch.setattr(studio,'event',event)
    async def execute():
        result=await studio.model_call('format-test',1,'format-run','deepseek-flash','plan',[{'role':'user','content':'counter'}])
        from sqlalchemy import select
        async with studio.db_manager.session() as db:
            rows=(await db.execute(select(studio.StudioUsage).where(studio.StudioUsage.run_id=='format-run'))).scalars().all()
            assert len(rows)==2
        return result
    assert client.portal.call(execute)['tasks']==['implement']
    assert len(calls)==2 and '不是有效' in calls[1]['messages'][-1]['content']


def test_nested_entry_gets_wrapper_without_moving_relative_imports():
    base = [{'path':'src/App.jsx','content':'import Button from "./Button"; export default Button'}, {'path':'src/Button.jsx','content':'export default function Button(){return <button>ok</button>}'}]
    merged = {f['path']:f['content'] for f in merge_patch([], {'files':base})}
    assert merged['src/App.jsx'] == base[0]['content']
    assert merged['App.jsx'] == 'export {default} from "./src/App.jsx";'
    # An existing root entry is authoritative and must never be replaced.
    result = merge_patch([{'path':'App.jsx','content':'existing'}], {'files':base})
    assert next(f for f in result if f['path']=='App.jsx')['content']=='existing'


def test_generated_app_auth_and_data_isolation(client):
    owner,_=account(client);other,_=account(client)
    a=project(client,owner);b=project(client,owner)
    config={'enabled':True,'collections':{'private_rows':'private','shared_rows':'shared'}}
    assert client.put(f'/api/v1/studio/projects/{a}/cloud',headers=other,json=config).status_code==404
    for p in [a,b]:assert client.put(f'/api/v1/studio/projects/{p}/cloud',headers=owner,json=config).status_code==200
    slug=client.get(f'/api/v1/studio/projects/{a}/cloud',headers=owner).json()['slug']
    other_slug=client.get(f'/api/v1/studio/projects/{b}/cloud',headers=owner).json()['slug']
    root='/api/v1/cloud/'+slug
    users=[]
    for email in ['one@example.test','two@example.test']:
        r=client.post(root+'/register',json={'email':email,'password':'TestPassword123!'})
        assert r.status_code==200
        users.append({'X-App-Token':r.json()['access_token']})
    assert client.get(root+'/me',headers={'X-App-Token':owner['X-AtomForge-Token']}).status_code==401
    assert client.get('/api/v1/cloud/'+other_slug+'/me',headers=users[0]).status_code==401
    r=client.post(root+'/data/private_rows',headers=users[0],json={'data':{'title':'secret'}})
    assert r.status_code==200
    row=r.json()['item']['id']
    assert client.get(root+'/data/private_rows',headers=users[1]).json()['items']==[]
    assert client.put(root+'/data/private_rows/'+row,headers=users[1],json={'data':{}}).status_code==404
    assert client.delete(root+'/data/private_rows/'+row,headers=users[1]).status_code==404
    assert client.post(root+'/data/unknown',headers=users[0],json={'data':{}}).status_code==403
    assert client.post(root+'/data/shared_rows',headers=users[0],json={'data':{'title':'shared'}}).status_code==200
    assert len(client.get(root+'/data/shared_rows',headers=users[1]).json()['items'])==1
    assert client.post(root+'/ai/chat',headers=users[0],json={'prompt':'test'}).status_code==403
    client.put(f'/api/v1/studio/projects/{a}/cloud',headers=owner,json={**config,'enabled':False})
    assert client.get(root+'/me',headers=users[0]).status_code==404


def test_member_roles_and_revocation(client):
    owner,_=account(client);member,payload=account(client);p=project(client,owner)
    root=f'/api/v1/studio/projects/{p}'
    assert client.post(root+'/members',headers=owner,json={'email':payload['email'],'role':'viewer'}).status_code==200
    assert client.get(f'/api/v1/af/projects/{p}',headers=member).status_code==200
    assert any(x['id']==p for x in client.get('/api/v1/af/projects',headers=member).json()['items'])
    assert client.post(root+'/runs',headers=member,json={'instruction':'test'}).status_code==403
    assert client.put(root+'/cloud',headers=member,json={'enabled':True}).status_code==403
    assert client.post(root+'/members',headers=owner,json={'email':payload['email'],'role':'editor'}).status_code==200
    assert client.post(f'/api/v1/af/projects/{p}/files',headers=member,json={'files':[{'path':'App.jsx','content':'test'}]}).status_code==200
    assert client.patch(f'/api/v1/af/projects/{p}',headers=member,json={'is_public':True}).status_code==403
    assert client.delete(f'/api/v1/af/projects/{p}',headers=member).status_code==403
    mid=client.get(root+'/members',headers=owner).json()['items'][0]['id']
    assert client.delete(root+'/members/'+str(mid),headers=owner).status_code==200
    assert client.get(f'/api/v1/af/projects/{p}',headers=member).status_code==404


def test_pipeline_repairs_and_saves_after_validation(client,monkeypatch):
    from services import studio
    owner,_=account(client);p=project(client,owner)
    attempts=[]
    async def model(owner,project_id,run_id,model,stage,messages,max_tokens=12000,**kwargs):
        if stage=='plan':return {'goal':'counter','tasks':['counter'],'acceptance':['visible']}
        attempts.append(stage)
        return {'files':[{'path':'App.jsx','content':'export default function App(){return <h1>ok</h1>}'}],'summary':'Done','tests':[]}
    checks=[]
    async def build(files,tests=None):
        checks.append(files)
        if len(checks)==1:return {'ok':False,'error':'simulated runtime error'}
        return {'ok':True,'artifact':{'js':'compiled','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    r=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'make counter'})
    assert r.status_code==202
    run_id=r.json()['id']
    import time
    for _ in range(100):
        result=client.get('/api/v1/studio/runs/'+run_id,headers=owner).json()
        if result['status'] not in studio.ACTIVE:break
        time.sleep(.02)
    assert result['status']=='done',result
    summary = [entry for entry in result['events'] if entry.get('kind') == 'summary']
    assert summary and summary[-1]['role'] == 'engineer'
    assert 'Done' in summary[-1]['message'] and '已保存为 v1' in summary[-1]['message']
    assert attempts==['code','repair']
    assert len(client.get(f'/api/v1/af/projects/{p}/versions',headers=owner).json()['items'])==1
    other,_=account(client)
    assert client.get('/api/v1/studio/runs/'+run_id,headers=other).status_code==404
    assert client.post(f'/api/v1/studio/projects/{p}/release',headers=owner).status_code==200
    release=client.get(f'/api/v1/studio/projects/{p}/release',headers=owner).json()['release']
    public='/api/v1/studio/published/'+release['slug']
    assert client.get(public).json()['artifact']['js']=='compiled'
    client.post(f'/api/v1/af/projects/{p}/files',headers=owner,json={'files':[{'path':'App.jsx','content':'changed'}]})
    assert client.get(public).json()['version']==1
    assert client.get(f'/api/v1/studio/projects/{p}/artifact',headers=owner).json()['artifact'] is None
    assert client.post(f'/api/v1/studio/projects/{p}/release',headers=owner).status_code==409
    client.delete(f'/api/v1/studio/projects/{p}/release',headers=owner)
    assert client.get(public).status_code==404


def test_candidates_require_selection_and_cannot_be_adopted_twice(client,monkeypatch):
    from services import studio
    owner,_=account(client);p=project(client,owner)
    async def model(owner,project_id,run_id,model,stage,messages,max_tokens=12000,**kwargs):
        await asyncio.sleep(.02)
        if stage=='plan':return {'tasks':['build']}
        return {'summary':model,'files':[{'path':'App.jsx','content':model}],'tests':[]}
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':files[0]['content'],'css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    run=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'compare','mode':'race'}).json()['id']
    import time
    for _ in range(100):
        state=client.get('/api/v1/studio/runs/'+run,headers=owner).json()
        if state['status']=='review':break
        time.sleep(.02)
    assert state['status']=='review',state
    assert len(state['result']['candidates'])==2
    assert client.get(f'/api/v1/af/projects/{p}',headers=owner).json()['project']['current_version']==0
    assert client.post('/api/v1/studio/runs/'+run+'/choose',headers=owner,json={'index':1}).status_code==200
    assert client.post('/api/v1/studio/runs/'+run+'/choose',headers=owner,json={'index':0}).status_code==409
    assert client.get(f'/api/v1/af/projects/{p}/files',headers=owner).json()['items'][0]['content']=='deepseek-v4-pro'


def test_restart_marks_unfinished_runs_and_cancel_preserves_version(client,monkeypatch):
    from core.database import db_manager
    from models.studio import StudioRun
    from services import studio
    owner,_=account(client);p=project(client,owner)
    uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    async def seed():
        async with db_manager.session() as db:
            db.add(StudioRun(id='interrupted-test',project_id=p,owner=str(uid),status='running'));await db.commit()
        await studio.recover()
    client.portal.call(seed)
    assert client.get('/api/v1/studio/runs/interrupted-test',headers=owner).json()['status']=='interrupted'
    async def model(*args,**kwargs):await asyncio.sleep(60)
    monkeypatch.setattr(studio,'model_call',model)
    run=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'cancel'}).json()['id']
    assert client.delete('/api/v1/studio/runs/'+run,headers=owner).status_code==200
    assert client.get('/api/v1/studio/runs/'+run,headers=owner).json()['status']=='cancelled'
    assert client.get(f'/api/v1/af/projects/{p}',headers=owner).json()['project']['current_version']==0
