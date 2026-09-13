import asyncio
import io
import json
import time
import zipfile
from urllib.parse import parse_qs,urlsplit
from unittest.mock import AsyncMock,patch
import httpx
import pytest
from test_demo import client,account
from services import oauth,delivery,deploying,publishing


@pytest.fixture(autouse=True)
def independent_auth_quota(client):
    # Each scenario exercises real rate guards, without spending the next
    # scenario's allowance on this module's expanded OAuth matrix.
    client.cookies.clear()
    from main import app
    middleware=app.middleware_stack
    while middleware:
        if hasattr(middleware,'auth_requests'):middleware.auth_requests.clear()
        middleware=getattr(middleware,'app',None)

def project(client,owner):
    pid=client.post('/api/v1/af/projects',headers=owner,json={'name':'Delivery test'}).json()['project']['id']
    client.post(f'/api/v1/af/projects/{pid}/files',headers=owner,json={'files':[{'path':'App.jsx','content':'export default function App(){return <h1>Published</h1>}','language':'jsx'}]})
    return pid

@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('ATOMFORGE_PUBLIC_ORIGIN','http://testserver')
    # Production validation forbids arbitrary plain HTTP origins; use a valid local origin.
    monkeypatch.setenv('ATOMFORGE_PUBLIC_ORIGIN','http://127.0.0.1:15173')
    for name in ['GITHUB','GITEE','NETLIFY']:
        monkeypatch.setenv('ATOMFORGE_'+name+'_CLIENT_ID','test-client')
        monkeypatch.setenv('ATOMFORGE_'+name+'_CLIENT_SECRET','test-secret')

def test_provider_configuration_and_pkce(client,configured):
    data=client.get('/api/v1/af-auth/oauth/providers').json()['items']
    assert len(data)==3 and all(x['configured'] for x in data)
    assert 'test-secret' not in json.dumps(data)
    r=client.post('/api/v1/af-auth/oauth/github/start',json={'redirect':'//evil.example'})
    q=parse_qs(urlsplit(r.json()['url']).query)
    assert q['code_challenge_method']==['S256']
    assert 'repo' not in q['scope'][0].split()
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=lax' in r.headers['set-cookie']
    assert client.post('/api/v1/af-auth/oauth/github/start',json={'purpose':'connect'}).status_code==401
    assert client.post('/api/v1/af-auth/oauth/netlify/start',json={}).status_code==400

def token_response():
    return httpx.Response(200,json={'access_token':'private-external-token','scope':'repo'},request=httpx.Request('POST','https://provider/token'))

def login_flow(client,provider,headers=None,subject='123456'):
    r=client.post(f'/api/v1/af-auth/oauth/{provider}/start',headers=headers,json={'purpose':'connect' if headers else 'login','redirect':'/account'})
    state=parse_qs(urlsplit(r.json()['url']).query)['state'][0]
    with patch('services.oauth.httpx.AsyncClient.post',new=AsyncMock(return_value=token_response())),patch('services.oauth.api',new=AsyncMock(return_value={'id':subject,'login':'octo','email':'unverified@example.test'})):
        response=client.get(f'/api/v1/af-auth/oauth/{provider}/callback',params={'state':state,'code':'valid'},follow_redirects=False)
    return state,response

@pytest.mark.parametrize('provider',['github','gitee'])
def test_oauth_login_one_time_exchange_and_identity_reuse(client,configured,provider):
    state,response=login_flow(client,provider)
    ticket=parse_qs(urlsplit(response.headers['location']).query)['ticket'][0]
    assert 'private-external-token' not in response.headers['location']
    exchange=client.post('/api/v1/af-auth/oauth/exchange',json={'ticket':ticket})
    assert exchange.status_code==200
    uid=exchange.json()['user']['id']
    assert exchange.json()['user']['email']!='unverified@example.test'
    assert client.post('/api/v1/af-auth/oauth/exchange',json={'ticket':ticket}).status_code==400
    replay=client.get(f'/api/v1/af-auth/oauth/{provider}/callback',params={'state':state,'code':'same'},follow_redirects=False)
    assert 'error=' in replay.headers['location']
    _,again=login_flow(client,provider)
    ticket=parse_qs(urlsplit(again.headers['location']).query)['ticket'][0]
    assert client.post('/api/v1/af-auth/oauth/exchange',json={'ticket':ticket}).json()['user']['id']==uid


