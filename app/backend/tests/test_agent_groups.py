"""User-owned rosters, real participant execution, and immutable run identity."""
import asyncio
import copy
import json

from test_demo import client, account
from test_studio import project
from test_team import fake_model, wait_run
from services import studio
from services.agent_profiles import ROLE_IDS, active_team, complete_team, roster, prompt_for

URL = '/api/v1/studio/agents'


def body(value):
    return {key: copy.deepcopy(value[key]) for key in ('agents', 'active', 'revision', 'teams', 'active_team_id')}


def group(group_id, members):
    return {'id': group_id, 'name': group_id, 'description': '我的自由组合', 'color': 'violet', 'member_ids': members}


def configure(client, owner, member_ids):
    data = body(client.get(URL, headers=owner).json())
    data['teams'].append(group('custom-team', member_ids))
    data['active_team_id'] = 'custom-team'
    response = client.put(URL, headers=owner, json=data)
    assert response.status_code == 200, response.text
    return response.json()


def test_multiple_teams_persist_switch_and_remain_account_private(client):
    owner, _ = account(client)
    other, _ = account(client)
    saved = configure(client, owner, ['default-design', 'default-engineer'])
    assert saved['revision'] == 1
    assert set(saved['active'].values()) == {'default-design', 'default-engineer'}
    assert saved['active']['leader'] == 'default-engineer'
    # Repeating GET must not change revision or membership ordering.
    assert body(client.get(URL, headers=owner).json()) == body(saved)
    assert client.get(URL, headers=other).json()['active_team_id'] == 'default-team'
    assert len(client.get(URL, headers=other).json()['teams']) == 1
    data = body(saved)
    data['teams'].append(group('solo-team', ['default-product']))
    data['active_team_id'] = 'solo-team'
    response = client.put(URL, headers=owner, json=data)
    assert response.status_code == 200, response.text
    assert set(response.json()['active'].values()) == {'default-product'}
    assert client.put(URL, headers=owner, json=data).status_code == 409
    switched = body(response.json())
    switched['active_team_id'] = 'default-team'
    response = client.put(URL, headers=owner, json=switched)
    assert response.status_code == 200
    assert response.json()['active'] == {role: 'default-' + role for role in ROLE_IDS}


def test_legacy_custom_assignments_migrate_without_losing_profiles_or_revision(client):
    from core.database import db_manager
    from models.studio import StudioAgentSettings
    owner, _ = account(client)
    uid = client.get('/api/v1/af-auth/me', headers=owner).json()['user']['id']
    original = client.get(URL, headers=owner).json()
    legacy = {key: copy.deepcopy(original[key]) for key in ('agents', 'active')}
    legacy['agents'].append({**legacy['agents'][3], 'id': 'custom-engineer', 'name': '专属搭档'})
    legacy['active']['engineer'] = 'custom-engineer'
    legacy['agents'] = [a for a in legacy['agents'] if a['role'] != 'leader']
    legacy['active'].pop('leader')
    async def insert():
        async with db_manager.session() as db:
            db.add(StudioAgentSettings(owner=str(uid), content=json.dumps(legacy), revision=9))
            await db.commit()
    client.portal.call(insert)
    migrated = client.get(URL, headers=owner).json()
    assert migrated['revision'] == 9
    assert migrated['active_team_id'] == 'preserved-team'
    assert migrated['active']['engineer'] == 'custom-engineer'
    assert migrated['teams'][0]['member_ids'] == original['teams'][0]['member_ids']
    assert 'custom-engineer' in migrated['teams'][1]['member_ids']
    assert migrated['agents'][-2]['name'] == '专属搭档'
    assert client.put(URL, headers=owner, json=body(migrated)).status_code == 200


