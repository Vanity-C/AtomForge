from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit

import pytest
from test_account_profile import client, clear_auth_quota, register, ROOT, PASSWORD
from test_delivery_oauth import configured, login_flow, provider_transfer, provider_connection

NEW_PASSWORD = 'NewPassword456!'


def change(client, headers, current=PASSWORD, new=NEW_PASSWORD):
    return client.post(ROOT + '/password', headers=headers, json={'current_password': current, 'new_password': new})


def test_password_rotation_invalidates_old_sessions_and_preserves_owned_data(client):
    headers, user, data = register(client)
    other, _, _ = register(client)
    project = client.post('/api/v1/af/projects', headers=headers, json={'name': 'keep after password change'}).json()['project']
    second = client.post(ROOT + '/login', json={'identifier': data['username'], 'password': PASSWORD}).json()['access_token']
    response = change(client, headers)
    assert response.status_code == 200
    assert response.json()['user']['has_password'] is True
    assert 'password_hash' not in response.text and NEW_PASSWORD not in response.text
    fresh = {'X-AtomForge-Token': response.json()['access_token']}
    for old in (headers, {'X-AtomForge-Token': second}):
        assert client.get(ROOT + '/me', headers=old).status_code == 401
        assert client.get('/api/v1/af/projects', headers=old).status_code == 401
        assert change(client, old).status_code == 401
    assert client.get(ROOT + '/me', headers=fresh).json()['user']['id'] == user['id']
    assert client.get('/api/v1/af/projects/' + str(project['id']), headers=fresh).status_code == 200
    assert client.get(ROOT + '/me', headers=other).status_code == 200
    assert client.post(ROOT + '/login', json={'identifier': data['email'], 'password': PASSWORD}).status_code == 401
    assert client.post(ROOT + '/login', json={'identifier': data['username'], 'password': NEW_PASSWORD}).status_code == 200


@pytest.mark.parametrize('current,new', [('wrong', NEW_PASSWORD), ('', NEW_PASSWORD), (PASSWORD, PASSWORD), (PASSWORD, 'short1'), (PASSWORD, 'lettersOnly'), (PASSWORD, '123456789'), (PASSWORD, ' NewPass123')])
def test_rejected_changes_leave_password_and_session_intact(client, current, new):
    headers, _, data = register(client)
    assert change(client, headers, current, new).status_code == 400
    assert client.get(ROOT + '/me', headers=headers).status_code == 200
    assert client.post(ROOT + '/login', json={'identifier': data['email'], 'password': PASSWORD}).status_code == 200


def test_password_requires_session_and_rate_limits_guesses(client):
    assert change(client, None).status_code == 401
    headers, _, _ = register(client)
    statuses = [change(client, headers, 'wrong').status_code for _ in range(16)]
    assert 400 in statuses and statuses[-1] == 429


@pytest.mark.parametrize('provider', ['github', 'gitee'])
def test_oauth_user_can_set_first_password_and_keeps_provider_login(client, configured, provider):
    _, callback = login_flow(client, provider, subject='first-password')
    ticket = parse_qs(urlsplit(callback.headers['location']).query)['ticket'][0]
    session = client.post(ROOT + '/oauth/exchange', json={'ticket': ticket}).json()
    assert session['user']['has_password'] is False
    headers = {'X-AtomForge-Token': session['access_token']}
    changed = change(client, headers, '')
    assert changed.status_code == 200
    assert client.post(ROOT + '/login', json={'identifier': session['user']['username'], 'password': NEW_PASSWORD}).status_code == 200
    _, callback = login_flow(client, provider, subject='first-password')
    ticket = parse_qs(urlsplit(callback.headers['location']).query)['ticket'][0]
    assert client.post(ROOT + '/oauth/exchange', json={'ticket': ticket}).json()['user']['id'] == session['user']['id']
    fresh = {'X-AtomForge-Token': changed.json()['access_token']}
    assert change(client, fresh, '', 'AnotherPass789').status_code == 400


def test_concurrent_password_changes_have_one_winner(client):
    headers, _, _ = register(client)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda n: change(client, headers, new=NEW_PASSWORD + str(n)), [1, 2]))
    assert sorted(r.status_code for r in responses)[0] == 200
    assert sum(r.status_code == 200 for r in responses) == 1
    winner = next(r for r in responses if r.status_code == 200)
    assert client.get(ROOT + '/me', headers={'X-AtomForge-Token': winner.json()['access_token']}).status_code == 200


def test_legacy_token_survives_upgrade_but_not_password_change(client):
    from jose import jwt
    from services.af_auth import decode_session_token, _signing_secret, TOKEN_ALGORITHM
    headers, _, _ = register(client)
    claims = decode_session_token(headers['X-AtomForge-Token'])
    del claims['ver']
    legacy = {'X-AtomForge-Token': jwt.encode(claims, _signing_secret(), algorithm=TOKEN_ALGORITHM)}
    assert client.get(ROOT + '/me', headers=legacy).status_code == 200
    assert change(client, legacy).status_code == 200
    assert client.get(ROOT + '/me', headers=legacy).status_code == 401
    # Optional authentication must also reject a revoked token.
    assert all(not p['connected'] for p in client.get(ROOT + '/oauth/providers', headers=legacy).json()['items'])


@pytest.mark.parametrize('stage', ['start', 'exchange', 'transfer'])
def test_password_change_invalidates_pending_oauth_operations(client, configured, stage):
    if stage == 'transfer':
        original, headers, ticket = provider_transfer(client, 'password-transfer', 'netlify')
        current = 'TestPassword123!'
    else:
        headers, _, _ = register(client)
        current = PASSWORD
        if stage == 'start':
            response = client.post(ROOT + '/oauth/gitee/start', headers=headers, json={'purpose': 'connect'})
            ticket = parse_qs(urlsplit(response.json()['url']).query)['state'][0]
        else:
            _, callback = login_flow(client, 'gitee', headers, subject='password-exchange')
            ticket = parse_qs(urlsplit(callback.headers['location']).query)['ticket'][0]
    changed = change(client, headers, current)
    assert changed.status_code == 200
    fresh = {'X-AtomForge-Token': changed.json()['access_token']}
    if stage == 'start':
        response = client.get(ROOT + '/oauth/gitee/callback', params={'state': ticket, 'code': 'unused'}, follow_redirects=False)
        assert 'error=' in response.headers['location']
    else:
        response = client.post(ROOT + '/oauth/' + stage, headers=fresh, json={'ticket': ticket, 'confirm': True})
        assert response.status_code == 400
        if stage == 'transfer':
            assert provider_connection(client, original, 'netlify')['connected']
