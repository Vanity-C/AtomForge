"""Repair budget boundaries must never bypass real verification."""
import time
import asyncio
import json
import threading

import pytest
from test_demo import client, account
from test_studio import project
from test_team import fake_model, wait_run
from services import studio
from services.team_workflow import Policy


def test_default_repair_budget_and_bounds():
    assert Policy().max_repairs == 30
    assert Policy(max_repairs=0).max_repairs == 0
    assert Policy(max_repairs=30).max_repairs == 30
    for limit in [-1, 31]:
        with pytest.raises(ValueError):
            Policy(max_repairs=limit)


@pytest.mark.parametrize('pass_after', [3, 30, None])
def test_real_test_failures_repair_until_pass_or_budget_exhausted(client, monkeypatch, pass_after):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    calls, checks = [], []
    base = fake_model(calls)

    async def model(*args, **kwargs):
        output = await base(*args, **kwargs)
        if args[4] == 'team_leader':
            output.pop('policy')  # Exercise the production default, not a test override.
        return output

    async def build(files, tests=None):
        if tests:
            checks.append(tests)
            if pass_after is None or len(checks) <= pass_after:
                return {'ok': False, 'error': 'Independent counter assertion failed'}
        return {'ok': True, 'artifact': {'js': 'verified', 'css': ''}, 'logs': ['PASS']}

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    response = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                          json={'instruction': 'counter', 'mode': 'team', 'interactive': False})
    assert response.status_code == 202
    rid = response.json()['id']
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        run = client.get('/api/v1/studio/runs/' + rid, headers=owner).json()
        if run['status'] not in studio.ACTIVE:
            break
        time.sleep(.1)
    else:
        client.delete('/api/v1/studio/runs/' + rid, headers=owner)
        pytest.fail('Repair budget run did not complete')

    repairs = pass_after if pass_after is not None else 30
    assert [stage for stage, _ in calls].count('team_repair') == repairs
    assert len(checks) == repairs + 1
    assert run['result']['workflow']['policy']['max_repairs'] == 30
    versions = client.get(f'/api/v1/af/projects/{pid}/versions', headers=owner).json()['items']
    if pass_after is None:
        assert run['status'] == 'error', run
        assert '达到修复上限（30 次）' in run['error']
        assert run['result']['draft_files']
        assert not versions
    else:
        assert run['status'] == 'done', run
        assert run['result']['team']['qa']['verified'] is True
        assert len(versions) == 1


@pytest.mark.parametrize('source, expected', [('legacy', 30), ('edited', 2), ('current', 2)])
def test_retry_upgrades_only_legacy_default_and_keeps_draft(client, monkeypatch, source, expected):
    from core.database import db_manager
    from models.studio import StudioRun

    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    monkeypatch.setattr(studio, 'model_call', fake_model([], reject=True, max_repairs=2))

    async def build(*args, **kwargs):
        return {'ok': True, 'artifact': {'js': 'valid', 'css': ''}, 'logs': []}

    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
                      json={'instruction': 'counter', 'mode': 'team', 'interactive': False}).json()['id']
    failed = wait_run(client, owner, rid)
    assert failed['status'] == 'error'

    async def mark_source():
        async with db_manager.session() as db:
            row = await db.get(StudioRun, rid)
            payload = json.loads(row.payload)
            board = payload['workflow']
            if source != 'current':
                board.pop('repair_budget_version')
            if source == 'edited':
                board['policy_history'].append({'reason': 'User chose a lower budget'})
            row.payload = json.dumps(payload)
            await db.commit()

    client.portal.call(mark_source)
    reached_model = threading.Event()

    async def paused(*args, **kwargs):
        reached_model.set()
        await asyncio.sleep(60)

    monkeypatch.setattr(studio, 'model_call', paused)
    response = client.post('/api/v1/studio/runs/' + rid + '/retry', headers=owner)
    assert response.status_code == 202
    next_id = response.json()['id']
    try:
        assert reached_model.wait(10)
        resumed = client.get('/api/v1/studio/runs/' + next_id, headers=owner).json()
        assert resumed['result']['workflow']['policy']['max_repairs'] == expected
        assert resumed['result']['draft_files'] == failed['result']['draft_files']
    finally:
        client.delete('/api/v1/studio/runs/' + next_id, headers=owner)
        assert wait_run(client, owner, next_id)['status'] == 'cancelled'
