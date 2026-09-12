"""Acceptance checks use an isolated SQLite database and no real model calls."""
import asyncio
import importlib
import os
import pkgutil
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["MGX_IGNORE_MODULE_INIT"] = "false"
os.environ["ATOMFORGE_JWT_SECRET"] = "test-only-signing-key-for-isolated-database"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from core.config import settings
    from core.database import Base, db_manager
    import models
    from fastapi.testclient import TestClient
    from main import app

    settings.__dict__["database_url"] = f"sqlite+aiosqlite:///{tmp_path_factory.mktemp('db') / 'test.db'}"
    for module in pkgutil.iter_modules(models.__path__):
        importlib.import_module(f"models.{module.name}")
    async def init():
        engine = await db_manager.get_engine()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await db_manager.close_db()
    asyncio.run(init())
    with TestClient(app) as c:
        # Each module owns a fresh database and independent request quota.
        middleware=app.middleware_stack
        while middleware:
            if hasattr(middleware,'auth_requests'):middleware.auth_requests.clear()
            middleware=getattr(middleware,'app',None)
        yield c


def account(client):
    email = f"test-{uuid.uuid4().hex}@example.test"
    payload = {"email": email, "password": "TestPassword123!", "display_name": "Test_" + uuid.uuid4().hex[:12]}
    response = client.post("/api/v1/af-auth/register", json=payload)
    assert response.status_code == 200
    return {"X-AtomForge-Token": response.json()["access_token"]}, payload


def test_accounts_and_private_routes(client):
    headers, payload = account(client)
    assert client.post('/api/v1/af-auth/login', json=payload).status_code == 200
    assert client.post('/api/v1/af-auth/register', json=payload).status_code == 409
    assert client.get('/api/v1/af-auth/me', headers=headers).status_code == 200
    assert client.get('/api/v1/af/projects').status_code == 401
    assert client.post('/api/v1/af-generation/jobs', json={"messages":[{"role":"user","content":"test"}]}).status_code == 401
    assert client.post('/api/v1/aihub/gentxt', json={}).status_code in {404, 405}
    assert client.get('/.env.local').status_code == 404


def test_project_versions_share_and_isolation(client):
    owner, _ = account(client)
    other, _ = account(client)
    project = client.post('/api/v1/af/projects', headers=owner, json={"name":"test"}).json()['project']
    url = f"/api/v1/af/projects/{project['id']}"
    for method, suffix, payload in [('GET','',None), ('PATCH','',{'name':'attack'}), ('GET','/files',None), ('POST','/share',{})]:
        assert client.request(method,url+suffix,headers=other,json=payload).status_code == 404
    files = [{"path":"App.jsx","content":"export default function App(){return <h1>one</h1>}","language":"jsx"}]
    assert client.post(url+'/files',headers=owner,json={'files':files}).status_code == 200
    version = client.get(url+'/versions',headers=owner).json()['items'][0]['id']
    changed = [{**files[0], 'content':files[0]['content'].replace('one','two')}]
    assert client.post(url+'/files',headers=owner,json={'files':changed}).status_code == 200
    assert client.post(url+'/rollback',headers=owner,json={'version_id':version}).status_code == 200
    assert client.get(url+'/files',headers=owner).json()['items'][0]['content'] == files[0]['content']
    slug = client.post(url+'/share',headers=owner).json()['project']['share_slug']
    shared = client.get('/api/v1/share/'+slug)
    assert shared.status_code == 200 and shared.json()['files']
    assert 'user_id' not in shared.json() and 'password_hash' not in shared.text
    assert client.delete(url+'/share',headers=owner).status_code == 200
    assert client.get('/api/v1/share/'+slug).status_code == 404
    assert client.delete(url,headers=owner).status_code == 200
    assert client.get(url,headers=owner).status_code == 404


def test_generation_validation(client):
    headers, _ = account(client)
    url = '/api/v1/af-generation/jobs'
    data = {'messages':[{'role':'user','content':'test'}]}
    assert client.post(url,headers=headers,json={**data,'max_tokens':16001}).status_code == 422
    assert client.post(url,headers=headers,json=data).status_code == 410
    project=client.post('/api/v1/af/projects',headers=headers,json={'name':'validation'}).json()['project']
    assert client.post(f"/api/v1/studio/projects/{project['id']}/runs",headers=headers,json={'instruction':'test','model':'not-allowed'}).status_code==400
    assert client.post(url,headers=headers,json={'messages':[{'role':'user','content':'x'*120001}]}).status_code == 422


@pytest.mark.asyncio
async def test_job_cancellation_and_ownership(monkeypatch):
    import services.generation as module
    from fastapi import HTTPException
    from schemas.aihub import GenTxtRequest, ChatMessage
    class Fake:
        client = None
        def _require_ai_client(self): return True
        async def gentxt_stream(self, request):
            yield 'first'
            await asyncio.sleep(60)
    monkeypatch.setattr(module, 'AIHubService', Fake)
    jobs = module.GenerationJobs()
    request = GenTxtRequest(model='deepseek-flash',messages=[ChatMessage(role='user',content='test')])
    job_id = jobs.start(1, request)
    await asyncio.sleep(0)
    assert jobs.get(1,job_id).content == 'first'
    with pytest.raises(HTTPException) as denied: jobs.get(2,job_id)
    assert denied.value.status_code == 404
    with pytest.raises(HTTPException) as busy: jobs.start(1,request)
    assert busy.value.status_code == 429
    jobs.cancel(1,job_id)
    await jobs.get(1,job_id).task
    assert jobs.get(1,job_id).status == 'cancelled'


@pytest.mark.asyncio
async def test_job_error_and_global_limit(monkeypatch):
    import services.generation as module
    from fastapi import HTTPException
    from schemas.aihub import GenTxtRequest, ChatMessage
    class Fake:
        client = None
        def _require_ai_client(self): return True
        async def gentxt_stream(self, request):
            yield 'partial'
            raise ValueError('truncated')
    monkeypatch.setattr(module, 'AIHubService', Fake)
    monkeypatch.setenv('AI_HOURLY_LIMIT','1')
    jobs = module.GenerationJobs()
    request = GenTxtRequest(model='deepseek-flash',messages=[ChatMessage(role='user',content='test')])
    job_id = jobs.start(1,request)
    await jobs.get(1,job_id).task
    assert jobs.get(1,job_id).status == 'error'
    with pytest.raises(HTTPException) as limit: jobs.start(2,request)
    assert limit.value.status_code == 429