def test_team_validation_and_agent_deletion_references(client):
    owner, _ = account(client)
    original = body(client.get(URL, headers=owner).json())
    for defect in ('remove-default', 'empty-default', 'duplicate-default-member', 'missing-default-member', 'duplicate-team', 'missing-active', 'missing-member', 'duplicate-member', 'empty', 'too-many', 'unknown-color'):
        data = copy.deepcopy(original)
        data['teams'].append(group('custom-team', ['default-engineer']))
        if defect == 'remove-default': data['teams'].pop(0)
        if defect == 'empty-default': data['teams'][0]['member_ids'] = []
        if defect == 'duplicate-default-member': data['teams'][0]['member_ids'].append('default-engineer')
        if defect == 'missing-default-member': data['teams'][0]['member_ids'] = ['missing']
        if defect == 'duplicate-team': data['teams'].append(copy.deepcopy(data['teams'][1]))
        if defect == 'missing-active': data['active_team_id'] = 'missing'
        if defect == 'missing-member': data['teams'][1]['member_ids'] = ['missing']
        if defect == 'duplicate-member': data['teams'][1]['member_ids'] *= 2
        if defect == 'empty': data['teams'][1]['member_ids'] = []
        if defect == 'too-many': data['teams'] += [group('team-' + str(n), ['default-engineer']) for n in range(11)]
        if defect == 'unknown-color': data['teams'][1]['color'] = 'neon'
        assert client.put(URL, headers=owner, json=data).status_code == 422, defect
    original['agents'].append({**original['agents'][3], 'id': 'extra-engineer', 'name': '另一位工程师'})
    original['teams'].append(group('custom-team', ['default-engineer', 'extra-engineer']))
    original['active_team_id'] = 'custom-team'
    response = client.put(URL, headers=owner, json=original)
    assert response.status_code == 200, response.text
    data = body(response.json())
    data['agents'].pop()
    assert client.put(URL, headers=owner, json=data).status_code == 422
    data['teams'][1]['member_ids'].remove('extra-engineer')
    assert client.put(URL, headers=owner, json=data).status_code == 200


def test_default_team_roster_is_editable_and_persisted_without_resetting_library(client):
    owner, _ = account(client)
    original = client.get(URL, headers=owner).json()
    assert len(original['teams'][0]['member_ids']) == 6
    data = body(original)
    custom = {**data['agents'][3], 'id': 'my-team-partner', 'name': '新搭档'}
    data['agents'].append(custom)
    data['teams'][0].update(name='我的首选阵容', color='sky', member_ids=[custom['id'], 'default-design'])
    response = client.put(URL, headers=owner, json=data)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['active_team_id'] == 'default-team'
    assert set(saved['active'].values()) == {custom['id'], 'default-design'}
    assert len(saved['agents']) == 7
    assert all(any(agent['id'] == 'default-' + role for agent in saved['agents']) for role in ROLE_IDS)
    assert len(saved['defaults']['teams'][0]['member_ids']) == 6
    loaded = client.get(URL, headers=owner).json()
    assert loaded['teams'][0] == saved['teams'][0]
    assert loaded['revision'] == saved['revision']
    # Switching back from another team uses the saved default roster.
    changed = body(loaded)
    changed['teams'].append(group('another-team', ['default-qa']))
    changed['active_team_id'] = 'another-team'
    switched = client.put(URL, headers=owner, json=changed).json()
    changed = body(switched)
    changed['teams'].pop()
    changed['active_team_id'] = 'default-team'
    switched = client.put(URL, headers=owner, json=changed).json()
    assert switched['teams'][0]['member_ids'] == [custom['id'], 'default-design']
    assert set(switched['active'].values()) == {custom['id'], 'default-design'}
    changed = body(switched)
    changed['teams'][0]['member_ids'] = ['default-design', custom['id']]
    reordered = client.put(URL, headers=owner, json=changed).json()
    assert [person['id'] for person in roster(active_team(reordered))] == ['default-design', custom['id']]
    changed = body(reordered)
    changed['agents'] = [a for a in changed['agents'] if a['id'] != custom['id']]
    assert client.put(URL, headers=owner, json=changed).status_code == 422
    changed['teams'][0]['member_ids'] = ['default-design']
    assert client.put(URL, headers=owner, json=changed).status_code == 200


