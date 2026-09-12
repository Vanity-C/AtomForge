import asyncio
import json
import time
import pytest
from fastapi import HTTPException
from test_demo import client, account
from test_studio import project
from test_team import fake_model, wait_run
from services import studio, checkpoints
from services.agent_chat import decide as apply_decision
from core.database import db_manager
from models.studio import StudioRun


def start_choices(client, monkeypatch):
    owner,_=account(client)
    p=project(client,owner,mode='team')
    calls=[]
    base=fake_model(calls,confirm=True)
    async def model(*args, **kwargs):
        output=await base(*args, **kwargs)
        if args[4]=='team_product':
            output['questions']=[{'kind':'user_requested','question':'重置如何执行？','options':[{'label':'直接归零','description':'点击后立即归零'},{'label':'二次确认','description':'确认后才归零'}],'recommended':0,'reason':'这是轻量计数器，直接操作更简单。'}]
        return output
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'compiled','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model)
    monkeypatch.setattr(studio,'runner_build',build)
    r=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':'team'})
    assert r.status_code==202
    return owner,p,r.json()['id'],calls


def control(client,owner,state,action):
    return client.post(f"/api/v1/studio/runs/{state['id']}/decision-control",headers=owner,json={'checkpoint_id':state['result']['pending']['id'],'action':action})


def select(client,owner,state,selections,other=None):
    return client.post(f"/api/v1/studio/runs/{state['id']}/decision",headers=owner,json={'checkpoint_id':state['result']['pending']['id'],'action':'approve','selections':selections,'other':other or {}})


def test_deadline_automatically_selects_recommendations_and_finishes(client,monkeypatch):
    monkeypatch.setattr(checkpoints,'TIMEOUT_SECONDS',.15)
    owner,p,rid,calls=start_choices(client,monkeypatch)
    for _ in range(250):
        state=client.get('/api/v1/studio/runs/'+rid,headers=owner).json()
        if state['status'] in {'done','error'}:break
        time.sleep(.02)
    assert state['status']=='done',state['result'].get('pending', {}).get('auto', state['error'])
    auto=[e for e in state['events'] if e.get('automatic')]
    assert len(auto)==2 and '直接归零' in auto[0]['message']
    code=next(ctx for stage,ctx in calls if stage=='team_code')
    assert '直接归零' in code['approvedRequirements']['confirmed_choices'][0]
    assert client.get(f'/api/v1/af/projects/{p}',headers=owner).json()['project']['current_version']==1


def test_pause_survives_restart_and_alternative_reaches_engineer_and_qa(client,monkeypatch):
    owner,p,rid,calls=start_choices(client,monkeypatch)
    state=wait_run(client,owner,rid)
    card=state['result']['pending']
    assert 25 < card['auto']['deadline']-time.time() <=30
    other,_=account(client)
    assert control(client,other,state,'pause').status_code==404
    assert control(client,owner,state,'pause').status_code==200
    client.portal.call(studio.recover)
    restored=client.get('/api/v1/studio/runs/'+rid,headers=owner).json()
    assert restored['result']['pending']['auto']=={'paused':True,'deadline':None}
    async def auto_while_paused():
        async with db_manager.session() as db:
            row=await db.get(StudioRun,rid)
            actual_owner=row.owner
        await apply_decision(actual_owner,rid,card['id'],'auto','')
    with pytest.raises(HTTPException) as exc:
        client.portal.call(auto_while_paused)
    assert exc.value.status_code==409
    assert select(client,owner,state,{'q1':'invalid'}).status_code==400
    assert select(client,owner,state,{'q1':'other'}).status_code==400
    assert select(client,owner,state,{'q1':'o2'}).status_code==202
    assert select(client,owner,state,{'q1':'o2'}).status_code==409
    solution=wait_run(client,owner,rid)
    assert select(client,owner,solution,{'q1':'o1'}).status_code==202
    done=wait_run(client,owner,rid)
    assert done['status']=='done',done
    for stage,ctx in calls:
        if stage in {'team_code','team_qa'}:
            assert '二次确认' in ctx['approvedRequirements']['confirmed_choices'][0]


def test_other_revises_and_resume_refreshes_deadline(client,monkeypatch):
    owner,p,rid,calls=start_choices(client,monkeypatch)
    state=wait_run(client,owner,rid)
    assert control(client,owner,state,'pause').status_code==200
    assert control(client,owner,state,'resume').json()['pending']['auto']['deadline']>time.time()+25
    assert select(client,owner,state,{'q1':'other'},{'q1':'长按两秒才能重置'}).status_code==202
    updated=wait_run(client,owner,rid)
    assert updated['result']['pending']['id']!=state['result']['pending']['id']
    product_calls=[ctx for stage,ctx in calls if stage=='team_product']
    assert '长按两秒才能重置' in product_calls[-1]['request']
    assert control(client,owner,state,'pause').status_code==409
    assert client.delete('/api/v1/studio/runs/'+rid,headers=owner).status_code==200
    assert rid not in checkpoints.timers


def test_expired_deadline_recovered_once_and_version_conflict_pauses(client,monkeypatch):
    owner,p,rid,calls=start_choices(client,monkeypatch)
    state=wait_run(client,owner,rid)
    async def expire():
        async with db_manager.session() as db:
            row=await db.get(StudioRun,rid)
            result=json.loads(row.result)
            result['pending']['auto']['deadline']=time.time()-1
            row.result=json.dumps(result)
            await db.commit()
        await checkpoints.restore()
    client.portal.call(expire)
    for _ in range(100):
        latest=client.get('/api/v1/studio/runs/'+rid,headers=owner).json()
        if latest['result'].get('pending',{}).get('key')=='solution':break
        time.sleep(.02)
    assert latest['result']['pending']['key']=='solution'
    assert len([e for e in latest['events'] if e.get('automatic')])==1
    # A version conflict must pause automatic continuation, not repeatedly retry it.
    client.post(f'/api/v1/af/projects/{p}/files',headers=owner,json={'files':[{'path':'App.jsx','content':'changed'}]})
    client.portal.call(expire)
    for _ in range(100):
        latest=client.get('/api/v1/studio/runs/'+rid,headers=owner).json()
        if latest['result'].get('pending',{}).get('auto',{}).get('paused'):break
        time.sleep(.02)
    assert latest['status']=='awaiting_input'
    assert latest['result']['pending']['auto']['paused']
    assert '版本已变化' in latest['result']['pending']['auto']['error']
    client.delete('/api/v1/studio/runs/'+rid,headers=owner)