def test_missing_credentials_are_distinguished_from_invalid_origin(client,monkeypatch):
    monkeypatch.setenv('ATOMFORGE_PUBLIC_ORIGIN','http://127.0.0.1:15173')
    for provider in ['github','gitee']:
        monkeypatch.delenv('ATOMFORGE_'+provider.upper()+'_CLIENT_ID',raising=False)
        monkeypatch.delenv('ATOMFORGE_'+provider.upper()+'_CLIENT_SECRET',raising=False)
    rows=client.get('/api/v1/af-auth/oauth/providers').json()['items']
    assert all(not p['configured'] and p['configuration_issue']=='credentials_missing' for p in rows if p['id'] in {'github','gitee'})
    for provider in ['github','gitee']:
        response=client.post(f'/api/v1/af-auth/oauth/{provider}/start',json={})
        assert response.status_code==503 and 'Client ID' in response.json()['detail']
    monkeypatch.setenv('ATOMFORGE_PUBLIC_ORIGIN','https://example.test/path')
    rows=client.get('/api/v1/af-auth/oauth/providers').json()['items']
    assert all(p['configuration_issue']=='origin_missing' for p in rows)


def test_host_mismatch_is_rejected_before_leaving_for_provider(client,configured):
    for provider in ['github','gitee']:
        response=client.post(f'/api/v1/af-auth/oauth/{provider}/start',headers={'Origin':'http://localhost:15173'},json={})
        assert response.status_code==409 and '127.0.0.1:15173' in response.json()['detail']
        assert 'set-cookie' not in response.headers
        response=client.post(f'/api/v1/af-auth/oauth/{provider}/start',headers={'Origin':'http://127.0.0.1:15173'},json={})
        assert response.status_code==200


@pytest.mark.parametrize('provider',['github','gitee'])
def test_token_exchange_uses_exact_callback_and_never_exposes_provider_errors(client,configured,provider):
    started=client.post(f'/api/v1/af-auth/oauth/{provider}/start',json={})
    query=parse_qs(urlsplit(started.json()['url']).query)
    exchange=AsyncMock(return_value=httpx.Response(400,json={'error':'invalid_client','error_description':'private-secret-must-not-leak'}))
    with patch('services.oauth.httpx.AsyncClient.post',new=exchange):
        response=client.get(f'/api/v1/af-auth/oauth/{provider}/callback',params={'code':'sample-code','state':query['state'][0]},follow_redirects=False)
    assert response.status_code==303 and 'error=' in response.headers['location']
    assert 'private-secret' not in response.headers['location']
    data=exchange.call_args.kwargs['data']
    assert data['redirect_uri']==query['redirect_uri'][0]
    assert data['code']=='sample-code' and data['client_secret']=='test-secret'
    assert ('code_verifier' in data)==(provider=='github')

def test_binding_requires_matching_browser_and_preserves_existing_account(client,configured):
    owner,_=account(client)
    owner_id=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    r=client.post('/api/v1/af-auth/oauth/gitee/start',headers=owner,json={'purpose':'connect'})
    state=parse_qs(urlsplit(r.json()['url']).query)['state'][0]
    browser=client.cookies.get('af_oauth_browser');client.cookies.clear()
    r=client.get('/api/v1/af-auth/oauth/gitee/callback',params={'state':state,'code':'valid'},follow_redirects=False)
    assert 'error=' in r.headers['location']
    client.cookies.set('af_oauth_browser',browser,path='/api/v1/af-auth/oauth')
    _,r=login_flow(client,'gitee',owner,subject='linked-456')
    ticket=parse_qs(urlsplit(r.headers['location']).query)['ticket'][0]
    assert client.post('/api/v1/af-auth/oauth/exchange',json={'ticket':ticket}).json()['user']['id']==owner_id
    rows=client.get('/api/v1/af-auth/oauth/providers',headers=owner).json()['items']
    assert next(r for r in rows if r['id']=='gitee')['publish_authorized']
    assert 'private-external-token' not in json.dumps(rows)
    other,_=account(client)
    _,r=login_flow(client,'gitee',other,subject='linked-456')
    ticket=parse_qs(urlsplit(r.headers['location']).query)['ticket'][0]
    assert client.post('/api/v1/af-auth/oauth/exchange',headers=other,json={'ticket':ticket}).json()['status']=='confirmation_required'

def provider_transfer(client,subject,provider):
    original,_=account(client);target,_=account(client)
    login_flow(client,provider,original,subject=subject)
    _,response=login_flow(client,provider,target,subject=subject)
    ticket=parse_qs(urlsplit(response.headers['location']).query)['ticket'][0]
    return original,target,ticket

