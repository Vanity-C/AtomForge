"""Covers cannot leak projects or silently show an older code version."""
import json

from test_demo import client, account
from test_studio import project
from core.database import db_manager
from models.studio import StudioArtifact
from services import project_thumbnails, studio

IMAGE = 'data:image/jpeg;base64,/9j/test-image'
FILES = [{'path': 'App.jsx', 'content': 'export default function App(){return <h1>Actual project</h1>}'}]


def saved_project(client, owner):
    pid = project(client, owner)
    assert client.post(f'/api/v1/af/projects/{pid}/files', headers=owner, json={'files': FILES}).status_code == 200
    return pid, f'/api/v1/af/projects/{pid}/thumbnail'


def seed_artifact(client, pid, version=1, thumbnail=None):
    async def seed():
        async with db_manager.session() as db:
            content = {'js': 'compiled actual source', 'css': ''}
            if thumbnail: content['thumbnail'] = thumbnail
            db.add(StudioArtifact(project_id=pid, version=version, content=json.dumps(content)))
            await db.commit()
    client.portal.call(seed)


def test_cached_cover_stays_private_including_public_projects(client, monkeypatch):
    owner, _ = account(client)
    other, _ = account(client)
    pid, url = saved_project(client, owner)
    seed_artifact(client, pid, thumbnail=IMAGE)
    client.post(f'/api/v1/af/projects/{pid}/share', headers=owner)
    assert client.get(url).status_code == 401
    assert client.get(url, headers=other).status_code == 404
    response = client.get(url, headers=owner)
    assert response.json() == {'status': 'ready', 'version': 1, 'src': IMAGE}
    assert response.headers['Cache-Control'] == 'private, no-store'


def test_legacy_artifact_is_captured_once_and_version_change_never_reuses_it(client, monkeypatch):
    owner, _ = account(client)
    pid, url = saved_project(client, owner)
    seed_artifact(client, pid)
    calls = []
    async def capture(artifact):
        calls.append(artifact)
        return IMAGE
    monkeypatch.setattr(project_thumbnails, 'capture_artifact', capture)
    assert client.get(url, headers=owner).json()['src'] == IMAGE
    assert client.get(url, headers=owner).json()['src'] == IMAGE
    assert len(calls) == 1
    next_image = IMAGE + '-v2'
    async def build(files):
        assert files[0]['content'] == FILES[0]['content']
        return {'ok': True, 'artifact': {'js': 'new', 'css': '', 'thumbnail': next_image}}
    monkeypatch.setattr(studio, 'runner_build', build)
    client.post(f'/api/v1/af/projects/{pid}/files', headers=owner, json={'files': FILES})
    assert client.get(url, headers=owner).json() == {'status': 'ready', 'version': 2, 'src': next_image}


def test_source_only_project_builds_once_without_a_model_call(client, monkeypatch):
    owner, _ = account(client)
    pid, url = saved_project(client, owner)
    calls = []
    async def build(files):
        calls.append(files)
        return {'ok': True, 'artifact': {'js': 'actual', 'css': '', 'thumbnail': IMAGE}}
    monkeypatch.setattr(studio, 'runner_build', build)
    for _ in range(2): assert client.get(url, headers=owner).json()['src'] == IMAGE
    assert len(calls) == 1
    async def inspect():
        async with db_manager.session() as db:
            row = await db.get(StudioArtifact, pid)
            assert row.version == 1
            assert json.loads(row.content)['thumbnail'] == IMAGE
    client.portal.call(inspect)


def test_version_change_during_capture_returns_changed_not_old_cover(client, monkeypatch):
    from services.af_projects import AfProjectService
    owner, _ = account(client)
    user_id = client.get('/api/v1/af-auth/me', headers=owner).json()['user']['id']
    pid, url = saved_project(client, owner)
    seed_artifact(client, pid)
    async def capture(_):
        async with db_manager.session() as db:
            await AfProjectService(db, user_id).commit_files(pid, FILES, 'new version', '', 'editor')
        return IMAGE
    monkeypatch.setattr(project_thumbnails, 'capture_artifact', capture)
    assert client.get(url, headers=owner).json() == {'status': 'changed', 'version': 2}


def test_empty_and_failed_projects_never_get_fabricated_covers(client, monkeypatch):
    owner, _ = account(client)
    empty = project(client, owner)
    assert client.get(f'/api/v1/af/projects/{empty}/thumbnail', headers=owner).json() == {'status': 'empty', 'version': 0}
    _, url = saved_project(client, owner)
    calls = []
    async def build(files):
        calls.append(files)
        return {'ok': False, 'error': 'invalid application'}
    monkeypatch.setattr(studio, 'runner_build', build)
    for _ in range(2): assert client.get(url, headers=owner).json() == {'status': 'unavailable', 'version': 1}
    assert len(calls) == 1


def test_access_revoked_while_capture_runs_does_not_return_image(client, monkeypatch):
    from sqlalchemy import delete
    from models.studio import StudioMember
    owner, _ = account(client)
    viewer, payload = account(client)
    pid, url = saved_project(client, owner)
    seed_artifact(client, pid)
    assert client.post(f'/api/v1/studio/projects/{pid}/members', headers=owner, json={'email': payload['email'], 'role': 'viewer'}).status_code == 200
    async def capture(_):
        async with db_manager.session() as db:
            await db.execute(delete(StudioMember).where(StudioMember.project_id == pid))
            await db.commit()
        return IMAGE
    monkeypatch.setattr(project_thumbnails, 'capture_artifact', capture)
    assert client.get(url, headers=viewer).status_code == 404


def test_cached_probe_never_builds_or_captures_and_remains_private(client, monkeypatch):
    owner, _ = account(client)
    other, _ = account(client)
    pid, url = saved_project(client, owner)
    async def unexpected(*args):
        raise AssertionError('A cached-only read must never use the runner')
    monkeypatch.setattr(project_thumbnails, 'capture_artifact', unexpected)
    monkeypatch.setattr(studio, 'runner_build', unexpected)
    probe = url + '?cached_only=true'
    # Source-only and legacy artifacts both return promptly without rendering.
    assert client.get(probe, headers=owner).json() == {'status': 'pending', 'version': 1}
    seed_artifact(client, pid)
    assert client.get(probe, headers=owner).json() == {'status': 'pending', 'version': 1}
    assert client.get(probe, headers=other).status_code == 404
    assert client.get(probe).status_code == 401
    async def fill():
        async with db_manager.session() as db:
            row = await db.get(StudioArtifact, pid)
            row.content = json.dumps({'js': 'app', 'thumbnail': IMAGE})
            await db.commit()
    client.portal.call(fill)
    response = client.get(probe, headers=owner)
    assert response.json() == {'status': 'ready', 'version': 1, 'src': IMAGE}
    assert response.headers['Cache-Control'] == 'private, no-store'
    client.post(f'/api/v1/af/projects/{pid}/files', headers=owner, json={'files': FILES})
    assert client.get(probe, headers=owner).json() == {'status': 'pending', 'version': 2}
