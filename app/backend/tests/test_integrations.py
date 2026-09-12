import hashlib
import hmac
import json
import time
import httpx
import pytest
from test_demo import client,account
from test_studio import project


def test_connections_redact_and_github_preserves_remote_tree(client,monkeypatch):
    from routers import connections
    owner,_=account(client);other,_=account(client);p=project(client,owner)
    root=f'/api/v1/connections/projects/{p}'
    assert client.put(root,headers=owner,json={'github_repo':'owner/repo','github_token':'unit-secret'}).status_code==200
    config=client.get(root,headers=owner)
    assert config.json()['github_token_configured'] and 'unit-secret' not in config.text
    assert client.get(root,headers=other).status_code==404
    assert client.put(root,headers=owner,json={'public_base_url':'http://localhost:8080'}).status_code==400
    client.post(f'/api/v1/af/projects/{p}/files',headers=owner,json={'files':[{'path':'App.tsx','content':'export default function App(){return <h1>demo</h1>}'}]})
    calls=[]
    def transport(req):
        path=req.url.path;payload=json.loads(req.content) if req.content else None;calls.append((req.method,path,payload))
        if path.endswith('/git/trees/base'):return httpx.Response(200,json={'tree':[{'type':'blob','path':'README.md'},{'type':'blob','path':'generated/old.jsx'}]})
        if '/git/ref/heads/' in path:return httpx.Response(200,json={'object':{'sha':'head'}})
        if path.endswith('/git/commits/head'):return httpx.Response(200,json={'tree':{'sha':'base'}})
        if req.method=='GET':return httpx.Response(200,json={'default_branch':'main'})
        return httpx.Response(200,json={'sha':'new'})
    original=httpx.AsyncClient
    monkeypatch.setattr(connections.httpx,'AsyncClient',lambda **kw:original(**kw,transport=httpx.MockTransport(transport)))
    r=client.post(root+'/github',headers=owner);assert r.status_code==200,r.text
    tree=next(body for method,path,body in calls if method=='POST' and path.endswith('/git/trees'))
    assert tree['base_tree']=='base'
    assert any(e['path']=='generated/package.json' for e in tree['tree'])
    assert any(e['path']=='generated/src/App.tsx' for e in tree['tree'])
    assert [e['path'] for e in tree['tree'] if e.get('sha','exists') is None]==['generated/old.jsx']
    assert 'unit-secret' not in json.dumps(tree)
    assert calls[-1][0]=='PATCH' and calls[-1][2]['force'] is False
    assert client.delete(root,headers=owner).status_code==200
    assert not client.get(root,headers=owner).json()['github_token_configured']


def test_checkout_signature_tenant_and_replay(client,monkeypatch):
    from core.database import db_manager
    from models.studio import StudioRelease
    from routers import connections
    owner,_=account(client);p=project(client,owner)
    client.put(f'/api/v1/studio/projects/{p}/cloud',headers=owner,json={'enabled':True})
    slug=client.get(f'/api/v1/studio/projects/{p}/cloud',headers=owner).json()['slug']
    root='/api/v1/connections/cloud/'+slug
    user=client.post('/api/v1/cloud/'+slug+'/register',json={'email':'buyer@example.test','password':'TestPassword123!'}).json()
    token={'X-App-Token':user['access_token']}
    assert client.post(root+'/checkout',headers=token).status_code==409
    client.put(f'/api/v1/connections/projects/{p}',headers=owner,json={'stripe_secret':'sk_test_unit','stripe_webhook_secret':'whsec_unit','stripe_price_id':'price_unit','public_base_url':'https://example.test'})
    async def seed():
        async with db_manager.session() as db:
            db.add(StudioRelease(project_id=p,slug='release-'+str(p),version=1,active=True,artifact='{}',files='[]'));await db.commit()
    client.portal.call(seed)
    original=httpx.AsyncClient
    def handler(req):
        assert req.url.host=='api.stripe.com'
        assert b'price_unit' in req.content
        return httpx.Response(200,json={'id':'cs_unit_'+str(p),'url':'https://checkout.stripe.com/c/pay/test'})
    monkeypatch.setattr(connections.httpx,'AsyncClient',lambda **kw:original(**kw,transport=httpx.MockTransport(handler)))
    assert client.post(root+'/checkout',headers=token).status_code==200
    assert client.get(root+'/payments',headers=token).json()['items'][0]['status']=='pending'
    payload=json.dumps({'id':'evt_unit','type':'checkout.session.completed','data':{'object':{'id':'cs_unit_'+str(p),'client_reference_id':user['user']['id'],'metadata':{'project_id':str(p)},'payment_status':'paid'}}})
    webhook=f'/api/v1/connections/stripe/{p}/webhook'
    assert client.post(webhook,content=payload,headers={'Stripe-Signature':'bad'}).status_code==400
    timestamp=str(int(time.time()));signature=hmac.new(b'whsec_unit',(timestamp+'.'+payload).encode(),hashlib.sha256).hexdigest()
    headers={'Stripe-Signature':f't={timestamp},v1={signature}','Content-Type':'application/json'}
    for _ in range(2):assert client.post(webhook,content=payload,headers=headers).status_code==200
    assert client.get(root+'/payments',headers=token).json()['items'][0]['status']=='paid'
    assert client.post(webhook,content=payload.replace('paid','unpaid'),headers=headers).status_code==400
    assert client.get(root+'/payments',headers={'X-App-Token':owner['X-AtomForge-Token']}).status_code==401


