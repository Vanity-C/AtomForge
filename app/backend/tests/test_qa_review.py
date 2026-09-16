"""A candidate gets a complete review before the next engineering handoff."""
import json

import pytest

from test_demo import account, client
from test_studio import project
from test_team import fake_model, wait_run
from services import studio
from services.qa_review import validate_review


def steps(name):
    return [{'action': 'visible', 'selector': 'h1'}, {'action': 'text', 'selector': 'h1', 'value': name}]


def review(approved=True, issues=None, names=('create', 'persist', 'delete')):
    return {'approved': approved, 'summary': 'Current source inspected', 'issues': issues or [],
            'scenarios': [{'name': name, 'tests': steps(name)} for name in names]}


def launch(client, owner, pid):
    response = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                           json={'mode': 'team', 'instruction': 'counter', 'interactive': False})
    assert response.status_code == 202
    return wait_run(client, owner, response.json()['id'])


def test_review_scenarios_validate_all_steps_and_support_legacy_reports():
    parsed = validate_review(review())
    assert len(parsed['tests']) == 6
    assert validate_review(parsed) == parsed  # Saved reports can resume.
    legacy = validate_review({'approved': True, 'summary': 'ok', 'issues': [], 'tests': steps('counter')})
    assert legacy['scenarios'] == [] and legacy['tests'] == steps('counter')
    many_issues = [f'Independent source defect {i}' for i in range(16)]
    assert validate_review(review(False, many_issues))['issues'] == many_issues


@pytest.mark.parametrize('invalid', [
    {'scenarios': [{'name': 'same', 'tests': steps('one')}, {'name': ' SAME ', 'tests': steps('two')}]},
    {'scenarios': [{'name': 'empty', 'tests': []}]},
    {'scenarios': [{'name': 'bad action', 'tests': [{'action': 'execute'}, {'action': 'visible', 'selector': 'h1'}]}]},
    {'scenarios': [{'name': str(i), 'tests': steps('counter') * 5} for i in range(6)]},
    {'tests': steps('a silently omitted scenario')},
    {'approved': True, 'issues': ['still broken']},
])
def test_invalid_review_never_loses_tests_or_weakens_gates(invalid):
    with pytest.raises(ValueError):
        validate_review({**review(), **invalid})
    with pytest.raises(ValueError):
        validate_review(review(), minimum=8)


