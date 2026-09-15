import asyncio
import copy
import json

import pytest
from test_demo import client, account
from test_studio import project
from test_team import fake_model, wait_run
from services import studio, code_batches

BASE = [{'path':'App.jsx','content':'export default function App(){return <h1>old</h1>}','language':'jsx'},
        {'path':'App.css','content':'h1{color:red}','language':'css'}]


def messages(files=BASE):
    return [{'role':'system','content':studio.ENGINEER},
            {'role':'user','content':json.dumps({'request':'add counter and style','currentFiles':files})}]


def batch(old='old', new='counter', *, complete=True):
    return {'edits':[{'path':'App.jsx','old':f'>{old}<','new':f'>{new}<'}],
            'complete':complete,'remaining':[] if complete else ['finish style'],
            'summary':new,'tests':[{'action':'text','selector':'h1','value':new}]}


def test_length_switches_to_smaller_batches_and_never_applies_truncation(monkeypatch):
    calls=[]; saves=[]; state={}
    async def model(*args, **kwargs):
        calls.append((args,kwargs))
        if len(calls)<=2:raise studio.OutputLimitError('truncated')
        return batch()
    async def event(*a,**k):pass
    async def save(files,checkpoint):saves.append((copy.deepcopy(files),checkpoint))
    monkeypatch.setattr(studio,'call_model',model)
    monkeypatch.setattr(studio,'event',event)
    patch=asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','team_code',messages(),BASE,checkpoint=state,save=save))
    assert [c[0][4] for c in calls]==['team_code','team_code_batch','team_code_batch']
    context=json.loads(calls[2][0][5][-1]['content'])
    assert 'batchBudgetChars' not in context and '单次输出上限' in context['batchError']
    assert all('max_tokens' not in kwargs for _,kwargs in calls)
    assert saves[0][0]==BASE and saves[1][0]==BASE
    assert studio.merge_patch(BASE,patch)[0]['content'].endswith('>counter</h1>}')
    assert studio.merge_patch(BASE,patch)[1]==BASE[1]
    assert state['finished'] and not state['remaining']


def test_resume_after_disconnect_keeps_first_batch_without_replaying_it(monkeypatch):
    state={}; saves=[]; calls=[]
    async def event(*a,**k):pass
    async def save(files,checkpoint):saves.append((copy.deepcopy(files),copy.deepcopy(checkpoint)))
    async def first(*args,**kwargs):
        calls.append(args)
        if len(calls)==1:return batch(new='step1',complete=False)
        raise TimeoutError('connection lost')
    monkeypatch.setattr(studio,'event',event)
    monkeypatch.setattr(studio,'call_model',first)
    with pytest.raises(TimeoutError):
        asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','team_code',messages(),BASE,checkpoint=state,save=save,prefer_batches=True))
    draft,checkpoint=saves[-1]
    assert 'step1' in draft[0]['content'] and not checkpoint['finished']
    async def resumed(*args,**kwargs):
        context=json.loads(args[5][-1]['content'])
        assert 'step1' in context['currentFiles'][0]['content']
        assert context['remaining']==['finish style']
        return batch(old='step1',new='counter')
    monkeypatch.setattr(studio,'call_model',resumed)
    patch=asyncio.run(code_batches.generate_patch('u',1,'retry','deepseek-flash','team_code',messages(),draft,checkpoint=checkpoint,save=save))
    assert 'counter' in studio.merge_patch(draft,patch)[0]['content']
    assert len(checkpoint['completed'])==2


def test_cancel_is_not_retried_and_invalid_patch_never_overwrites_draft(monkeypatch):
    saves=[]
    async def event(*a,**k):pass
    async def save(files,checkpoint):saves.append(copy.deepcopy(files))
    monkeypatch.setattr(studio,'event',event)
    async def invalid(*a,**k):return batch(old='missing')
    monkeypatch.setattr(studio,'call_model',invalid)
    with pytest.raises(studio.OutputLimitError):
        asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','code',messages(),BASE,save=save,prefer_batches=True))
    assert saves==[BASE]
    async def cancel(*a,**k):raise asyncio.CancelledError()
    monkeypatch.setattr(studio,'call_model',cancel)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','code',messages(),BASE,prefer_batches=True))


@pytest.mark.parametrize('patch', [{'complete':True,'remaining':['unfinished']},
                                  {'complete':False,'remaining':[]},
                                  {'complete':'false','remaining':['work']}])
def test_cannot_claim_completion_with_pending_work(patch):
    with pytest.raises(ValueError):code_batches.validate_batch(patch)


def test_changed_request_cannot_reuse_a_finished_checkpoint(monkeypatch):
    checkpoint={'scope':'previous-request','finished':True,'remaining':[]}
    calls=[]
    async def event(*a,**k):pass
    async def model(*a,**k):calls.append(a);return batch()
    monkeypatch.setattr(studio,'event',event)
    monkeypatch.setattr(studio,'call_model',model)
    result=asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','code',messages(),BASE,checkpoint=checkpoint))
    assert len(calls)==1 and calls[0][4]=='code_batch'
    assert '>counter<' in studio.merge_patch(BASE,result)[0]['content']


