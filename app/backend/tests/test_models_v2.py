"""V2 provider routing, persisted settings and project usage regressions."""
from types import SimpleNamespace
from test_demo import client, account
from test_studio import project
import asyncio
import json
import subprocess
import sys
import pytest


def test_usage_totals_include_more_than_500_calls_and_details_are_private(client):
    from core.database import db_manager
    from models.studio import StudioUsage
    owner,_=account(client); other,_=account(client)
    uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    p=project(client,owner)

    async def seed():
        async with db_manager.session() as db:
            db.add_all([StudioUsage(owner=str(uid),project_id=p,run_id='usage-v2',model='deepseek-flash',
                        stage='code',input_tokens=2,output_tokens=3) for _ in range(505)])
            db.add(StudioUsage(owner='another-owner',project_id=p,run_id='private',model='gpt-test',
                               stage='code',input_tokens=10000,output_tokens=10000))
            await db.commit()
    client.portal.call(seed)
    result=client.get('/api/v1/studio/usage',headers=owner).json()
    assert result['input_tokens']==1010 and result['output_tokens']==1515
    assert result['projects'][0]['calls']==505 and result['projects'][0]['name']=='studio test'
    seen=[];before=None
    while True:
        page=client.get(f'/api/v1/studio/usage/projects/{p}',headers=owner,params={'before':before} if before else {}).json()
        seen.extend(row['id'] for row in page['items'])
        before=page['next_cursor']
        if before is None:break
    assert len(seen)==len(set(seen))==505
    assert client.get('/api/v1/studio/usage',headers=other).json()['projects']==[]
    assert client.get(f'/api/v1/studio/usage/projects/{p}',headers=other).json()['items']==[]
    assert client.get(f'/api/v1/studio/usage/projects/{p}').status_code==401


def test_codex_settings_survive_reload_and_validate_provider(client,monkeypatch):
    from services import model_catalogue
    async def catalogue():
        return {'items':[{'id':'gpt-test','provider':'codex','available':True}]}
    monkeypatch.setattr(model_catalogue,'catalogue',catalogue)
    owner,_=account(client)
    payload={'provider':'codex','model':'gpt-test','temperature_pct':35,'auto_preview':True}
    assert client.put('/api/v1/af/settings',headers=owner,json=payload).status_code==200
    assert client.get('/api/v1/af/settings',headers=owner).json()['settings']['model']=='gpt-test'
    assert client.put('/api/v1/af/settings',headers=owner,json={**payload,'provider':'deepseek'}).status_code==400
    assert client.put('/api/v1/af/settings',headers=owner,json={**payload,'model':'gpt-unknown'}).status_code==400


def test_codex_routes_without_deepseek_key_and_records_usage(client,monkeypatch):
    from services import studio
    from core.database import db_manager
    from sqlalchemy import select
    from models.studio import StudioUsage
    def no_deepseek():raise AssertionError('GPT must not initialize DeepSeek')
    async def complete(model,messages):
        assert model=='gpt-test'
        return SimpleNamespace(usage=SimpleNamespace(prompt_tokens=42,completion_tokens=9),
            choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content='{"ok":true}'))])
    monkeypatch.setattr(studio,'AIHubService',no_deepseek)
    monkeypatch.setattr(studio.codex_provider,'complete',complete)
    async def run():
        assert await studio.model_call('codex-v2',1,'codex-v2','gpt-test','code',[])=={'ok':True}
        async with db_manager.session() as db:
            row=await db.scalar(select(StudioUsage).where(StudioUsage.run_id=='codex-v2'))
            assert row.input_tokens==42 and row.output_tokens==9
            from services.budget import summary
            budget=await summary(db,'codex-v2')
            assert budget['used_tokens']==51 and budget['estimated_cost']==0 and not budget['unpriced_usage']
    client.portal.call(run)


def test_codex_jsonl_recovery_and_cancellation(monkeypatch):
    from services import codex_provider as cp
    monkeypatch.setattr(cp,'inspect_account',lambda:[{'model':'gpt-test'}])
    processes=[]
    def launch(args,cwd=None):
        assert '--ignore-user-config' in args and '--ephemeral' in args
        assert 'read-only' in args and 'forced_login_method="chatgpt"' in args
        records=[{'type':'error','message':'Reconnecting'},
                 {'type':'item.completed','item':{'type':'agent_message','text':'{"ok":true}'}},
                 {'type':'turn.completed','usage':{'input_tokens':40,'output_tokens':7}}]
        script='import sys,json; sys.stdin.read(); print('+repr('\n'.join(json.dumps(r) for r in records))+')'
        p=subprocess.Popen([sys.executable,'-c',script],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           text=True,encoding='utf-8',cwd=cwd)
        processes.append(p)
        return p
    monkeypatch.setattr(cp,'launch',launch)
    result=asyncio.run(cp.complete('gpt-test',[]))
    assert result.usage.prompt_tokens==40 and result.choices[0].message.content=='{"ok":true}'
    assert processes[0].poll()==0

    def sleeping(args,cwd=None):
        p=subprocess.Popen([sys.executable,'-c','import sys,time; sys.stdin.read(); time.sleep(30)'],
                           stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf-8',cwd=cwd)
        processes.append(p)
        return p
    monkeypatch.setattr(cp,'launch',sleeping)
    async def cancel():
        task=asyncio.create_task(cp.complete('gpt-test',[]))
        while len(processes)<2: await asyncio.sleep(.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
        assert processes[-1].poll() is not None
    asyncio.run(cancel())


def test_codex_discovery_rejects_api_key_login(monkeypatch):
    from fastapi import HTTPException
    from services import codex_provider as cp
    script='''import sys,json
for line in sys.stdin:
    req=json.loads(line)
    if 'id' not in req:continue
    result={} if req['method']=='initialize' else {'account':{'type':'apiKey'}}
    print(json.dumps({'id':req['id'],'result':result}),flush=True)
'''
    processes=[]
    def launch(args,cwd=None):
        p=subprocess.Popen([sys.executable,'-c',script],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           text=True,encoding='utf-8')
        processes.append(p);return p
    monkeypatch.setattr(cp,'launch',launch)
    with pytest.raises(HTTPException) as error:cp.inspect_account()
    assert error.value.status_code==503
    assert processes[0].poll() is not None
