import base64
import uuid
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from PIL import Image
from test_demo import client

ROOT = '/api/v1/af-auth'
PASSWORD = 'ProfileTest123!'


@pytest.fixture(autouse=True)
def clear_auth_quota(client):
    middleware = client.app.middleware_stack
    while middleware:
        if hasattr(middleware, 'auth_requests'):
            middleware.auth_requests.clear()
        middleware = getattr(middleware, 'app', None)


def register(client, username=None):
    data = {'username': username or 'user_' + uuid.uuid4().hex[:12], 'email': uuid.uuid4().hex + '@example.test', 'password': PASSWORD}
    response = client.post(ROOT + '/register', json=data)
    assert response.status_code == 200, response.text
    return {'X-AtomForge-Token': response.json()['access_token']}, response.json()['user'], data


def avatar(color='blue'):
    output = BytesIO()
    Image.new('RGB', (320, 180), color).save(output, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()


def test_username_email_login_and_unique_registration(client):
    headers, user, data = register(client, '中文Account_' + uuid.uuid4().hex[:6])
    for identifier in (data['username'].upper(), data['email'].upper(), '  ' + data['username'] + '  '):
        response = client.post(ROOT + '/login', json={'identifier': identifier, 'password': PASSWORD})
        assert response.status_code == 200 and response.json()['user']['id'] == user['id']
    assert client.post(ROOT + '/register', json={**data, 'username': data['username'].lower(), 'email': 'other' + data['email']}).status_code == 409
    assert client.post(ROOT + '/register', json={**data, 'username': 'other_' + data['username'], 'email': data['email'].upper()}).status_code == 409
    assert not client.get(ROOT + '/username-availability', params={'username': data['username']}).json()['available']
    assert client.get(ROOT + '/username-availability', params={'username': data['username']}, headers=headers).json()['available']


def test_update_identity_keeps_account_projects_and_existing_session(client):
    headers, user, data = register(client)
    project = client.post('/api/v1/af/projects', headers=headers, json={'name': 'profile ownership'}).json()['project']
    updated = {'username': 'renamed_' + uuid.uuid4().hex[:10], 'email': 'updated-' + data['email']}
    response = client.patch(ROOT + '/me', headers=headers, json=updated)
    assert response.status_code == 200 and response.json()['user']['id'] == user['id']
    assert client.get(ROOT + '/me', headers=headers).json()['user']['username'] == updated['username']
    for identifier in (updated['username'], updated['email']):
        assert client.post(ROOT + '/login', json={'identifier': identifier, 'password': PASSWORD}).json()['user']['id'] == user['id']
    for identifier in (data['username'], data['email']):
        assert client.post(ROOT + '/login', json={'identifier': identifier, 'password': PASSWORD}).status_code == 401
    assert client.get('/api/v1/af/projects/' + str(project['id']), headers=headers).status_code == 200


def test_conflicting_update_is_atomic_and_owner_scoped(client):
    headers, user, data = register(client)
    other_headers, other, _ = register(client)
    for patch in ({'username': other['username'], 'email': 'new-' + data['email']}, {'username': 'new_' + data['username'], 'email': other['email']}):
        response = client.patch(ROOT + '/me', headers=headers, json={**patch, 'avatar': avatar()})
        assert response.status_code == 409
        current = client.get(ROOT + '/me', headers=headers).json()['user']
        assert (current['username'], current['email'], current['avatar_url']) == (user['username'], user['email'], '')
    assert client.get(ROOT + '/me', headers=other_headers).json()['user']['username'] == other['username']
    assert client.patch(ROOT + '/me', json={'username': 'anon', 'email': 'anon@example.test'}).status_code == 401


def test_avatar_upload_replace_remove_and_invalid_files(client):
    headers, user, _ = register(client)
    profile = {'username': user['username'], 'email': user['email']}
    for color in ('blue', 'red'):
        response = client.patch(ROOT + '/me', headers=headers, json={**profile, 'avatar': avatar(color)})
        assert response.status_code == 200
        value = response.json()['user']['avatar_url']
        decoded = Image.open(BytesIO(base64.b64decode(value.split(',')[1])))
        assert decoded.size == (256, 256) and decoded.format == 'PNG'
        assert client.get(ROOT + '/me', headers=headers).json()['user']['avatar_url'] == value
    for invalid in ('data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,aW52YWxpZA==', 'data:image/png;base64,%%%'):
        assert client.patch(ROOT + '/me', headers=headers, json={**profile, 'avatar': invalid}).status_code == 400
        assert client.get(ROOT + '/me', headers=headers).json()['user']['avatar_url'] == value
    oversized = 'data:image/png;base64,' + base64.b64encode(b'x' * (1024 * 1024 + 1)).decode()
    assert client.patch(ROOT + '/me', headers=headers, json={**profile, 'avatar': oversized}).status_code == 413
    assert client.patch(ROOT + '/me', headers=headers, json={**profile, 'avatar': ''}).json()['user']['avatar_url'] == ''


def test_concurrent_registrations_cannot_claim_same_username(client):
    name = 'race_' + uuid.uuid4().hex[:12]
    def create(number):
        return client.post(ROOT + '/register', json={'username': name, 'email': f'{name}-{number}@example.test', 'password': PASSWORD}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(create, [1, 2])) == [200, 409]


def test_username_validation_and_email_identifier_ambiguity(client):
    for value in ('x', 'bad name', 'email@example.test', 'a' * 41):
        assert client.get(ROOT + '/username-availability', params={'username': value}).status_code == 400
