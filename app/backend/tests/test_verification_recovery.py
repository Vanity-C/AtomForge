import pytest
from test_demo import client, account
from test_studio import project
from test_team import wait_run, fake_model
from services import studio
real_runner_ready = studio.ensure_runner_ready


def test_unready_runner_rejects_before_model_or_run_creation(client, monkeypatch):
    owner, _ = account(client)
    pid = project(client, owner, mode='team')
    async def unavailable(): raise studio.RunnerUnavailable()
    async def model(*args, **kwargs): pytest.fail('Model must not run before readiness')
    monkeypatch.setattr(studio, 'ensure_runner_ready', unavailable)
    monkeypatch.setattr(studio, 'model_call', model)
    response = client.post(f'/api/v1/studio/projects/{pid}/runs', headers=owner, json={'instruction':'counter','mode':'team'})
    assert response.status_code == 503
    assert client.get(f'/api/v1/studio/projects/{pid}/runs',headers=owner).json()['items'] == []
    assert client.get(f'/api/v1/af/projects/{pid}/versions',headers=owner).json()['items'] == []


@pytest.mark.parametrize('mode', ['team', 'build'])
def test_runner_outage_resumes_saved_code_without_new_generation(client, monkeypatch, mode):
    owner, _ = account(client); pid = project(client, owner, mode=mode)
    calls, checks = [], []
    base = fake_model(calls)
    async def model(*args, **kwargs):
        if mode == 'team': return await base(*args, **kwargs)
        calls.append((args[4], {}))
        if args[4] == 'plan': return {'goal':'counter','tasks':['counter']}
        return {'summary':'counter', 'files':[{'path':'App.jsx','content':'export default function App(){return <h1>counter</h1>}'}], 'tests':[{'action':'visible','selector':'h1'}]}
    async def unavailable(*args, **kwargs): raise studio.RunnerUnavailable()
    async def no_retry(operation, on_retry): return await operation()
    monkeypatch.setattr(studio,'model_call',model)
    monkeypatch.setattr(studio,'runner_build',unavailable)
    monkeypatch.setattr(studio,'retry_transient',no_retry)
    run_id=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'counter','mode':mode,'interactive':False}).json()['id']
    failed=wait_run(client,owner,run_id)
    assert failed['status']=='error'
    assert failed['result']['error_code']=='runner_unavailable'
    draft=failed['result']['draft_files']
    stages_before=[stage for stage,_ in calls]
    async def success(files, tests=None):
        assert files == draft
        checks.append(tests)
        return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'runner_build',success)
    retried=client.post('/api/v1/studio/runs/'+run_id+'/retry',headers=owner)
    assert retried.status_code==202, retried.text
    done=wait_run(client,owner,retried.json()['id'])
    assert done['status']=='done',done
    assert [stage for stage,_ in calls][len(stages_before):] == (['team_qa'] if mode=='team' else [])
    assert len(checks)==(2 if mode=='team' else 1)
    assert len(client.get(f'/api/v1/af/projects/{pid}/versions',headers=owner).json()['items'])==1


def test_readiness_requires_successful_browser_check(monkeypatch):
    import asyncio, httpx
    # Test the real client rather than the fixture's readiness stub.
    real = real_runner_ready
    original_client=httpx.AsyncClient
    for status, payload in [(503,{'status':'unavailable'}),(200,{'status':'healthy'})]:
        monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs: original_client(transport=httpx.MockTransport(lambda req:httpx.Response(status,json=payload))))
        with pytest.raises(studio.RunnerUnavailable): asyncio.run(real())
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs: original_client(transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'status':'ready'}))))
    asyncio.run(real())
