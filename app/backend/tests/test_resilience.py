import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from openai import APIStatusError

from test_demo import client
from services import studio


def test_active_run_limit_is_configurable_and_bounded(monkeypatch):
    from services.generation import active_run_limit
    for value, expected in [('1', 1), ('2', 2), ('0', 1), ('99', 3), ('bad', 3)]:
        monkeypatch.setenv('AI_MAX_ACTIVE_RUNS', value)
        assert active_run_limit() == expected


def test_review_allows_complete_flows_and_requires_a_final_assertion():
    from services.team import validate_review
    tests=[{'action':'click','selector':'button'}]*13+[{'action':'text','selector':'output','value':'done'}]
    review={'approved':True,'summary':'review','issues':[],'tests':tests}
    assert len(validate_review(review)['tests'])==14
    with pytest.raises(ValueError):validate_review({**review,'tests':tests[:-1]})
    with pytest.raises(ValueError):validate_review({**review,'tests':[{'action':'visible','selector':'x'*301}]*2})


def test_precise_edits_are_sequential_atomic_and_preserve_unrelated_files():
    base=[{'path':'App.jsx','content':'const title="old"; const n=1;','language':'jsx'},{'path':'App.css','content':'keep','language':'css'}]
    patch={'edits':[{'path':'App.jsx','old':'title="old"','new':'title="new"'},{'path':'App.jsx','old':'n=1','new':'n=2'}]}
    assert studio.merge_patch(base,patch)[0]['content']=='const title="new"; const n=2;'
    assert studio.merge_patch(base,patch)[1]==base[1]
    assert studio.patch_paths(patch)==['App.jsx']
    invalid=[{'path':'App.jsx','old':'','new':'x'},{'path':'App.jsx','old':'missing','new':'x'},{'path':'App.jsx','old':'const','new':'x'},{'path':'../App.jsx','old':'n=1','new':'x'}]
    for edit in invalid:
        with pytest.raises(ValueError):studio.merge_patch(base,{'edits':[patch['edits'][0],edit]})
        assert base[0]['content']=='const title="old"; const n=1;'
    with pytest.raises(ValueError):studio.merge_patch(base,{'files':[base[0]],'edits':patch['edits']})
    with pytest.raises(ValueError):studio.merge_patch(base,{'delete':['App.jsx'],'edits':patch['edits']})


def test_transient_retries_are_bounded_and_do_not_retry_auth_or_cancellation(monkeypatch):
    waits=[];notices=[]
    async def sleep(delay):waits.append(delay)
    async def notify(n):notices.append(n)
    monkeypatch.setattr(studio.asyncio,'sleep',sleep)
    async def scenario():
        calls=0
        async def busy():
            nonlocal calls
            calls+=1
            if calls<3:raise HTTPException(503,'busy')
            return 'ok'
        assert await studio.retry_transient(busy,notify)=='ok'
        assert calls==3 and waits==[1,2] and notices==[1,2]
        for failure in [HTTPException(401,'auth'),APIStatusError('auth',response=httpx.Response(401,request=httpx.Request('POST','https://example.test')),body={}),asyncio.CancelledError()]:
            seen=[]
            async def fail():seen.append(True);raise failure
            with pytest.raises(type(failure)):await studio.retry_transient(fail,notify)
            assert len(seen)==1
        seen=[]
        async def exhausted():seen.append(True);raise HTTPException(429,'busy')
        with pytest.raises(HTTPException):await studio.retry_transient(exhausted,notify)
        assert len(seen)==3
    asyncio.run(scenario())


@pytest.mark.parametrize('exhausted',[False,True])
def test_truncated_code_changes_strategy_without_applying_partial_json(client,monkeypatch,exhausted):
    calls=[];events=[]
    async def create(**kwargs):
        calls.append(kwargs)
        finish='length' if exhausted or len(calls)==1 else 'stop'
        text='{"files":[' if finish=='length' else '{"edits":[{"path":"App.jsx","old":"old","new":"new"}],"tests":[]}'
        return SimpleNamespace(usage=SimpleNamespace(prompt_tokens=10,completion_tokens=20),choices=[SimpleNamespace(finish_reason=finish,message=SimpleNamespace(content=text))])
    class FakeService:
        def __init__(self):self.client=self
        def _require_ai_client(self):return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        async def close(self):pass
    async def event(*args,**kwargs):events.append(kwargs)
    monkeypatch.setattr(studio,'AIHubService',FakeService);monkeypatch.setattr(studio,'event',event)
    async def execute():
        return await studio.model_call('recovery-owner',1,'recovery-run','deepseek-flash','team_code',[{'role':'user','content':'add label deletion'}])
    if exhausted:
        with pytest.raises(studio.OutputLimitError):client.portal.call(execute)
    else:
        assert client.portal.call(execute)['edits'][0]['new']=='new'
    assert len(calls)==2
    assert 'edits' in calls[1]['messages'][-1]['content']
    assert all(e['state']=='recovering' for e in events)
