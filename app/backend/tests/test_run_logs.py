"""Cursor history survives the 160-event cache and concurrent live appends."""
import json
import uuid

from test_demo import account, client
from test_studio import project
from core.database import db_manager
from models.projects import Projects
from models.studio import StudioConversation, StudioRun
from services import studio


def seed_run(client, pid, legacy=False):
    run_id = 'logs-' + uuid.uuid4().hex

    async def seed():
        async with db_manager.session() as db:
            owner = str((await db.get(Projects, pid)).user_id)
            entries = [{'stage': 'plan', 'message': 'old record', 'at': '2026-01-01T00:00:00Z'}] if legacy else []
            db.add(StudioRun(id=run_id, owner=owner, project_id=pid, status='running', events=json.dumps(entries)))
            db.add(StudioConversation(owner=owner, project_id=pid, run_id=run_id, sender='user', content='prompt is not an execution log'))
            await db.commit()
        if not legacy:
            for index in range(235):
                await studio.event(run_id, 'test', f'event-{index:03}', role='qa', state='running')
    client.portal.call(seed)
    return run_id


def test_archive_pagination_and_isolation(client):
    owner, _ = account(client)
    other, _ = account(client)
    run_id = seed_run(client, project(client, owner))
    url = f'/api/v1/studio/runs/{run_id}'
    run = client.get(url, headers=owner).json()
    assert len(run['events']) == 160 and run['events_total'] == 235
    latest = client.get(url + '/events', headers=owner).json()
    assert latest['total'] == 235 and len(latest['items']) == 100 and latest['has_more']
    assert latest['items'][0]['message'] == 'event-135'
    assert latest['items'][-1]['message'] == 'event-234'
    assert latest['items'][0]['stage'] == 'test'

    # New records cannot move the boundary of an older page.
    client.portal.call(studio.event, run_id, 'test', 'new live record')
    seen = list(latest['items'])
    page = latest
    while page['has_more']:
        page = client.get(url + f"/events?before={page['next_before']}", headers=owner).json()
        seen = page['items'] + seen
    assert [entry['message'] for entry in seen] == [f'event-{index:03}' for index in range(235)]
    assert len({entry['id'] for entry in seen}) == 235
    assert client.get(url + '/events', headers=owner).json()['items'][-1]['message'] == 'new live record'
    assert client.get(url + '/events', headers=other).status_code == 404
    assert client.get(url + '/events').status_code == 401
    for query in ('limit=0', 'limit=201', 'before=0', 'before=-1'):
        assert client.get(url + '/events?' + query, headers=owner).status_code == 422


def test_pre_archive_task_preserves_existing_records(client):
    owner, _ = account(client)
    run_id = seed_run(client, project(client, owner), legacy=True)
    result = client.get(f'/api/v1/studio/runs/{run_id}/events', headers=owner).json()
    assert result['total'] == 1 and result['items'][0]['message'] == 'old record'
    assert not result['has_more'] and result['notice']
    client.portal.call(studio.event, run_id, 'test', 'first archived record')
    updated = client.get(f'/api/v1/studio/runs/{run_id}/events', headers=owner).json()
    assert [item['message'] for item in updated['items']] == ['old record', 'first archived record']


def test_repair_feedback_is_readable_after_verification_and_private(client):
    owner, _ = account(client)
    other, _ = account(client)
    run_id = seed_run(client, project(client, owner), legacy=True)

    async def feedback():
        await studio.event(run_id, 'repair', '汇总 1 项问题', role='qa', kind='handoff', recipient='engineer',
                           output={'attempt': 1, 'summary': '完整反馈', 'items': ['Old defect description']})
        await studio.event(run_id, 'test', '通过', role='qa', state='done')
        await studio.change(run_id, status='done', result={'team': {'qa': {'verified': True, 'issues': []}}})
    client.portal.call(feedback)
    url = f'/api/v1/studio/runs/{run_id}/qa-reports'
    result = client.get(url, headers=owner).json()
    assert len(result['items']) == 1
    assert result['items'][0]['output']['issues'] == ['Old defect description']
    assert result['items'][0]['output']['issueDetails'][0]['severity'] == 'unknown'
    assert client.get(url, headers=other).status_code == 404
    assert client.get(url).status_code == 401