def test_default_team_uses_same_member_count_limits_as_custom_teams(client):
    owner, _ = account(client)
    data = body(client.get(URL, headers=owner).json())
    extras = [{**data['agents'][3], 'id': 'extra-' + str(index)} for index in range(7)]
    data['agents'].extend(extras)
    data['teams'][0]['member_ids'].extend(a['id'] for a in extras[:6])
    response = client.put(URL, headers=owner, json=data)
    assert response.status_code == 200, response.text
    changed = body(response.json())
    changed['teams'][0]['member_ids'].append(extras[6]['id'])
    assert client.put(URL, headers=owner, json=changed).status_code == 422


def test_restore_default_profiles_keeps_edited_default_roster_and_run_snapshot(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    data = body(client.get(URL, headers=owner).json())
    data['agents'][3]['name'] = '本轮工程师'
    data['teams'][0]['member_ids'] = ['default-engineer', 'default-design']
    saved = client.put(URL, headers=owner, json=data).json()
    async def pause(*args): await asyncio.sleep(60)
    monkeypatch.setattr(studio, 'execute', pause)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
        json={'instruction': 'counter', 'mode': 'team'}).json()['id']
    # This is the page's profile-only reset: restore templates, keep team config.
    reset = body(saved)
    templates = {a['id']: a for a in saved['defaults']['agents']}
    reset['agents'] = [templates.get(a['id'], a) for a in reset['agents']]
    response = client.put(URL, headers=owner, json=reset)
    assert response.status_code == 200, response.text
    restored = client.get(URL, headers=owner).json()
    assert restored['teams'] == saved['teams']
    assert restored['active_team_id'] == 'default-team'
    assert restored['active'] == saved['active']
    assert next(a for a in restored['agents'] if a['id'] == 'default-engineer')['name'] == 'Neo'
    changed = body(restored)
    changed['teams'][0]['member_ids'] = ['default-qa']
    assert client.put(URL, headers=owner, json=changed).status_code == 200
    run = client.get('/api/v1/studio/runs/' + rid, headers=owner).json()
    assert [a['id'] for a in roster(run['agents'])] == ['default-engineer', 'default-design']
    assert run['agents']['engineer']['name'] == '本轮工程师'
    assert client.delete('/api/v1/studio/runs/' + rid, headers=owner).status_code == 200


def test_malformed_legacy_payloads_are_validation_errors(client):
    owner, _ = account(client)
    original = client.get(URL, headers=owner).json()
    for defect in ('missing-agent-id', 'missing-agent-role', 'null-agents', 'invalid-active'):
        data = {key: copy.deepcopy(original[key]) for key in ('agents', 'active', 'revision')}
        if defect == 'missing-agent-id': data['agents'][0].pop('id')
        if defect == 'missing-agent-role': data['agents'][0].pop('role')
        if defect == 'null-agents': data['agents'] = None
        if defect == 'invalid-active': data['active']['engineer'] = []
        assert client.put(URL, headers=owner, json=data).status_code == 422, defect


def test_snapshot_contains_only_selected_roster_and_preserves_user_order(client):
    owner, _ = account(client)
    data = body(client.get(URL, headers=owner).json())
    data['agents'].append({**data['agents'][3], 'id': 'second-engineer', 'name': 'Second'})
    data['teams'].append(group('duo', ['second-engineer', 'default-engineer']))
    data['active_team_id'] = 'duo'
    saved = client.put(URL, headers=owner, json=data).json()
    team = active_team(saved)
    assert [a['id'] for a in roster(team)] == ['second-engineer', 'default-engineer']
    assert set(p['id'] for p in complete_team(team).values()) == {'second-engineer', 'default-engineer'}
    assert team['engineer']['id'] == 'second-engineer'
    assert team['product']['id'] == 'default-engineer'
    system = prompt_for('leader', team)
    assert 'Milo' not in system and 'Atlas' not in system and 'Luna' not in system
    assert 'Second' in system and 'Neo' in system


