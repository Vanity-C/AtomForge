"""Configurable plan limits travel from policy through recovery to execution."""
import asyncio
import json

import httpx
import pytest

from test_demo import account, client
from test_studio import project
from test_team import fake_model, wait_run
from services import studio, test_limits as limits, team_workflow as workflow
from services.browser_tests import validate_tests
from services.qa_protocol import complete_review
from services.qa_review import validate_review


def plan(count):
    return [{'action': 'click', 'selector': f'[data-step="{i}"]'} for i in range(count - 1)] + [
        {'action': 'text', 'selector': 'h1', 'value': 'final assertion'}]


def review(steps):
    return {'approved': True, 'summary': 'Source checked', 'issues': [], 'tests': steps}


def test_default_environment_and_invalid_configuration(monkeypatch):
    monkeypatch.delenv('ATOMFORGE_MAX_TEST_STEPS', raising=False)
    assert limits.configured_max_steps() == 1000
    for raw in ['2', '1500', '10000']:
        monkeypatch.setenv('ATOMFORGE_MAX_TEST_STEPS', raw)
        assert limits.configured_max_steps() == int(raw)
    for raw in ['', '-1', '1', '10001', '2.5', 'true', '１０００']:
        monkeypatch.setenv('ATOMFORGE_MAX_TEST_STEPS', raw)
        with pytest.raises(ValueError):
            limits.configured_max_steps()
    for value in [True, 1, 10001, 2.5, '1000', None]:
        with pytest.raises(ValueError):
            workflow.Policy(max_test_steps=value)


def test_defaults_and_custom_limits_preserve_every_step_and_final_assertion():
    steps = plan(1000)
    assert validate_tests(steps) == steps
    parsed = validate_review(review(steps))
    assert parsed['tests'] == steps and validate_review(parsed) == parsed
    with pytest.raises(ValueError, match='1001'):
        validate_review(review(plan(1001)))
    assert validate_review(review(plan(1500)), maximum=1500)['tests'] == plan(1500)
    with pytest.raises(ValueError, match='最后一步'):
        validate_tests(steps[:-1] + [{'action': 'click', 'selector': 'button'}])
    scenarios = [{'name': str(i), 'tests': plan(250)} for i in range(4)]
    assert len(validate_review({**review([]), 'scenarios': scenarios})['tests']) == 1000
    scenarios[-1]['tests'] = plan(251)
    with pytest.raises(ValueError, match='4 个场景共 1001 步'):
        validate_review({**review([]), 'scenarios': scenarios})
    assert len(scenarios[-1]['tests']) == 251  # Never truncate the caller's plan.


def test_legacy_policy_backfill_does_not_rewrite_history():
    payload = {'workflow': {'policy': {}, 'cards': [], 'created_at': 0}}
    assert workflow.present(payload, 'running')['policy']['max_test_steps'] == 1000
    assert payload['workflow']['policy'] == {}


def test_qa_correction_uses_custom_limit_without_losing_steps():
    calls = []
    async def save(raw, details, attempt):
        assert details['contract']['max_total_steps'] == 1500
    async def request(repair):
        calls.append(repair)
        assert '1500' in repair['instruction']
        return {'tests': plan(1500)}
    result = asyncio.run(complete_review(review(plan(1501)), minimum=2, maximum=1500,
                                        request=request, on_invalid=save))
    assert len(calls) == 1 and result['tests'] == plan(1500)


def test_http_payload_and_timeout_follow_actual_plan(monkeypatch):
    sent, budgets = [], []
    real_client = httpx.AsyncClient
    def handler(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={'ok': True, 'logs': []})
    def client_factory(*args, **kwargs):
        budgets.append(kwargs['timeout'].read)
        return real_client(*args, **kwargs, transport=httpx.MockTransport(handler))
    monkeypatch.setattr(studio.httpx, 'AsyncClient', client_factory)
    async def run():
        assert (await studio.runner_build([], plan(1000)))['ok']
        assert (await studio.runner_build([], plan(1200), maximum=1500))['ok']
        assert not (await studio.runner_build([], plan(1001)))['ok']
    asyncio.run(run())
    assert [p['max_test_steps'] for p in sent] == [1000, 1500]
    assert sent[0]['tests'] == plan(1000) and sent[1]['tests'] == plan(1200)
    assert budgets == [3090, 3690]
    assert limits.test_timeout_seconds(2) == 60
    assert limits.test_timeout_seconds(1000) == 3030
    assert limits.test_timeout_seconds(10000) == 30030


@pytest.mark.parametrize(('maximum', 'count'), [(1000, 1000), (1500, 1200)])
def test_team_snapshots_limit_for_prompts_diagnosis_and_runner(client, monkeypatch, maximum, count):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    uid = client.get('/api/v1/af-auth/me', headers=owner).json()['user']['id']
    base = fake_model([])
    run_ids, builds = [], []
    steps = plan(count)
    async def model(*args, **kwargs):
        run_ids.append(args[2])
        stage = args[4]
        context = json.loads(args[5][-1]['content'])
        if stage == 'team_qa':
            assert context['testContract']['max_total_steps'] == maximum
            return review(steps)
        if stage == 'team_test_diagnosis':
            assert context['testContract']['max_total_steps'] == maximum
            return {'verdict': 'test_defect', 'reason': 'Correct the fixture selector', 'tests': steps}
        result = await base(*args, **kwargs)
        if stage == 'team_leader':
            result['policy']['max_test_steps'] = maximum
        if stage == 'team_code':
            assert context['qualityPolicy']['max_test_steps'] == maximum
            result['tests'] = steps
        return result
    async def build(files, tests=None, **kwargs):
        assert kwargs.get('maximum', limits.MAX_TEST_STEPS) == maximum
        builds.append(tests)
        if len(builds) == 1:
            current = await workflow.policy(run_ids[-1])
            await workflow.update_policy(uid, run_ids[-1], workflow.PolicyChange(
                **{**current.model_dump(), 'max_test_steps': 500}, revision=0, reason='下一轮缩小测试范围'))
            return {'ok': False, 'failure': {'kind': 'interaction'}, 'error': 'fixture selector'}
        return {'ok': True, 'artifact': {'js': 'fixture', 'css': ''}, 'logs': []}
    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                     json={'mode': 'team', 'instruction': 'counter', 'interactive': False}).json()['id']
    result = wait_run(client, owner, rid)
    assert result['status'] == 'done', result.get('error')
    assert builds == [steps, steps, steps]
    assert result['result']['workflow']['policy']['max_test_steps'] == 500
    assert result['result']['team']['qa']['tests'] == steps
    assert result['result']['team']['qa']['verified'] is True
