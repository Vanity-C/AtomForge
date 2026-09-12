import json
from concurrent.futures import ThreadPoolExecutor

from test_demo import client, account
from test_studio import project
from core.database import db_manager
from models.studio import StudioRun, StudioConversation, StudioArtifact, StudioMember, StudioUsage


def test_delete_cleans_team_data_and_new_project_never_reuses_identity(client):
    owner, _ = account(client)
    other, _ = account(client)
    owner_id = client.get('/api/v1/af-auth/me', headers=owner).json()['user']['id']
    other_id = client.get('/api/v1/af-auth/me', headers=other).json()['user']['id']
    old = project(client, owner, mode='team')
    async def seed():
        async with db_manager.session() as db:
            db.add_all([StudioRun(id='old-lifecycle-run', owner=owner_id, project_id=old, status='done', payload=json.dumps({'mode':'team'})), StudioConversation(owner=owner_id, project_id=old, sender='product', content='old private dialogue'), StudioArtifact(project_id=old, version=1, content='{}'), StudioMember(project_id=old, user_id=other_id, role='editor'), StudioUsage(owner=owner_id, project_id=old, run_id='old-lifecycle-run', model='test', stage='test', input_tokens=10)])
            await db.commit()
    client.portal.call(seed)
    assert client.delete(f'/api/v1/af/projects/{old}', headers=owner).status_code == 200
    new = project(client, owner)
    assert new > old
    assert client.get(f'/api/v1/studio/projects/{new}/conversations', headers=owner).json()['items'] == []
    assert client.get(f'/api/v1/studio/projects/{new}/runs', headers=owner).json()['items'] == []
    assert client.get(f'/api/v1/af/projects/{new}/messages', headers=owner).json()['items'] == []
    assert client.get(f'/api/v1/af/projects/{new}', headers=other).status_code == 404
    assert client.get('/api/v1/studio/runs/old-lifecycle-run', headers=owner).status_code == 404
    async def verify():
        from sqlalchemy import select, func
        async with db_manager.session() as db:
            assert await db.get(StudioArtifact, old) is None
            assert await db.scalar(select(func.count()).select_from(StudioConversation).where(StudioConversation.project_id == old)) == 0
            assert await db.scalar(select(func.count()).select_from(StudioUsage).where(StudioUsage.project_id == old)) == 1
    client.portal.call(verify)


def test_new_project_skips_legacy_orphan_ids(client):
    owner, _ = account(client)
    owner_id = client.get('/api/v1/af-auth/me', headers=owner).json()['user']['id']
    async def seed():
        async with db_manager.session() as db:
            db.add(StudioConversation(project_id=9000, owner=owner_id, sender='product', content='legacy orphan'))
            await db.commit()
    client.portal.call(seed)
    new = project(client, owner)
    assert new > 9000
    assert client.get(f'/api/v1/studio/projects/{new}/conversations', headers=owner).json()['items'] == []


def test_mode_is_bound_to_project_and_active_project_cannot_be_deleted(client):
    owner, _ = account(client)
    owner_id = client.get('/api/v1/af-auth/me', headers=owner).json()['user']['id']
    for selected, wrong in [('build','team'), ('team','build')]:
        p = project(client, owner, mode=selected)
        assert client.get(f'/api/v1/af/projects/{p}', headers=owner).json()['project']['agent_mode'] == selected
        assert client.patch(f'/api/v1/af/projects/{p}', headers=owner, json={'agent_mode': wrong}).status_code == 422
        assert client.post(f'/api/v1/studio/projects/{p}/runs', headers=owner, json={'instruction': 'test', 'mode': wrong}).status_code == 409
    async def seed():
        async with db_manager.session() as db:
            db.add(StudioRun(id='waiting-lifecycle-run', owner=owner_id, project_id=p, status='awaiting_input'))
            await db.commit()
    client.portal.call(seed)
    assert client.delete(f'/api/v1/af/projects/{p}', headers=owner).status_code == 409
    assert client.get(f'/api/v1/af/projects/{p}', headers=owner).status_code == 200
    assert client.delete('/api/v1/studio/runs/waiting-lifecycle-run', headers=owner).status_code == 200


def test_parallel_project_creations_have_distinct_empty_workspaces(client):
    owner, _ = account(client)
    with ThreadPoolExecutor(max_workers=3) as executor:
        ids = list(executor.map(lambda _: project(client, owner), range(6)))
    assert len(set(ids)) == 6
    for p in ids:
        assert client.get(f'/api/v1/studio/projects/{p}/conversations', headers=owner).json()['items'] == []
