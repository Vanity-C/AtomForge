import asyncio
import json
import time
import uuid

import pytest
from fastapi import HTTPException
from test_demo import client, account
from test_studio import project
from core.database import db_manager
from models.studio import StudioRun
from services import studio, agent_chat, task_control


async def seed(owner, pid, status='running', stage='code'):
    rid=uuid.uuid4().hex
    async with db_manager.session() as db:
        db.add(StudioRun(id=rid,owner=str(owner),project_id=pid,status=status,stage=stage,
                        payload=json.dumps({'mode':'team'}),result=json.dumps({'draft_files':[{'path':'App.jsx','content':'saved draft'}]})))
        await db.commit()
    return rid


def identity(client, headers):
    return client.get('/api/v1/af-auth/me',headers=headers).json()['user']['id']


def test_stop_is_scoped_authorized_idempotent_and_handles_orphans(client):
    owner,_=account(client);other,_=account(client)
    uid=identity(client,owner);pid=project(client,owner);other_pid=project(client,other)
    running=client.portal.call(seed,uid,pid)
    waiting=client.portal.call(seed,uid,pid,'awaiting_input','requirements')
    done=client.portal.call(seed,uid,pid,'done','done')
    unrelated=client.portal.call(seed,identity(client,other),other_pid)
    url=f'/api/v1/studio/projects/{pid}/stop'
    assert client.post(url).status_code==401
    assert client.post(url,headers=other).status_code==404
    response=client.post(url,headers=owner)
    assert response.status_code==200
    assert set(response.json()['stopped_run_ids'])=={running,waiting}
    for rid in [running,waiting]:
        run=client.get('/api/v1/studio/runs/'+rid,headers=owner).json()
        assert run['status']=='cancelled' and run['result']['draft_files'][0]['content']=='saved draft'
    assert client.get('/api/v1/studio/runs/'+done,headers=owner).json()['status']=='done'
    assert client.get('/api/v1/studio/runs/'+unrelated,headers=other).json()['status']=='running'
    assert client.post(url,headers=owner).json()['stopped_run_ids']==[]
    client.post(f'/api/v1/studio/projects/{other_pid}/stop',headers=other)


def test_stop_does_not_wait_for_cleanup_or_allow_late_commit(client):
    owner,_=account(client);uid=identity(client,owner);pid=project(client,owner)
    rid=client.portal.call(seed,uid,pid)

    async def scenario():
        entered=asyncio.Event();release=asyncio.Event();attempted=asyncio.Event()
        async def stuck():
            try:
                entered.set();await asyncio.Future()
            except asyncio.CancelledError:
                await release.wait()  # Simulate a provider hanging during cleanup.
            try:
                await studio.commit_result(uid,pid,0,{'files':[]},rid)
            finally:attempted.set()
        task=asyncio.create_task(stuck());studio.tasks[rid]=task
        await entered.wait()
        start=time.monotonic()
        result=await studio.stop_project(uid,pid)
        assert time.monotonic()-start<1 and result['stopped_run_ids']==[rid]
        assert rid not in studio.tasks and not studio.start_lock.locked()
        # New scheduling can enter while the old provider is still cleaning up.
        async with asyncio.timeout(.2):
            async with studio.start_lock:pass
        assert not task.done()
        release.set()
        await attempted.wait()
        await asyncio.gather(task,return_exceptions=True)
        with pytest.raises(asyncio.CancelledError):await studio.change(rid,status='done')
        with pytest.raises(asyncio.CancelledError):await studio.event(rid,'code','late output')

    client.portal.call(scenario)
    assert client.get('/api/v1/studio/runs/'+rid,headers=owner).json()['status']=='cancelled'
    assert client.get(f'/api/v1/af/projects/{pid}/versions',headers=owner).json()['items']==[]


