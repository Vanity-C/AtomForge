from test_demo import client, account
from test_studio import project
from test_team import wait_run
from services import studio
from services.agent_profiles import defaults, active_team, engineer_team, prompt_for, roster


def test_engineer_selection_never_borrows_a_non_engineering_role():
    config=defaults()
    config['teams'][0]['member_ids']=['default-leader','default-design']
    team=active_team(config)
    solo=engineer_team(team)
    assert [p['id'] for p in roster(team)]==['default-leader','default-design']
    assert [p['id'] for p in roster(solo)]==['default-engineer']
    assert set(solo)=={'engineer','member:default-engineer'}
    assert '唯一的应用工程师' in prompt_for('engineer',solo)
    config['agents'].append({**solo['engineer'],'id':'custom-dev','name':'My Engineer'})
    config['teams'][0]['member_ids']=['default-leader','custom-dev']
    assert engineer_team(active_team(config))['engineer']['id']=='custom-dev'


def test_build_runs_plan_implement_and_verify_with_only_engineer(client,monkeypatch):
    owner,_=account(client)
    pid=project(client,owner)
    calls=[]
    async def model(*args,**kwargs):
        stage=args[4];calls.append(stage)
        if stage=='plan':
            assert '唯一的应用工程师' in args[5][0]['content']
            return {'goal':'counter','tasks':['implement counter'],'acceptance':['button increments']}
        assert stage=='code'
        return {'summary':'counter ready','files':[{'path':'App.jsx','content':'export default function App(){return <button>Count</button>}'}],'tests':[]}
    async def build(*args,**kwargs):return {'ok':True,'artifact':{'js':'ok','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model)
    monkeypatch.setattr(studio,'runner_build',build)
    response=client.post(f'/api/v1/studio/projects/{pid}/runs',headers=owner,json={'instruction':'Make a counter'})
    assert response.status_code==202,response.text
    run=wait_run(client,owner,response.json()['id'])
    assert run['status']=='done',run
    assert calls==['plan','code']
    assert set(run['agents'])=={'engineer','member:default-engineer'}
    assert {e['role'] for e in run['events'] if e.get('role')}=={'engineer'}
    history=client.get(f'/api/v1/studio/projects/{pid}/conversations',headers=owner).json()['items']
    assert all(m['sender'] in {'user','engineer'} and m['recipient'] in {'user','engineer','all'} for m in history)


def test_build_chat_rejects_other_agents_before_model_call(client,monkeypatch):
    owner,_=account(client);pid=project(client,owner);calls=[]
    async def model(*args,**kwargs):
        calls.append(args[4])
        assert set(kwargs['agent_team'])=={'engineer','member:default-engineer'}
        return {'answer':'I can explain the implementation.'}
    monkeypatch.setattr(studio,'model_call',model)
    for role in ['leader','design','qa','member:default-leader']:
        response=client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=owner,json={'role':role,'content':'Explain this application'})
        assert response.status_code==400,response.text
    assert calls==[]
    response=client.post(f'/api/v1/studio/projects/{pid}/conversations',headers=owner,json={'role':'member:default-engineer','content':'Explain this application'})
    assert response.status_code==200,response.text
    assert calls==['chat_engineer']