def provider_connection(client,owner,provider):
    return next(row for row in client.get('/api/v1/af-auth/oauth/providers',headers=owner).json()['items'] if row['id']==provider)

@pytest.mark.parametrize('provider',['github','gitee','netlify'])
def test_provider_transfer_requires_confirmation_then_moves_login_and_publish(client,configured,provider):
    original,target,ticket=provider_transfer(client,'transfer-confirm',provider)
    pid=project(client,original)
    for _ in range(2):
        pending=client.post('/api/v1/af-auth/oauth/exchange',headers=target,json={'ticket':ticket})
        assert pending.status_code==200 and pending.json()['status']=='confirmation_required'
        assert 'access_token' not in pending.text and 'private-external-token' not in pending.text
    assert provider_connection(client,original,provider)['connected']
    assert not provider_connection(client,target,provider)['connected']
    confirmed=client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True})
    assert confirmed.status_code==200 and confirmed.json()['transferred']
    assert not provider_connection(client,original,provider)['connected']
    assert provider_connection(client,target,provider)['publish_authorized']
    assert client.get(f'/api/v1/af/projects/{pid}',headers=original).status_code==200
    assert client.get(f'/api/v1/af/projects/{pid}',headers=target).status_code==404
    original_id=client.get('/api/v1/af-auth/me',headers=original).json()['user']['id']
    target_id=client.get('/api/v1/af-auth/me',headers=target).json()['user']['id']
    async def check_tokens():
        from core.database import db_manager
        from fastapi import HTTPException
        async with db_manager.session() as db:
            with pytest.raises(HTTPException):await oauth.token_for(db,int(original_id),provider)
            assert await oauth.token_for(db,int(target_id),provider)=='private-external-token'
    asyncio.run(check_tokens())
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True}).status_code==400
    if provider=='netlify':return  # Netlify supplies deployment authorization only.
    _,response=login_flow(client,provider,subject='transfer-confirm')
    login_ticket=parse_qs(urlsplit(response.headers['location']).query)['ticket'][0]
    assert client.post('/api/v1/af-auth/oauth/exchange',json={'ticket':login_ticket}).json()['user']['id']==target_id

@pytest.mark.parametrize('provider',['github','gitee','netlify'])
def test_provider_transfer_cancel_preserves_original_and_consumes_ticket(client,configured,provider):
    original,target,ticket=provider_transfer(client,'transfer-cancel',provider)
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':False}).json()['transferred'] is False
    assert provider_connection(client,original,provider)['connected'] and not provider_connection(client,target,provider)['connected']
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True}).status_code==400

@pytest.mark.parametrize('provider',['github','gitee','netlify'])
def test_provider_transfer_requires_initiating_user_and_browser(client,configured,provider):
    original,target,ticket=provider_transfer(client,'transfer-security',provider)
    for headers,expected in [(None,401),(original,403)]:
        assert client.post('/api/v1/af-auth/oauth/transfer',headers=headers,json={'ticket':ticket,'confirm':True}).status_code==expected
    assert client.post('/api/v1/af-auth/oauth/exchange',headers=original,json={'ticket':ticket}).status_code==403
    browser=client.cookies.get('af_oauth_browser');client.cookies.clear()
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True}).status_code==400
    client.cookies.set('af_oauth_browser',browser,path='/api/v1/af-auth/oauth')
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True}).status_code==200

@pytest.mark.parametrize('change',['expiry','reauthorize','target_bound'])
@pytest.mark.parametrize('provider',['github','gitee','netlify'])
def test_provider_transfer_rejects_stale_confirmation(client,configured,provider,change):
    subject='transfer-stale-'+change
    original,target,ticket=provider_transfer(client,subject,provider)
    if change=='expiry':
        async def expire():
            from core.database import db_manager
            from models.delivery import OAuthFlow
            async with db_manager.session() as db:
                row=await db.get(OAuthFlow,oauth.digest(ticket));row.expires=0;await db.commit()
        asyncio.run(expire())
    elif change=='reauthorize':login_flow(client,provider,original,subject=subject)
    else:login_flow(client,provider,target,subject=subject+'-other')
    response=client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True})
    assert response.status_code==(400 if change=='expiry' else 409)
    assert provider_connection(client,original,provider)['connected']

