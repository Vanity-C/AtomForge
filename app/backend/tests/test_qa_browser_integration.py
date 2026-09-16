"""Opt-in real Chromium integration; mock models, isolated DB, no user projects."""
import json
import os
import time

import pytest

from test_demo import account, client
from test_studio import project
from test_team import fake_model
from services import studio


@pytest.mark.skipif(os.getenv('ATOMFORGE_RUN_QA_BROWSER_INTEGRATION') != '1', reason='Requires the isolated runner')
@pytest.mark.parametrize('wrong_action', ['visible', 'text'])
def test_real_svg_protocol_and_missing_qa_steps_recover_without_code_repair(client, monkeypatch, wrong_action):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    calls, executions, reports = [], [], []
    base = fake_model(calls, max_repairs=0)
    real_build = studio.runner_build
    corrected = [{'action': 'visible', 'selector': '#wheel'},
                 {'action': 'attached', 'selector': '#spin[dur="1s"]'}]
    source = '''export default function App(){return <svg width="200" height="200"><g id="wheel">
    <circle cx="80" cy="80" r="30"/><animateTransform id="spin" attributeName="transform"
    type="rotate" from="0 80 80" to="360 80 80" dur="1s" repeatCount="indefinite"/>
    </g></svg>}'''

    async def model(*args, **kwargs):
        stage = args[4]
        if stage == 'team_code':
            return {'summary': 'SVG candidate', 'files': [{'path': 'App.jsx', 'content': source}],
                    'tests': [{'action': 'visible', 'selector': '#wheel'}, {'action': wrong_action, 'selector': '#spin', 'value':'1s'}]}
        if stage == 'team_repair':
            pytest.fail('A test protocol error must not modify application code')
        if stage == 'team_test_diagnosis':
            context = json.loads(args[5][-1]['content'])
            assert context['failure']['failure']['kind'] == ('protocol' if wrong_action=='visible' else 'assertion')
            return {'verdict': 'test_defect', 'reason': 'SVG definition node does not render; assert actual dur attribute existence', 'tests': corrected}
        if stage == 'team_qa':
            reports.append(json.loads(args[5][-1]['content']))
            if len(reports) == 1:
                return {'approved': False, 'summary': 'Waiting for test execution', 'issues': [], 'tests': []}
            assert reports[-1]['mode'] == 'full_report'
            return {'approved': True, 'summary': 'Source is correct', 'issues': [], 'scenarios': [
                {'name': 'animation definition', 'tests': corrected},
                {'name': 'reload retains definition', 'tests': [{'action': 'reload'}, *corrected]},
            ]}
        return await base(*args, **kwargs)

    async def build(files, tests=None):
        assert files[0]['content'] == source
        result = await real_build(files, tests)
        executions.append(result['ok'])
        return result

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
        json={'mode': 'team', 'instruction': 'SVG animation', 'interactive': False}).json()['id']
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        run = client.get('/api/v1/studio/runs/' + rid, headers=owner).json()
        if run['status'] not in studio.ACTIVE:
            break
        time.sleep(.1)
    assert run['status'] == 'done', run.get('error')
    assert executions == [False, True, True, True] and len(reports) == 2
    assert run['result']['team']['qa']['verified']
    assert run['result']['workflow']['metrics']['rework_count'] == 0


@pytest.mark.skipif(os.getenv('ATOMFORGE_RUN_QA_BROWSER_INTEGRATION') != '1', reason='Requires the isolated runner')
def test_multiple_real_browser_failures_produce_one_complete_repair(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    stages, executions, feedback = [], [], []
    base = fake_model(stages, max_repairs=1)
    real_build = studio.runner_build
    repaired = False
    scenarios = [
        {'name': 'increment', 'tests': [
            {'action': 'click', 'selector': '#increment'},
            {'action': 'text', 'selector': '#count', 'value': 'Count: 1'},
        ]},
        {'name': 'caption', 'tests': [
            {'action': 'visible', 'selector': '#caption'},
            {'action': 'text', 'selector': '#caption', 'value': 'Ready'},
        ]},
        {'name': 'fresh-state', 'tests': [
            {'action': 'visible', 'selector': '#count'},
            {'action': 'text', 'selector': '#count', 'value': 'Count: 0'},
        ]},
    ]

    async def model(*args, **kwargs):
        nonlocal repaired
        stage = args[4]
        if stage in {'team_code', 'team_repair'}:
            if stage == 'team_repair':
                feedback.append(json.loads(args[5][-1]['content'])['repairRequest'])
                assert len(executions) == 4
                repaired = True
            source = '''import {useState} from 'react';
export default function App(){const [count,setCount]=useState(0);return <main>
<h1>Review fixture</h1><p id="count">Count: {count}</p>
<button id="increment" onClick={()=>setCount(count+STEP)}>Increment</button>
<p id="caption">CAPTION</p></main>}'''.replace('STEP', '1' if repaired else '0').replace('CAPTION', 'Ready' if repaired else 'Not available')
            return {'summary': 'All reported defects fixed' if repaired else 'First candidate',
                    'files': [{'path': 'App.jsx', 'content': source}], 'tests': []}
        if stage == 'team_qa':
            return {'approved': repaired, 'summary': 'Source reviewed',
                    'issues': [] if repaired else ['The increment handler leaves the count unchanged'],
                    'scenarios': scenarios}
        return await base(*args, **kwargs)

    async def checked(files, tests=None):
        result = await real_build(files, tests)
        executions.append({'ok': result['ok'], 'tests': tests, 'error': result.get('error', '')})
        return result

    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', checked)
    response = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
        json={'mode': 'team', 'instruction': 'counter', 'interactive': False})
    assert response.status_code == 202
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        run = client.get('/api/v1/studio/runs/' + response.json()['id'], headers=owner).json()
        if run['status'] not in studio.ACTIVE:
            break
        time.sleep(.1)
    assert run['status'] == 'done', run.get('error')
    assert [item['ok'] for item in executions] == [True, False, False, True, True, True, True, True]
    assert len(feedback) == 1 and len(feedback[0]['items']) == 3
    assert any('[increment]' in item for item in feedback[0]['items'])
    assert any('[caption]' in item for item in feedback[0]['items'])
    assert run['result']['workflow']['metrics']['rework_count'] == 1
    assert run['result']['team']['qa']['verified']
    assert len(client.get(f'/api/v1/af/projects/{pid}/versions', headers=owner).json()['items']) == 1
