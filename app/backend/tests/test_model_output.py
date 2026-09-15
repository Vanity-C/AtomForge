import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from test_demo import client
from model_stream_fixture import Stream, chunk
from services import model_output, studio


def api(create):
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


@pytest.mark.parametrize('model',['deepseek-flash','deepseek-v4-pro','deepseek-v4-flash'])
def test_current_models_use_provider_capacity_not_default_or_stage_cap(model):
    assert model_output.output_options(model)=={'max_tokens':393216}
    assert model_output.output_options('deepseek-new-model')=={}
    assert model_output.output_options('gpt-test')=={}


@pytest.mark.parametrize('stage',['team_leader','team_product','team_design','team_architect',
    'team_code','team_code_batch','team_repair','team_qa','team_test_diagnosis','plan','code','chat_leader'])
def test_every_role_streams_complete_long_output_and_accounts_actual_usage(client,monkeypatch,stage):
    source='完整输出'*5000
    text=json.dumps({'summary':source},ensure_ascii=False)
    seen=[]; streams=[]
    async def create(**kwargs):
        seen.append(kwargs)
        stream=Stream([chunk(text[:14000]),chunk(text[14000:]),chunk(finish='stop'),
            chunk(usage=SimpleNamespace(prompt_tokens=120,completion_tokens=18000))])
        streams.append(stream)
        return stream
    class Service:
        def __init__(self):self.client=api(create)
        def _require_ai_client(self):return self.client
    async def event(*a,**k):pass
    async def close():pass
    monkeypatch.setattr(studio,'AIHubService',Service)
    monkeypatch.setattr(studio,'event',event)
    async def run():
        from services.agent_profiles import legacy_team
        result=await studio.model_call('output-tests',1,'output-'+stage,'deepseek-flash',stage,[],agent_team=legacy_team())
        from sqlalchemy import select
        async with studio.db_manager.session() as db:
            usage=await db.scalar(select(studio.StudioUsage).where(studio.StudioUsage.run_id=='output-'+stage))
            assert usage.output_tokens==18000 and usage.input_tokens==120
        return result
    # AIHubService.client cleanup is exercised elsewhere; provide real async close.
    real_init=Service.__init__
    def init(self):real_init(self);self.client.close=close
    Service.__init__=init
    assert client.portal.call(run)['summary']==source
    assert len(seen)==1 and seen[0]['max_tokens']==393216 and seen[0]['stream'] is True
    assert streams[0].closed


def test_continuous_output_can_outlive_the_old_total_deadline(monkeypatch):
    clock=[0.0]; notices=[]
    monkeypatch.setattr(model_output,'time',SimpleNamespace(monotonic=lambda:clock[0]))
    class SlowProgress(Stream):
        async def __anext__(self):
            value=await super().__anext__()
            clock[0]+=100  # Each chunk is active within the 180s inactivity window.
            return value
    stream=SlowProgress([chunk('{'),chunk('"ok"'),chunk(':true}'),chunk(finish='stop')])
    async def create(**kwargs):return stream
    async def notice(characters):notices.append(characters)
    result=asyncio.run(model_output.complete(api(create),'deepseek-flash',[],temperature=.1,progress=notice))
    assert clock[0]>180 and json.loads(result.choices[0].message.content)=={'ok':True}
    assert notices and stream.closed


def test_stalled_stream_and_empty_heartbeats_do_not_hold_slot_forever(monkeypatch):
    monkeypatch.setattr(model_output,'IDLE_TIMEOUT_SECONDS',.04)
    class Heartbeat(Stream):
        async def __anext__(self):
            await asyncio.sleep(.01)
            return chunk()
    stream=Heartbeat([])
    async def create(**kwargs):return stream
    with pytest.raises(TimeoutError):
        asyncio.run(model_output.complete(api(create),'deepseek-flash',[],temperature=.1))
    assert stream.closed


def test_transport_end_without_finish_is_not_accepted_even_if_json_looks_valid():
    stream=Stream([chunk('{"ok":true}')])
    async def create(**kwargs):return stream
    with pytest.raises(httpx.ReadError):
        asyncio.run(model_output.complete(api(create),'deepseek-flash',[],temperature=.1))
    assert stream.closed


def test_force_stop_cancels_long_stream_and_closes_connection():
    async def scenario():
        started=asyncio.Event()
        class Stuck(Stream):
            async def __anext__(self):
                started.set()
                await asyncio.Future()
        stream=Stuck([])
        async def create(**kwargs):return stream
        task=asyncio.create_task(model_output.complete(api(create),'deepseek-flash',[],temperature=.1))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
        assert stream.closed
    asyncio.run(scenario())