@pytest.mark.parametrize('provider',['github','gitee','netlify'])
def test_provider_competing_transfers_only_one_can_win(client,configured,provider):
    original,target,ticket=provider_transfer(client,'transfer-competing',provider)
    other,_=account(client)
    _,response=login_flow(client,provider,other,subject='transfer-competing')
    other_ticket=parse_qs(urlsplit(response.headers['location']).query)['ticket'][0]
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True}).status_code==200
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=other,json={'ticket':other_ticket,'confirm':True}).status_code==409
    assert provider_connection(client,target,provider)['connected']
    assert not provider_connection(client,original,provider)['connected'] and not provider_connection(client,other,provider)['connected']

@pytest.mark.parametrize('provider',['github','gitee','netlify'])
def test_provider_transfer_waits_for_running_publish_then_can_retry(client,configured,provider):
    original,target,ticket=provider_transfer(client,'transfer-running',provider)
    pid=project(client,original)
    async def queued_job():
        from core.database import db_manager
        from models.delivery import Delivery
        from services.af_auth import decode_session_token
        job_id='transfer-running-'+provider
        async with db_manager.session() as db:
            db.add(Delivery(id=job_id,project_id=pid,owner=int(decode_session_token(original['X-AtomForge-Token'])['sub']),kind='deploy' if provider=='netlify' else 'publish',provider=provider,version=1,created=time.time()))
            await db.commit()
        return {'id':job_id}
    job=asyncio.run(queued_job())
    response=client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True})
    assert response.status_code==409 and '发布完成' in response.json()['detail']
    assert provider_connection(client,original,provider)['connected']
    asyncio.run(delivery.progress(job['id'],'done',status='done'))
    assert client.post('/api/v1/af-auth/oauth/transfer',headers=target,json={'ticket':ticket,'confirm':True}).status_code==200

def test_delivery_ownership_credentials_and_build_gate(client):
    owner,_=account(client);other,_=account(client);pid=project(client,owner)
    url=f'/api/v1/delivery/projects/{pid}'
    assert client.get(url,headers=other).status_code==404
    assert client.post(url,headers=owner,json={'kind':'deploy','provider':'github'}).status_code==422
    assert client.post(url,headers=owner,json={'kind':'deploy','provider':'netlify'}).status_code==409
    c=f'/api/v1/connections/projects/{pid}'
    assert client.put(c,headers=owner,json={'netlify_token':'secret-netlify','gitee_token':'secret-gitee'}).status_code==200
    view=client.get(c,headers=owner)
    assert view.json()['netlify_token_configured'] and 'secret-netlify' not in view.text and 'secret-gitee' not in view.text
    assert client.post(url,headers=owner,json={'kind':'deploy','provider':'netlify'}).status_code==409
    with patch('services.delivery.launch'):
        first=client.post(url,headers=owner,json={'kind':'publish','provider':'gitee','name':'my-project'})
        assert first.status_code==200,first.text
        job=first.json()
        assert job['status']=='queued'
        assert client.post(url,headers=owner,json={'kind':'publish','provider':'gitee','name':'my-project'}).status_code==409
        assert client.delete(f'/api/v1/af/projects/{pid}',headers=owner).status_code==409
    async def inspect_snapshot():
        from core.database import db_manager
        from models.delivery import Delivery
        async with db_manager.session() as db:
            row=await db.get(Delivery,job['id']);payload=json.loads(row.request)
            assert 'package.json' in {f['path'] for f in payload['files']}
            assert 'secret-gitee' not in row.request
    asyncio.run(inspect_snapshot())
    asyncio.run(delivery.progress(job['id'],'interrupted',status='interrupted'))
    with patch('services.delivery.launch'):
        retried=client.post(url+'/'+job['id']+'/retry',headers=owner)
        assert retried.status_code==200 and retried.json()['id']!=job['id']

def test_standalone_bundle_contains_runtime_no_workspace_secrets_and_checks_cloud(monkeypatch):
    archive=deploying.bundle({'js':'console.log("app")','css':'body{color:red}'},'<Test>','job-123')
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert set(z.namelist())=={'index.html','app.js','app.css','cloud.js','_headers','_redirects'}
        assert '&lt;Test&gt;' in z.read('index.html').decode()
        assert 'import.meta.env' not in z.read('cloud.js').decode()
        assert 'atomforge-cloud-response' in z.read('cloud.js').decode()
        assert b'/* /index.html 200' in z.read('_redirects')
    monkeypatch.setenv('ATOMFORGE_PUBLIC_ORIGIN','http://127.0.0.1:15173')
    with pytest.raises(Exception,match='409'):deploying.bundle({'js':'app'},'Title','job','cloud-slug')
    monkeypatch.setenv('ATOMFORGE_PUBLIC_ORIGIN','https://forge.example.com')
    with zipfile.ZipFile(io.BytesIO(deploying.bundle({'js':'app'},'Title','job','cloud-slug'))) as z:
        assert b'https://forge.example.com/api/v1/cloud/:splat' in z.read('_redirects')

