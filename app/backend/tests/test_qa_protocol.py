"""Regression for missing steps, aggregate limits, resumable QA and SVG protocols."""
import asyncio
import json

import pytest

from test_demo import account, client
from test_studio import project
from test_team import fake_model, wait_run
from services import studio
from services.qa_protocol import MAX_CORRECTIONS, complete_review
from services.qa_review import ReviewProtocolError, validate_review


def steps():
    return [{'action': 'visible', 'selector': 'h1'}, {'action': 'text', 'selector': 'h1', 'value': 'counter'}]


def report(**extra):
    return {'approved': True, 'summary': 'Source inspected', 'issues': [], 'tests': steps(), **extra}


@pytest.mark.parametrize('count', [0, 1, 1001])
def test_invalid_step_count_reports_actual_count(count):
    with pytest.raises(ValueError, match=f'实际收到 {count} 步'):
        validate_review(report(tests=[steps()[0]] * count))


def test_total_budget_is_shared_and_no_tests_are_discarded():
    scenarios = [{'name': str(i), 'tests': steps() * 5} for i in range(6)]
    with pytest.raises(ValueError, match='6 个场景共 60 步'):
        validate_review(report(tests=[], scenarios=scenarios), maximum=48)
    assert sum(len(s['tests']) for s in scenarios) == 60
    assert len(validate_review(report(tests=steps() * 24))['tests']) == 48
    assert len(validate_review(report(tests=[], scenarios=scenarios))['tests']) == 60
    with pytest.raises(ValueError, match='实际收到 2 步'):
        validate_review(report(), minimum=4)


def test_unexecuted_tests_cannot_be_used_as_a_source_rejection():
    with pytest.raises(ValueError, match='源码审查拒绝通过却未列出源码缺陷'):
        validate_review(report(approved=False, summary='Waiting for execution'))
    parsed = validate_review(report(tests=[{'action': 'attached', 'selector': 'svg animateTransform'},
                                         {'action': 'detached', 'selector': 'svg script'}]))
    assert 'verified' not in parsed  # A valid plan is not an executed result.


def test_plan_correction_cannot_erase_source_defects_or_scenarios():
    invalid = report(approved=False, issues=['Missing saved data'], tests=[],
                     scenarios=[{'name': 'persist', 'tests': []}, {'name': 'delete', 'tests': steps()}])
    notices = []
    calls = []

    async def save(raw, details, attempt):
        notices.append(details)

    async def request(repair):
        calls.append(repair)
        assert repair['mode'] == 'tests_only'
        assert repair['requiredScenarioNames'] == ['persist', 'delete']
        # The first correction incorrectly omits a scenario; the second keeps both.
        return report(scenarios=[{'name': n, 'tests': steps()} for n in (['persist'] if len(calls) == 1 else ['persist', 'delete'])], tests=[])

    result = asyncio.run(complete_review(invalid, minimum=2, request=request, on_invalid=save))
    assert len(calls) == 2
    assert result['approved'] is False and result['issues'] == ['Missing saved data']
    assert len(result['tests']) == 4
    assert any('不能遗漏' in note['error'] for note in notices)


def test_invalid_json_during_plan_correction_is_retried_by_qa():
    calls, notices = [], []

    async def save(raw, details, attempt):
        notices.append(details)

    async def request(repair):
        calls.append(repair)
        if len(calls) == 1:
            raise ValueError('模型返回的 JSON 无法解析')
        assert 'JSON' in repair['validationError']
        return {'tests': steps()}

    fixed = asyncio.run(complete_review(report(tests=[]), minimum=2, request=request, on_invalid=save))
    assert fixed['tests'] == steps() and len(calls) == 2
    assert any('JSON' in entry['error'] for entry in notices)


def test_initial_qa_json_failure_cannot_dispatch_engineering(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    stages = []
    base = fake_model(stages)

    async def model(*args, **kwargs):
        if args[4] == 'team_qa':
            raise ValueError('模型返回的 JSON 无法解析')
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        return {'ok': True, 'artifact': {'js': 'verified', 'css': ''}}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                     json={'mode': 'team', 'instruction': 'counter', 'interactive': False}).json()['id']
    failed = wait_run(client, owner, rid)
    assert failed['status'] == 'error' and failed['result']['error_code'] == 'qa_protocol_error'
    assert not any(stage == 'team_repair' for stage, _ in stages)