def test_budget_blocks_before_model_call_and_reports_persist(client,monkeypatch):
    from core.database import db_manager
    from models.studio import StudioUsage
    from services.studio import model_call
    from routers import reports
    owner,details=account(client);p=project(client,owner)
    uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    async def seed():
        async with db_manager.session() as db:
            db.add(StudioUsage(owner=str(uid),project_id=p,run_id='unit',model='deepseek-flash',stage='code',input_tokens=600,output_tokens=400));await db.commit()
    client.portal.call(seed)
    assert client.put('/api/v1/studio/budget',headers=owner,json={'token_limit':900,'prices':{'deepseek-flash':{'input':1,'output':2}}}).status_code==200
    summary=client.get('/api/v1/studio/budget',headers=owner).json()
    assert summary['used_tokens']==1000 and summary['estimated_cost']==.0014
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as err:client.portal.call(model_call,uid,p,'unit','deepseek-flash','code',[])
    assert err.value.status_code==429
    client.put('/api/v1/studio/budget',headers=owner,json={'token_limit':0})
    url=f'/api/v1/reports/projects/{p}'
    assert client.post(url,headers=owner,json={'kind':'research','prompt':'test'}).status_code==409
    client.put(f'/api/v1/connections/projects/{p}',headers=owner,json={'tavily_key':'unit'})
    async def search(q,key):return [{'id':'1','title':'source','url':'https://example.test/source','content':'source text'}]
    async def model(*args,**kwargs):return {'title':'report','body':'Evidence and inference','source_ids':['1','unknown']}
    monkeypatch.setattr(reports,'search',search);monkeypatch.setattr(reports,'model_call',model)
    r=client.post(url,headers=owner,json={'kind':'research','prompt':'test'})
    assert r.status_code==200,r.text
    assert r.json()['source_ids']==['1']
    assert client.get(url,headers=owner).json()['items'][0]['body']=='Evidence and inference'


def test_export_and_stale_editor_conflict(client):
    owner,_=account(client);p=project(client,owner)
    root=f'/api/v1/af/projects/{p}'
    files=[{'path':'App.tsx','content':'export default function App(){return <h1>hello</h1>}'}]
    assert client.post(root+'/files',headers=owner,json={'files':files,'expected_version':0}).status_code==200
    assert client.post(root+'/files',headers=owner,json={'files':files,'expected_version':0}).status_code==409
    exported=client.get(f'/api/v1/studio/projects/{p}/export',headers=owner).json()['entries']
    entries={f['path']:f['content'] for f in exported}
    assert 'src/App.tsx' in entries and './src/App.tsx' in entries['main.jsx']
    assert 'recharts' in json.loads(entries['package.json'])['dependencies']
    assert 'X-AtomForge-Token' not in entries['cloud-client.js']