def test_github_publish_is_one_commit_and_never_moves_default_branch():
    calls=[]
    async def fake(provider,token,method,path,**kw):
        calls.append((method,path,kw))
        if path=='/user/repos':return {'full_name':'owner/app','default_branch':'main'}
        if '/git/ref/heads/' in path:return {'object':{'sha':'parent'}}
        return {'sha':'new'}
    with patch('services.publishing.api',new=fake):
        result=asyncio.run(publishing.publish('github','token',[{'path':'App.jsx','content':'hello'}],'','app',True,'atomforge-v1-id','v1',AsyncMock()))
    assert result['url'].endswith('/tree/atomforge-v1-id')
    assert not any(m=='PATCH' for m,p,k in calls)
    assert calls[-1][2]['json']['ref']=='refs/heads/atomforge-v1-id'

def test_gitee_upload_uses_isolated_branch_and_reports_progress():
    calls=[]
    async def fake(provider,token,method,path,**kw):
        calls.append((method,path,kw))
        if path=='/repos/owner/app':return {'default_branch':'master'}
        if '/git/trees/' in path:return {'tree':[{'path':'README.md','type':'blob','sha':'old'}]}
        return {}
    progress=AsyncMock()
    with patch('services.publishing.api',new=fake):
        asyncio.run(publishing.publish('gitee','token',[{'path':'README.md','content':'new'}],'owner/app','',True,'atomforge-v1-id','v1',progress))
    assert calls[1][2]['json']['branch_name']=='atomforge-v1-id'
    assert calls[-1][0]=='PUT' and calls[-1][2]['json']['sha']=='old'

def test_netlify_resume_verifies_before_promotion_and_reuses_deploy():
    sequence=[]
    async def fake(provider,token,method,path,**kwargs):
        sequence.append((method,path))
        if path=='/deploys/deploy1':return {'state':'ready','deploy_ssl_url':'https://deploy1--app.netlify.app'}
        return {'id':'site1','name':'app'}
    async def verify(url,marker):sequence.append(('verify',url))
    with patch('services.deploying.api',new=fake),patch('services.deploying.verify_public',new=verify):
        archive=deploying.bundle({'js':'app'},'Title','marker')
        result=asyncio.run(deploying.deploy('token',archive,1,'marker',{'site_id':'site1','deploy_id':'deploy1'},AsyncMock()))
    assert result['url']=='https://app.netlify.app'
    promote=sequence.index(('POST','/sites/site1/deploys/deploy1/restore'))
    assert sequence[promote-1][0]=='verify' and sequence[-1][0]=='verify'
    assert not any(p.endswith('/deploys') and m=='POST' for m,p in sequence)

def test_verification_rejects_untrusted_or_local_destinations():
    for value in ['http://localhost','https://netlify.app.attacker.test','https://x.netlify.app@127.0.0.1','https://x.netlify.app:9999']:
        with pytest.raises(Exception):deploying.netlify_url(value)

@pytest.mark.parametrize('status,message',[(401,'需要登录或密码'),(403,'访问保护或防火墙')])
def test_public_verification_reports_access_protection_without_retry(status,message):
    from fastapi import HTTPException
    transport=httpx.MockTransport(lambda request:httpx.Response(status,text='<title>Login Redirect</title>'))
    real_client=httpx.AsyncClient
    with patch('services.deploying.httpx.AsyncClient',side_effect=lambda **kwargs:real_client(transport=transport,**kwargs)),patch('services.deploying.asyncio.sleep',new=AsyncMock()) as sleep:
        with pytest.raises(HTTPException,match=message):
            asyncio.run(deploying.verify_public('https://app.netlify.app','marker'))
    sleep.assert_not_awaited()

def test_public_verification_retries_transient_response_and_requires_current_version():
    responses=iter([httpx.Response(503),httpx.Response(200,text='<meta content="old-marker">'),httpx.Response(200,text='<meta content="marker">')])
    transport=httpx.MockTransport(lambda request:next(responses))
    real_client=httpx.AsyncClient
    with patch('services.deploying.httpx.AsyncClient',side_effect=lambda **kwargs:real_client(transport=transport,**kwargs)),patch('services.deploying.asyncio.sleep',new=AsyncMock()) as sleep:
        asyncio.run(deploying.verify_public('https://app.netlify.app','marker'))
    assert sleep.await_count==2

