"""Uncertain labels must neither cause engineering churn nor hide real failures."""
import asyncio
import json

import pytest

from test_demo import account, client
from test_studio import project
from test_team import fake_model, wait_run
from services import studio
from services.qa_review import issue_details
from services.qa_triage import ready, triage_issues


def finding(**extra):
    return {'description':'Save loses data','type':'data','severity':'high','source':'source_review',
            'disposition':'blocker','requirement':'Save survives reload','location':'App.jsx',
            'reproduction':'Add a record, reload','expected':'Record remains','actual':'Record is lost',
            'evidence':'Only React state is used','impact':'Saved work is lost','reason':'Confirmed data loss',**extra}


def classify(issue, **extra):
    return {**finding(), **issue, **extra}


def test_missing_metadata_is_not_a_repair_order():
    for extra in ({'severity':'unknown'},{'type':'unknown'},{'requirement':''},{'evidence':''},{'impact':''},{'reason':''}):
        assert not ready(finding(**extra))
    assert ready(finding())
    # Severity alone is neither a bypass nor a reason to repair.
    assert ready(finding(severity='low'))
    assert not ready(finding(disposition='advisory',severity='high'))
    assert not ready(finding(disposition='advisory',severity='low',source='browser_test'))


@pytest.mark.parametrize('response', ['pending','missing','duplicate','unknown_blocker','hide_execution','bad_json'])
def test_unknown_malformed_or_failed_execution_never_disappears(response):
    original = finding(severity='unknown',disposition='pending',source='browser_test')
    snapshots, calls = [], []
    async def save(groups):
        snapshots.append(groups)
    async def request(body):
        calls.append(body)
        item = body['findings'][0]
        if response == 'bad_json':
            raise ValueError('invalid JSON')
        if response == 'missing': return {'items':[]}
        if response == 'duplicate': return {'items':[item,item]}
        if response == 'unknown_blocker': item.update(disposition='blocker')
        if response == 'hide_execution':
            item.update(disposition='advisory',severity='low',source='source_review')
        return {'items':[item]}
    result = asyncio.run(triage_issues([original['description']],[original],request=request,on_update=save))
    assert len(result['pending']) == 1 and not result['blockers'] and not result['advisories']
    assert result['pending'][0]['source'] == 'browser_test'
    assert result['pending'][0]['evidence'] == original['evidence']
    assert 1 <= len(calls) <= 2 and snapshots


def test_known_blocker_needs_no_extra_model_call_and_optional_finding_keeps_evidence():
    async def save(groups): pass
    async def no_call(body): raise AssertionError('already classified')
    blocker = finding()
    result = asyncio.run(triage_issues([blocker['description']],[blocker],request=no_call,on_update=save))
    assert result['blockers'] and not result['pending']
    original = finding(description='Prefer a different variable name',severity='unknown',disposition='pending')
    async def advisory(body):
        return {'items':[classify(body['findings'][0],disposition='advisory',severity='low',
                                 impact='No effect on the accepted behavior',reason='Naming preference only')]}
    result = asyncio.run(triage_issues([original['description']],[original],request=advisory,on_update=save))
    assert not result['blockers'] and not result['pending'] and result['advisories'][0]['evidence']


@pytest.mark.parametrize('outcome', ['advisory','pending','blocker'])
def test_gate_routes_one_batch_without_spending_repairs_on_unknowns(client, monkeypatch, outcome):
    owner,_ = account(client)
    pid = project(client,owner,mode='team')
    stages, batches = [], []
    base = fake_model([])
    repaired = False
    async def model(*args,**kwargs):
        nonlocal repaired
        stage = args[4]; stages.append(stage)
        if stage == 'team_repair': repaired = True
        if stage == 'team_qa':
            return {'approved':repaired,'summary':'Source reviewed','issues':[] if repaired else ['First finding','Second finding'],
                    'tests':[{'action':'visible','selector':'h1'},{'action':'text','selector':'h1','value':'counter'}]}
        if stage == 'team_qa_triage':
            body = json.loads(args[5][-1]['content']); batches.append(body)
            return {'items':[classify(item,disposition=outcome,type='data',severity='unknown' if outcome=='pending' else 'low' if outcome=='advisory' else 'high',
                                     location='App.jsx',requirement='counter works',reproduction='Load app',expected='counter',actual='fixture',
                                     evidence='Current fixture evidence',impact='No effect on accepted behavior' if outcome=='advisory' else 'Core operation blocked',
                                     reason='Review of fixture scope') for item in body['findings']]}
        return await base(*args,**kwargs)
    async def build(files,tests=None):
        return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS fixture']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    assert len(batches)==1 and len(batches[0]['findings'])==2
    assert stages.count('team_repair') == (1 if outcome=='blocker' else 0)
    assert run['result']['workflow']['metrics']['rework_count'] == (1 if outcome=='blocker' else 0)
    if outcome=='pending':
        assert run['status']=='error' and run['result']['error_code']=='qa_triage_pending'
        qa=run['result']['team']['qa']
        assert len(qa['verification']['pendingIssues'])==2 and not qa.get('verified')
        assert run['result']['draft_files']
        assert not client.get(f'/api/v1/af/projects/{pid}/versions',headers=owner).json()['items']
    else:
        assert run['status']=='done',run.get('error')
        report=run['result']['team']['qa']['verification']
        assert report['triageComplete'] and not report['pendingIssues'] and not report['issues']
        if outcome=='advisory': assert len(report['advisories'])==2


@pytest.mark.parametrize('invalid_diagnosis',[False,True])
def test_failed_assertion_can_be_a_test_defect_but_correction_must_really_execute(client,monkeypatch,invalid_diagnosis):
    owner,_=account(client);pid=project(client,owner,mode='team')
    base=fake_model([]); stages=[]; executions=[]
    async def model(*args,**kwargs):
        stages.append(args[4])
        if args[4]=='team_test_diagnosis':
            if invalid_diagnosis: raise ValueError('Malformed diagnosis JSON')
            return {'verdict':'test_defect','reason':'Wrong text expectation for the current title',
                    'tests':[{'action':'visible','selector':'h1'},{'action':'text','selector':'h1','value':'counter'}]}
        if args[4]=='team_qa_triage' and invalid_diagnosis:
            body=json.loads(args[5][-1]['content'])
            return {'items':[{**item,'disposition':'pending','reason':'Test diagnosis is not confirmed'} for item in body['findings']]}
        return await base(*args,**kwargs)
    async def build(files,tests=None):
        executions.append(tests)
        if len(executions)==2:
            return {'ok':False,'error':'bad assertion','failure':{'kind':'assertion'}}
        return {'ok':True,'artifact':{'js':'verified','css':''}}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    run=wait_run(client,owner,rid)
    if invalid_diagnosis:
        assert run['status']=='error' and run['result']['error_code']=='qa_triage_pending'
        assert 'team_repair' not in stages and not run['result']['team']['qa'].get('verified')
        assert len(executions)==2
        return
    assert run['status']=='done',run.get('error')
    assert len(executions)==3 and stages.count('team_test_diagnosis')==1
    assert 'team_repair' not in stages and run['result']['team']['qa']['verified']