def test_team_switch_and_profile_changes_do_not_rewrite_run_or_member_history(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    saved = configure(client, owner, ['default-engineer'])
    async def pause(*args): await asyncio.sleep(60)
    monkeypatch.setattr(studio, 'execute', pause)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner, json={'instruction': 'counter', 'mode': 'team'}).json()['id']
    data = body(saved)
    data['active_team_id'] = 'default-team'
    data['agents'][3]['name'] = '后来的名字'
    assert client.put(URL, headers=owner, json=data).status_code == 200
    run = client.get('/api/v1/studio/runs/' + rid, headers=owner).json()
    assert {p['id'] for p in run['agents'].values()} == {'default-engineer'}
    assert run['agents']['leader']['name'] == 'Neo'
    async def record(): await studio.event(rid, 'design', '已经整理交互方案', role='design')
    client.portal.call(record)
    history = client.get(f'/api/v1/studio/projects/{pid}/conversations?role=member:default-engineer', headers=owner).json()
    assert any(r['content'] == '已经整理交互方案' for r in history['items'])
    assert history['teams'][rid]['design']['name'] == 'Neo'
    other_member = client.get(f'/api/v1/studio/projects/{pid}/conversations?role=member:default-design', headers=owner).json()
    assert not any(r['content'] == '已经整理交互方案' for r in other_member['items'])
    assert client.delete('/api/v1/studio/runs/' + rid, headers=owner).status_code == 200


def test_same_role_colleague_has_own_chat_identity(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner)
    data = body(client.get(URL, headers=owner).json())
    data['agents'].append({**data['agents'][3], 'id': 'colleague', 'name': '另一位伙伴'})
    data['teams'].append(group('duo', ['default-engineer', 'colleague', 'default-leader']))
    data['active_team_id'] = 'duo'
    assert client.put(URL, headers=owner, json=data).status_code == 200
    async def model(*args, **kwargs):
        assert kwargs['agent_team']['engineer']['id'] == 'colleague'
        return {'answer': '我是另一位伙伴，这是我的建议。', 'plan': []}
    monkeypatch.setattr(studio, 'model_call', model)
    response = client.post(f'/api/v1/studio/projects/{pid}/conversations', headers=owner,
        json={'role': 'member:colleague', 'content': '你的建议呢？'})
    assert response.status_code == 200, response.text
    rows = client.get(f'/api/v1/studio/projects/{pid}/conversations?role=member:colleague', headers=owner).json()['items']
    assert rows[-1]['sender'] == 'member:colleague'
    assert rows[-1]['detail']['agent']['name'] == '另一位伙伴'
    assert client.post(f'/api/v1/studio/projects/{pid}/conversations', headers=owner,
        json={'role': 'member:default-design', 'content': 'hello'}).status_code == 400


def test_extra_selected_colleague_is_on_card_without_mandatory_leader_consultation(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    data = body(client.get(URL, headers=owner).json())
    data['agents'].append({**data['agents'][3], 'id': 'specialist', 'name': 'Specialist'})
    data['teams'].append(group('expanded', [a['id'] for a in data['agents']]))
    data['active_team_id'] = 'expanded'
    assert client.put(URL, headers=owner, json=data).status_code == 200
    base = fake_model([])
    called = []
    async def model(*args, **kwargs):
        context = json.loads(args[5][-1]['content'])
        if kwargs.get('agent_team'):
            assert kwargs['agent_team']['engineer']['id'] == 'specialist'
            called.append('specialist')
            return {'summary': '先确认边界', 'items': ['明确空状态行为']}
        if args[4] == 'team_leader':
            assert 'memberAdvice' not in context
            called.append('leader')
        return await base(*args, **kwargs)
    async def build(*args, **kwargs): return {'ok': True, 'artifact': {'js': 'ok', 'css': ''}, 'logs': []}
    monkeypatch.setattr(studio, 'model_call', model)
    monkeypatch.setattr(studio, 'runner_build', build)
    rid = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner,
        json={'instruction': 'counter', 'mode': 'team', 'interactive': False}).json()['id']
    run = wait_run(client, owner, rid)
    assert run['status'] == 'done', run
    assert called == ['leader']
    engineer=next(card for card in run['result']['workflow']['cards'] if card['role']=='engineer')
    assert 'specialist' in engineer['collaborators']
    assert not any(event.get('role') == 'member:specialist' for event in run['events'])