def test_source_selftest_and_all_scenarios_are_collected_in_one_repair(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    calls, executions, feedback = [], [], []
    base = fake_model(calls)
    long_issue = ('Persistence defect: ' + 'source evidence ' * 450).strip()
    issues = ['Delete handler missing', ' Delete  handler missing ', long_issue, 'Last finding must not be truncated']
    repaired = False

    async def model(*args, **kwargs):
        nonlocal repaired
        stage = args[4]
        if stage == 'team_repair':
            context = json.loads(args[5][-1]['content'])
            feedback.append(context['repairRequest'])
            # Every scenario was tried before the first repair call.
            assert executions == ['self', 'create', 'persist', 'delete']
            repaired = True
        if stage == 'team_qa':
            return review(repaired, [] if repaired else issues)
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        name = tests[-1].get('value') if tests else 'self'
        executions.append(name)
        if not repaired and name != 'persist':
            return {'ok': False, 'error': name + ' assertion failed', 'failure': {'kind': 'assertion', 'step': 2}, 'logs': ['FAIL ' + name]}
        return {'ok': True, 'artifact': {'js': 'verified', 'css': ''}, 'logs': ['PASS ' + name]}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    run = launch(client, owner, pid)
    assert run['status'] == 'done', run
    assert len(feedback) == 1
    assert feedback[0]['items'] == ['self assertion failed', issues[0], long_issue, issues[3],
                                  '[create] create assertion failed', '[delete] delete assertion failed']
    assert executions == ['self', 'create', 'persist', 'delete'] * 2
    handoffs = [e for e in run['events'] if e.get('role') == 'qa' and e.get('kind') == 'handoff' and e.get('recipient') == 'engineer']
    assert len(handoffs) == 1 and handoffs[0]['output']['items'] == feedback[0]['items']
    assert run['result']['workflow']['metrics']['rework_count'] == 1
    qa = run['result']['team']['qa']
    assert qa['verified'] and qa['verification']['complete'] and qa['verification']['issues'] == []
    assert [item['status'] for item in qa['verification']['scenarios']] == ['passed'] * 3
    assert len(client.get(f'/api/v1/af/projects/{pid}/versions', headers=owner).json()['items']) == 1


def test_all_scenarios_run_after_source_rejection_but_never_commit(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    calls, executions = [], []
    base = fake_model(calls, max_repairs=0)

    async def model(*args, **kwargs):
        if args[4] == 'team_qa':
            return review(False, ['A real source defect remains'])
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        executions.append(tests)
        return {'ok': True, 'artifact': {'js': 'valid', 'css': ''}, 'logs': []}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    run = launch(client, owner, pid)
    assert run['status'] == 'error' and len(executions) == 4
    qa = run['result']['team']['qa']
    assert not qa.get('verified') and qa['verification']['issues'] == ['A real source defect remains']
    assert [s['status'] for s in qa['verification']['scenarios']] == ['passed'] * 3
    assert client.get(f'/api/v1/af/projects/{pid}/versions', headers=owner).json()['items'] == []


def test_compile_blocker_still_gets_source_review_and_marks_unrun_scenarios(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    calls, executions = [], []
    base = fake_model(calls, max_repairs=0)

    async def model(*args, **kwargs):
        if args[4] == 'team_qa':
            assert json.loads(args[5][-1]['content'])['selfTest']['error'] == 'Syntax error'
            return review(False, ['Missing persistence'])
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        executions.append(tests)
        return {'ok': False, 'error': 'Syntax error', 'logs': []}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    run = launch(client, owner, pid)
    assert run['status'] == 'error' and len(executions) == 1
    report = run['result']['team']['qa']['verification']
    assert report['issues'] == ['Syntax error', 'Missing persistence']
    assert not report['complete'] and [s['status'] for s in report['scenarios']] == ['blocked'] * 3


def test_qa_protocol_error_is_corrected_by_qa_not_engineering(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    calls, reviews = [], []
    base = fake_model(calls)

    async def model(*args, **kwargs):
        if args[4] == 'team_qa':
            reviews.append(True)
            return {**review(), 'scenarios': [{'name': 'invalid', 'tests': [{'action': 'execute'}]}]}
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        return {'ok': True, 'artifact': {'js': 'valid', 'css': ''}}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    run = launch(client, owner, pid)
    assert run['status'] == 'error' and len(reviews) == 2
    assert not any(stage == 'team_repair' for stage, _ in calls)
    assert run['result']['draft_files'] and '验收报告格式' in run['error']


def test_correcting_one_scenario_preserves_and_runs_its_siblings(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    calls, executions = [], []
    base = fake_model(calls)
    corrected = [{'action': 'disabled', 'selector': 'button'}, {'action': 'text', 'selector': 'h1', 'value': 'valid disabled state'}]

    async def model(*args, **kwargs):
        if args[4] == 'team_qa':
            return review(names=('invalid-input', 'persist'))
        if args[4] == 'team_test_diagnosis':
            return {'verdict': 'test_defect', 'reason': 'empty input must disable submit', 'tests': corrected}
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        executions.append(tests)
        if tests == steps('invalid-input'):
            return {'ok': False, 'error': 'disabled button', 'failure': {'kind': 'interaction'}}
        return {'ok': True, 'artifact': {'js': 'valid', 'css': ''}, 'logs': []}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    run = launch(client, owner, pid)
    assert run['status'] == 'done', run
    assert executions == [[], steps('invalid-input'), corrected, steps('persist')]
    qa = run['result']['team']['qa']
    assert qa['tests'] == corrected + steps('persist')
    assert qa['scenarios'][0]['tests'] == corrected and qa['verified']
    assert not any(stage == 'team_repair' for stage, _ in calls)