def test_single_cancel_also_recovers_missing_worker(client):
    owner,_=account(client);pid=project(client,owner)
    rid=client.portal.call(seed,identity(client,owner),pid)
    assert client.delete('/api/v1/studio/runs/'+rid,headers=owner).status_code==200
    assert client.get('/api/v1/studio/runs/'+rid,headers=owner).json()['status']=='cancelled'


def test_stopped_chat_releases_project_and_cannot_append_late_reply(client,monkeypatch):
    owner,_=account(client);uid=identity(client,owner);pid=project(client,owner)

    async def scenario():
        entered=asyncio.Event();release=asyncio.Event()
        async def stuck(*args):
            lock=agent_chat.chat_locks.setdefault(pid,asyncio.Lock())
            async with lock:
                try:entered.set();await asyncio.Future()
                except asyncio.CancelledError:await release.wait()
                await agent_chat.append(uid,pid,'engineer','user','chat','forbidden late reply')
        monkeypatch.setattr(agent_chat,'_chat',stuck)
        old=asyncio.create_task(agent_chat.chat(uid,pid,'engineer','hello','test'))
        await entered.wait()
        result=await studio.stop_project(uid,pid)
        assert result['stopped_chats']==1 and pid not in agent_chat.chat_tasks
        async def fresh(*args):return {'success':True}
        monkeypatch.setattr(agent_chat,'_chat',fresh)
        assert (await agent_chat.chat(uid,pid,'engineer','new','test'))['success']
        release.set()
        result=await asyncio.gather(old,return_exceptions=True)
        assert isinstance(result[0],HTTPException) and result[0].status_code==409
        assert not (await agent_chat.messages(uid,pid))['items']
    client.portal.call(scenario)


def test_deadline_returns_even_when_model_suppresses_cancellation(client):
    async def scenario():
        release=asyncio.Event()
        async def stuck():
            try:await asyncio.Future()
            except asyncio.CancelledError:await release.wait()
        started=time.monotonic()
        try:
            with pytest.raises(TimeoutError):await task_control.bounded(stuck(),.03)
            assert time.monotonic()-started<.5
        finally:
            release.set();await asyncio.sleep(.01)
    client.portal.call(scenario)


def test_committing_version_is_not_partially_cancelled(client):
    owner,_=account(client);pid=project(client,owner)
    rid=client.portal.call(seed,identity(client,owner),pid,'running','save')
    result=client.post(f'/api/v1/studio/projects/{pid}/stop',headers=owner).json()
    assert result['saving_run_ids']==[rid] and result['stopped_run_ids']==[]
    client.portal.call(lambda:studio.change(rid,status='done',stage='done'))


def test_exhausted_reconnects_and_stuck_close_still_finish_run(client,monkeypatch):
    from types import SimpleNamespace
    from services.agent_profiles import snapshot
    owner,_=account(client);uid=identity(client,owner);pid=project(client,owner)
    rid=client.portal.call(seed,uid,pid)

    async def scenario():
        attempts=[];release=asyncio.Event()
        async def create(**kwargs):
            attempts.append(True)
            raise HTTPException(503,'model connection unavailable')
        class Service:
            def __init__(self):self.client=self
            def _require_ai_client(self):return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
            async def close(self):
                try:await asyncio.Future()
                except asyncio.CancelledError:await release.wait()
        bounded=task_control.bounded
        async def short(operation, timeout):return await bounded(operation,min(timeout,.05))
        monkeypatch.setattr(studio,'AIHubService',Service)
        monkeypatch.setattr(studio,'provider_for',lambda _: 'openai')
        monkeypatch.setattr(task_control,'bounded',short)
        try:
            started=time.monotonic()
            await studio.execute(rid,uid,pid,{'mode':'build','model':'test','instruction':'counter','agents':await snapshot(uid,mode='build'),'history':[],'files':[],'base_version':0})
            assert time.monotonic()-started<5
            assert len(attempts)==3
            result=await studio.get_run(uid,rid)
            assert result['status']=='error' and 'model connection unavailable' in result['error']
        finally:release.set();await asyncio.sleep(.01)
    client.portal.call(scenario)