def test_public_verification_rejects_wrong_version_with_actionable_error():
    from fastapi import HTTPException
    transport=httpx.MockTransport(lambda request:httpx.Response(200,text='<meta content="old-marker">'))
    real_client=httpx.AsyncClient
    with patch('services.deploying.httpx.AsyncClient',side_effect=lambda **kwargs:real_client(transport=transport,**kwargs)),patch('services.deploying.asyncio.sleep',new=AsyncMock()):
        with pytest.raises(HTTPException,match='不是本次部署版本'):
            asyncio.run(deploying.verify_public('https://app.netlify.app','marker'))

def test_new_netlify_deployment_is_a_draft_and_uploads_only_missing_files():
    import hashlib
    calls=[]
    archive=deploying.bundle({'js':'compiled-app'},'Title','new-marker')
    async def fake(provider,token,method,path,**kwargs):
        calls.append((method,path,kwargs))
        if path=='/sites' or path=='/sites/site1':return {'id':'site1','name':'app'}
        if path=='/sites/site1/deploys':
            assert kwargs['json']['draft'] is True
            assert kwargs['json']['files']['/app.js']==hashlib.sha1(b'compiled-app').hexdigest()
            assert all(path.startswith('/') for path in kwargs['json']['files'])
            return {'id':'deploy1','state':'uploading','required':[hashlib.sha1(b'compiled-app').hexdigest()]}
        return {'state':'ready','deploy_ssl_url':'https://deploy1--app.netlify.app'}
    put=AsyncMock(return_value=httpx.Response(200))
    with patch('services.deploying.api',new=fake),patch('services.deploying.httpx.AsyncClient.put',new=put),patch('services.deploying.verify_public',new=AsyncMock()):
        result=asyncio.run(deploying.deploy('token',archive,1,'new-marker',{},AsyncMock()))
    assert put.await_count==1 and put.call_args.kwargs['content']==b'compiled-app'
    assert result['url']=='https://app.netlify.app'

def test_failed_draft_verification_never_promotes():
    from fastapi import HTTPException
    api=AsyncMock(side_effect=[{'id':'site1','name':'app'},{'state':'ready'},{'state':'ready','deploy_ssl_url':'https://draft--app.netlify.app'}])
    with patch('services.deploying.api',new=api),patch('services.deploying.verify_public',new=AsyncMock(side_effect=HTTPException(502,'unreachable'))):
        with pytest.raises(HTTPException):asyncio.run(deploying.deploy('token',deploying.bundle({'js':'app'},'Title','marker'),1,'marker',{'site_id':'site1','deploy_id':'dep1'},AsyncMock()))
    assert not any(c.args[2]=='POST' for c in api.call_args_list)

def test_failed_live_verification_restores_previous_deployment():
    from fastapi import HTTPException
    calls=[]
    async def fake(provider,token,method,path,**kwargs):
        calls.append((method,path))
        if path=='/deploys/dep1':return {'state':'ready','deploy_ssl_url':'https://draft--app.netlify.app'}
        return {'id':'site1','name':'app'}
    verification=AsyncMock(side_effect=[None,HTTPException(502,'not-live')])
    with patch('services.deploying.api',new=fake),patch('services.deploying.verify_public',new=verification):
        with pytest.raises(HTTPException,match='已恢复上一版'):
            asyncio.run(deploying.deploy('token',deploying.bundle({'js':'app'},'Title','marker'),1,'marker',{'site_id':'site1','deploy_id':'dep1','previous_deploy_id':'old1'},AsyncMock()))
    assert calls[-1]==('POST','/sites/site1/deploys/old1/restore')

def test_cloud_proxy_must_reach_real_api_before_promotion():
    from fastapi import HTTPException
    with patch('services.deploying.httpx.AsyncClient.get',new=AsyncMock(return_value=httpx.Response(200,text='<html>fallback</html>'))):
        with pytest.raises(HTTPException):asyncio.run(deploying.verify_cloud('https://app.netlify.app','slug'))
    with patch('services.deploying.httpx.AsyncClient.get',new=AsyncMock(return_value=httpx.Response(401,json={'detail':'请登录应用'}))):
        asyncio.run(deploying.verify_cloud('https://app.netlify.app','slug'))
