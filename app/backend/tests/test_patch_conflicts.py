import asyncio
import copy
import json

import pytest
from test_demo import client, account
from test_studio import project
from test_team import fake_model, wait_run
from services import code_batches, studio, team
from services.patch_conflicts import PatchConflictError


def test_conflict_reports_already_applied_replacement_without_applying_it():
    source='const WORLD_WIDTH = 2000;\nplayer.x = Math.min(WORLD_WIDTH, player.x);\n'
    base=[{'path':'App.jsx','content':source}]
    with pytest.raises(PatchConflictError) as caught:
        studio.merge_patch(base,{'edits':[{'path':'App.jsx','old':'Math.min(GAME_WIDTH, player.x)',
                                          'new':'Math.min(WORLD_WIDTH, player.x)'}]})
    evidence=caught.value.details
    assert evidence['old_occurrences']==0 and evidence['new_occurrences']==1
    assert any('WORLD_WIDTH' in item['content'] for item in evidence['actual_source_snippets'])
    assert base[0]['content']==source


def test_ordered_edit_conflict_rolls_back_and_evidence_describes_original_draft():
    base=[{'path':'App.jsx','content':'old\nold\n'}]
    with pytest.raises(PatchConflictError) as caught:
        studio.merge_patch(base,{'edits':[{'path':'App.jsx','old':'old\nold\n','new':'new\nnew\n'},
                                         {'path':'App.jsx','old':'new','new':'done'}]})
    assert caught.value.details['old_occurrences']==0
    assert caught.value.details['failed_edit_occurrences']==2
    assert base[0]['content']=='old\nold\n'


def test_conflict_retry_has_fresh_source_evidence_and_does_not_consume_application_repair(monkeypatch):
    base=[{'path':'App.jsx','content':'export default function App(){return <h1>done</h1>}'}]
    messages=[{'role':'system','content':studio.ENGINEER},
              {'role':'user','content':json.dumps({'request':'show done','currentFiles':base})}]
    calls=[]
    async def model(*args,**kwargs):
        context=json.loads(args[5][-1]['content']);calls.append(context)
        if len(calls)==1:
            return {'edits':[{'path':'App.jsx','old':'<h1>old</h1>','new':'<h1>done</h1>'}]}
        assert context['patchConflict']['new_occurrences']==1
        assert context['currentFiles']==base
        return {'files':[],'summary':'already implemented','tests':[]}
    async def event(*a,**k):pass
    monkeypatch.setattr(studio,'call_model',model);monkeypatch.setattr(studio,'event',event)
    patch=asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','team_repair',messages,base))
    assert len(calls)==2 and studio.merge_patch(base,patch)==base


def test_repeated_unsafe_patch_stops_after_three_instead_of_thirty_attempts(monkeypatch):
    base=[{'path':'App.jsx','content':'export default function App(){return null}'}]
    calls=[]
    async def model(*args,**kwargs):
        calls.append(args)
        return {'edits':[{'path':'App.jsx','old':'missing code','new':'unsafe replacement'}]}
    async def event(*a,**k):pass
    monkeypatch.setattr(studio,'call_model',model);monkeypatch.setattr(studio,'event',event)
    with pytest.raises(studio.OutputLimitError):
        asyncio.run(code_batches.generate_patch('u',1,'r','deepseek-flash','code',
            [{'role':'user','content':json.dumps({'request':'work','currentFiles':base})}],base))
    assert len(calls)==3
    assert 'unsafe' not in base[0]['content']


def test_review_excludes_its_own_stale_conclusion_but_keeps_requirements_and_current_source():
    context={'currentFiles':[{'path':'App.jsx','content':'new source'}],
             'repairRequest':{'items':['old code is broken']},
             'approvedRequirements':{'goal':'keep all requirements'},
             'handoffs':{'qa':{'approved':False,'issues':['old code']},'engineer':{'summary':'fixed'},'product':{'goal':'scope'}}}
    saved=copy.deepcopy(context)
    fresh=team.current_review_context(context)
    assert context==saved
    assert 'qa' not in fresh['handoffs'] and 'repairRequest' not in fresh
    assert fresh['approvedRequirements']==context['approvedRequirements']
    assert fresh['currentFiles']==context['currentFiles']
    modified=team.current_review_context({**context,'currentFiles':[{'path':'App.jsx','content':'next source'}]})
    assert fresh['sourceRevision']!=modified['sourceRevision']


def test_second_independent_review_does_not_receive_stale_first_review(client,monkeypatch):
    owner,_=account(client);p=project(client,owner,mode='team');calls=[];reviews=[]
    base_model=fake_model(calls)
    async def model(*args,**kwargs):
        output=await base_model(*args,**kwargs)
        if args[4]=='team_qa':
            context=json.loads(args[5][-1]['content'])
            reviews.append(context)
            assert 'qa' not in context['handoffs'] and 'repairRequest' not in context
            if len(reviews)==1:output.update(approved=False,issues=['needs correction'],summary='correct before delivery')
        return output
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    result=wait_run(client,owner,rid)
    assert result['status']=='done',result
    assert len(reviews)==2 and result['result']['team']['qa']['verified']