@pytest.mark.parametrize('initial', [report(tests=[]), report(tests=steps()[:1]),
    report(tests=steps() * 501), report(approved=False, summary='Test not yet executed', issues=[])])
def test_qa_supplements_invalid_report_without_engineering_rework(client, monkeypatch, initial):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    stages, repairs, builds = [], [], []
    base = fake_model(stages)

    async def model(*args, **kwargs):
        if args[4] == 'team_qa':
            context = json.loads(args[5][-1]['content'])
            repairs.append(context)
            if len(repairs) == 1:
                assert context['testContract']['max_total_steps'] == 1000
                return initial
            assert context['diagnostic']['error']
            return report()
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        builds.append(tests)
        return {'ok': True, 'artifact': {'js': 'verified', 'css': ''}}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                     json={'mode': 'team', 'instruction': 'counter', 'interactive': False}).json()['id']
    done = wait_run(client, owner, rid)
    assert done['status'] == 'done', done.get('error')
    assert len(repairs) == 2 and builds == [[], steps()]
    assert 'qa_protocol' not in done['result']
    assert not any(stage == 'team_repair' for stage, _ in stages)


def test_exhausted_report_is_saved_and_retry_only_completes_qa(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    stages, reviews = [], []
    base = fake_model(stages)
    recover = False

    async def model(*args, **kwargs):
        if args[4] == 'team_qa':
            context = json.loads(args[5][-1]['content'])
            reviews.append(context)
            if recover:
                assert context['mode'] == 'tests_only'
                assert context['diagnostic']['tests_count'] == 0
                return {'tests': steps() * 500}
            return report(tests=[])
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        return {'ok': True, 'artifact': {'js': 'verified', 'css': ''}}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                     json={'mode': 'team', 'instruction': 'counter', 'interactive': False}).json()['id']
    failed = wait_run(client, owner, rid)
    assert failed['status'] == 'error' and len(reviews) == MAX_CORRECTIONS + 1
    assert failed['result']['error_code'] == 'qa_protocol_error'
    assert failed['result']['qa_protocol']['diagnostic']['tests_count'] == 0
    assert failed['result']['qa_protocol']['raw']['tests'] == []
    assert client.get(f'/api/v1/af/projects/{pid}/versions', headers=owner).json()['items'] == []
    assert not any(stage == 'team_repair' for stage, _ in stages)
    recover = True
    stages.clear()
    resumed = client.post(f'/api/v1/studio/runs/{rid}/retry', headers=owner)
    assert resumed.status_code == 202
    done = wait_run(client, owner, resumed.json()['id'])
    assert done['status'] == 'done', done.get('error')
    assert not stages  # No product/design/architect/engineering calls on resume.
    assert len(reviews) == MAX_CORRECTIONS + 2
    assert done['result']['team']['qa']['verified']
    assert done['result']['team']['qa']['tests'] == steps() * 500
    assert client.get(f'/api/v1/af/projects/{pid}/files', headers=owner).json()['items'][0]['content'] == failed['result']['draft_files'][0]['content']


def test_known_browser_protocol_error_never_becomes_a_code_repair(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    stages = []
    base = fake_model(stages)

    async def model(*args, **kwargs):
        if args[4] == 'team_test_diagnosis':
            # Even a contradictory model verdict cannot misroute a known protocol error.
            return {'verdict': 'application_defect', 'reason': 'incorrect model diagnosis', 'tests': []}
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        return {'ok': False, 'failure': {'kind': 'protocol'}, 'error': '测试协议错误：SVG 定义节点请使用 attached'}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                     json={'mode': 'team', 'instruction': 'counter', 'interactive': False}).json()['id']
    failed = wait_run(client, owner, rid)
    assert failed['status'] == 'error' and failed['result']['error_code'] == 'qa_protocol_error'
    assert not any(stage == 'team_repair' for stage, _ in stages)
    assert client.get(f'/api/v1/af/projects/{pid}/versions', headers=owner).json()['items'] == []
