import asyncio
import pytest
from fastapi import HTTPException
from test_demo import client
from services import studio


def test_busy_queue_waits_then_succeeds_without_restarting_generation(monkeypatch):
    async def scenario():
        calls=[];notices=[]
        async def request():
            calls.append(True)
            if len(calls)<5:raise HTTPException(429,'busy')
            return {'ok':True}
        async def notice():notices.append(True)
        async def no_delay(_):pass
        monkeypatch.setattr(studio.asyncio,'sleep',no_delay)
        assert await studio.wait_runner_slot(request,notice)=={'ok':True}
        assert len(calls)==5 and len(notices)==1
    asyncio.run(scenario())


def test_queue_timeout_is_resumable_and_not_retried_as_connection_error(monkeypatch):
    monkeypatch.setattr(studio,'RUNNER_QUEUE_TIMEOUT',0)
    async def scenario():
        calls=[]
        async def busy():calls.append(True);raise HTTPException(429,'busy')
        async def retry_notice(_):pytest.fail('Queue timeout must not restart its deadline')
        with pytest.raises(studio.RunnerUnavailable):
            await studio.retry_transient(lambda:studio.wait_runner_slot(busy),retry_notice)
        assert len(calls)==1
    asyncio.run(scenario())
    assert studio.can_resume_verification({'draft_files':[{'path':'App.jsx'}]},'验证队列繁忙，正在等待空闲')
    assert not studio.can_resume_verification({},'验证队列繁忙，正在等待空闲')


def test_queue_wait_can_be_stopped_and_does_not_mask_real_errors():
    async def scenario():
        waiting=asyncio.Event()
        async def busy():waiting.set();raise HTTPException(429,'busy')
        task=asyncio.create_task(studio.wait_runner_slot(busy))
        await waiting.wait();task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
        async def bad():raise HTTPException(400,'invalid input')
        with pytest.raises(HTTPException) as exc:await studio.wait_runner_slot(bad)
        assert exc.value.status_code==400
    asyncio.run(scenario())