def test_more_than_24_batches_complete_without_token_or_batch_quota(monkeypatch):
    state={}; saved=[]; calls=0
    async def event(*a,**k):pass
    async def save(files,checkpoint):saved.append(checkpoint)
    async def model(*a,**k):
        nonlocal calls
        calls+=1
        return batch(old='old' if calls==1 else f'step{calls-1}',new=f'step{calls}',complete=calls==55)
    monkeypatch.setattr(studio,'event',event)
    monkeypatch.setattr(studio,'call_model',model)
    patch=asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','code',messages(),BASE,checkpoint=state,save=save,prefer_batches=True))
    assert calls==55 and state['completed_count']==55 and state['finished']
    assert len(state['completed'])==48 and not saved[-1]['remaining']
    assert '>step55<' in studio.merge_patch(BASE,patch)[0]['content']


def test_repeated_source_cycle_preserves_last_good_checkpoint(monkeypatch):
    state={}; saved=[]; calls=0
    async def event(*a,**k):pass
    async def save(files,checkpoint):saved.append((copy.deepcopy(files),checkpoint))
    async def model(*a,**k):
        nonlocal calls
        calls+=1
        return batch(new='step1',complete=False) if calls==1 else batch(old='step1',new='old',complete=False)
    monkeypatch.setattr(studio,'event',event)
    monkeypatch.setattr(studio,'call_model',model)
    with pytest.raises(studio.OutputLimitError):
        asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','code',messages(),BASE,checkpoint=state,save=save,prefer_batches=True))
    assert state['completed_count']==1 and '>step1<' in saved[-1][0][0]['content']
    assert state['remaining']==['finish style'] and not state['finished']


def test_legacy_checkpoint_drops_old_character_budget(monkeypatch):
    checkpoint={'version':1,'completed':[],'remaining':['finish'],'budget':2000,'finished':False}
    async def event(*a,**k):pass
    async def model(*a,**k):
        assert 'batchBudgetChars' not in json.loads(a[5][-1]['content'])
        assert 'max_tokens' not in k
        return batch()
    monkeypatch.setattr(studio,'event',event)
    monkeypatch.setattr(studio,'call_model',model)
    asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','code',messages(),BASE,checkpoint=checkpoint))
    assert checkpoint['version']==2 and 'budget' not in checkpoint and checkpoint['finished']


def test_team_batched_generation_still_runs_independent_qa_before_saving(client,monkeypatch):
    owner,_=account(client); p=project(client,owner,mode='team'); calls=[]; checks=[]
    base=fake_model(calls)
    async def model(*args,**kwargs):
        if args[4]=='team_code':raise studio.OutputLimitError('length')
        if args[4]=='team_code_batch':
            return {'files':[{'path':'App.jsx','content':'export default function App(){return <h1>counter</h1>}'}],
                    'complete':True,'remaining':[],'summary':'counter implemented','tests':[]}
        return await base(*args,**kwargs)
    async def build(files,tests=None):
        checks.append(tests)
        return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model)
    monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    assert run['status']=='done',run
    assert len(checks)==2 and len(checks[1])==2
    assert run['result']['team']['qa']['verified'] is True
    assert 'code_checkpoint' not in run['result']


@pytest.mark.parametrize('mode', ['team','build'])
def test_retry_api_preserves_batch_checkpoint_and_only_generates_pending_work(client,monkeypatch,mode):
    owner,_=account(client); p=project(client,owner,mode=mode); calls=[]
    base=fake_model(calls); saved_batch=False; resume=False
    async def model(*args,**kwargs):
        nonlocal saved_batch
        stage=args[4]
        if stage=='plan':return {'goal':'counter','tasks':['counter']}
        if stage in {'code','team_code'}:raise studio.OutputLimitError('length')
        if stage.endswith('_batch'):
            context=json.loads(args[5][-1]['content'])
            if not saved_batch:
                saved_batch=True
                return {'files':[{'path':'App.jsx','content':'export default function App(){return <h1>step1</h1>}'}],
                        'complete':False,'remaining':['finish counter'],'tests':[]}
            if not resume:raise TimeoutError('connection lost')
            assert 'step1' in context['currentFiles'][0]['content']
            assert context['remaining']==['finish counter']
            return batch(old='step1')
        return await base(*args,**kwargs)
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model)
    monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':mode,'interactive':False}).json()['id']
    failed=wait_run(client,owner,rid)
    assert failed['status']=='error',failed
    assert failed['result']['code_checkpoint']['remaining']==['finish counter']
    assert client.get(f'/api/v1/af/projects/{p}/versions',headers=owner).json()['items']==[]
    resume=True
    response=client.post('/api/v1/studio/runs/'+rid+'/retry',headers=owner)
    assert response.status_code==202,response.text
    done=wait_run(client,owner,response.json()['id'])
    assert done['status']=='done',done
    assert len(client.get(f'/api/v1/af/projects/{p}/versions',headers=owner).json()['items'])==1
