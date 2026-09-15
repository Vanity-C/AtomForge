"""Rollback restores a snapshot without appending to or rewriting history."""
from test_demo import account, client


def create_project(client, owner, name='version rollback'):
    response = client.post('/api/v1/af/projects', headers=owner, json={'name': name})
    assert response.status_code == 200
    return f"/api/v1/af/projects/{response.json()['project']['id']}"


def save(client, url, owner, files, expected_version):
    response = client.post(url + '/files', headers=owner, json={
        'files': files, 'source': 'manual_edit', 'expected_version': expected_version,
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_restore_preserves_history_and_future_saves_use_highest_version(client):
    owner, _ = account(client)
    url = create_project(client, owner)
    original = [
        {'path': 'App.tsx', 'content': 'export default function App(){return <h1>one</h1>}', 'language': 'tsx'},
        {'path': 'old.css', 'content': 'h1 { margin: 0; }', 'language': 'css'},
    ]
    changed = [
        {'path': 'App.jsx', 'content': 'export default function App(){return <h1>two</h1>}', 'language': 'jsx'},
        {'path': 'new.css', 'content': 'h1 { margin: 1rem; }', 'language': 'css'},
    ]
    assert save(client, url, owner, original, 0)['version'] == 1
    assert save(client, url, owner, changed, 1)['version'] == 2
    history = client.get(url + '/versions', headers=owner).json()['items']
    latest, first = history
    slug = client.post(url + '/share', headers=owner).json()['project']['share_slug']

    for target, current, expected_files in [(first, 2, original), (first, 1, original), (latest, 1, changed), (first, 2, original)]:
        response = client.post(url + '/rollback', headers=owner, json={
            'version_id': target['id'], 'expected_version': current,
        })
        assert response.status_code == 200, response.text
        restored = response.json()
        assert restored['version'] == target['version']
        assert restored['project']['current_version'] == target['version']
        assert restored['project']['entry_file'] == expected_files[0]['path']
        assert restored['files'] == expected_files
        assert client.get(url + '/versions', headers=owner).json()['items'] == history
        files = client.get(url + '/files', headers=owner).json()['items']
        assert {f['path']: f['content'] for f in files} == {f['path']: f['content'] for f in expected_files}
        assert {f['version'] for f in files} == {target['version']}
        shared = client.get('/api/v1/share/' + slug).json()
        assert {f['path']: f['content'] for f in shared['files']} == {f['path']: f['content'] for f in expected_files}

    saved = save(client, url, owner, original, 1)
    assert saved['version'] == 3
    all_versions = client.get(url + '/versions', headers=owner).json()['items']
    assert [v['version'] for v in all_versions] == [3, 2, 1]
    assert all_versions[1:] == history


def test_rollback_rejects_stale_views_and_unrelated_snapshots(client):
    owner, _ = account(client)
    other, _ = account(client)
    url = create_project(client, owner)
    files = [{'path': 'App.jsx', 'content': 'export default function App(){return null}', 'language': 'jsx'}]
    save(client, url, owner, files, 0)
    snapshot = client.get(url + '/versions', headers=owner).json()['items'][0]
    save(client, url, owner, files, 1)
    history = client.get(url + '/versions', headers=owner).json()['items']

    assert client.post(url + '/rollback', headers=owner, json={
        'version_id': snapshot['id'], 'expected_version': 1,
    }).status_code == 409
    assert client.post(url + '/rollback', headers=other, json={'version_id': snapshot['id']}).status_code == 404
    another = create_project(client, owner, 'another project')
    assert client.post(another + '/rollback', headers=owner, json={'version_id': snapshot['id']}).status_code == 404
    assert client.get(url, headers=owner).json()['project']['current_version'] == 2
    assert client.get(url + '/versions', headers=owner).json()['items'] == history
