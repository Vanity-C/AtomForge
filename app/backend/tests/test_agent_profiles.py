import asyncio
import base64
import copy
import json
from io import BytesIO
from types import SimpleNamespace

from PIL import Image
from test_demo import client,account
from test_studio import project

URL='/api/v1/studio/agents'


def body(config):
    return {k:copy.deepcopy(config[k]) for k in ('agents','active','revision')}


def test_agent_library_is_private_persistent_and_restorable(client):
    owner,_=account(client);other,_=account(client)
    assert client.get(URL).status_code==401
    original=client.get(URL,headers=owner).json()
    assert len(original['agents'])==6 and len({a['personality'] for a in original['agents']})==6
    data=body(original)
    data['agents'][3].update(name='小岚',personality='耐心，偏爱用实例解释',responsibilities='关注无障碍和可靠的数据流')
    custom={**data['agents'][3],'id':'custom-dev','name':'阿禾'}
    data['agents'].append(custom);data['active']['engineer']='custom-dev'
    response=client.put(URL,headers=owner,json=data)
    assert response.status_code==200,response.text
    saved=response.json()
    assert saved['revision']==1 and saved['active']['engineer']=='custom-dev'
    assert client.get(URL,headers=owner).json()['agents'][3]['name']=='小岚'
    assert client.get(URL,headers=other).json()['agents'][3]['name']=='Neo'
    assert client.put(URL,headers=owner,json=data).status_code==409
    reset={**body(original['defaults']),'revision':saved['revision']}
    assert client.put(URL,headers=owner,json=reset).status_code==200
    restored=client.get(URL,headers=owner).json()
    assert restored['agents']==original['agents'] and restored['active']==original['active']


def test_invalid_agent_assignments_and_avatars_are_rejected(client):
    owner,_=account(client);original=client.get(URL,headers=owner).json()
    for edit in ('missing','wrong-role','duplicate','blank','reserved'):
        data=body(original)
        if edit=='missing':data['agents'].pop()
        if edit=='wrong-role':data['active']['engineer']='default-qa'
        if edit=='duplicate':data['agents'].append(data['agents'][0])
        if edit=='blank':data['agents'][0]['personality']='  '
        if edit=='reserved':data['agents'].append({**data['agents'][0],'id':'default-invented'})
        assert client.put(URL,headers=owner,json=data).status_code==422,edit
    data=body(original);data['agents'][0]['avatar']='data:image/svg+xml;base64,PHN2Zz4='
    assert client.put(URL,headers=owner,json=data).status_code==400
    output=BytesIO();Image.new('RGB',(30,20),'blue').save(output,format='PNG')
    data['agents'][0]['avatar']='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
    response=client.put(URL,headers=owner,json=data)
    assert response.status_code==200
    avatar=response.json()['agents'][0]['avatar']
    assert Image.open(BytesIO(base64.b64decode(avatar.split(',')[1]))).size==(256,256)


def test_run_and_history_keep_persona_snapshot_while_model_uses_it(client,monkeypatch):
    from services import studio
    owner,_=account(client);p=project(client,owner,mode='team')
    uid=client.get('/api/v1/af-auth/me',headers=owner).json()['user']['id']
    config=body(client.get(URL,headers=owner).json())
    config['agents'][3].update(name='阿禾',personality='用例子说明取舍',responsibilities='优先保证无障碍操作')
    saved=client.put(URL,headers=owner,json=config).json()
    async def pause(*args):await asyncio.sleep(60)
    monkeypatch.setattr(studio,'execute',pause)
    run_id=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':'team'}).json()['id']
    changed=body(saved);changed['agents'][3]['name']='新伙伴'
    assert client.put(URL,headers=owner,json=changed).status_code==200
    run=client.get('/api/v1/studio/runs/'+run_id,headers=owner).json()
    assert run['agents']['engineer']['name']=='阿禾'
    captured=[]
    async def create(**kwargs):
        captured.append(kwargs)
        return SimpleNamespace(usage=None,choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content='{"summary":"ready"}'))])
    class FakeService:
        def __init__(self):self.client=self
        def _require_ai_client(self):return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        async def close(self):pass
    monkeypatch.setattr(studio,'AIHubService',FakeService)
    client.portal.call(studio.model_call,uid,p,run_id,'deepseek-flash','team_code',[{'role':'system','content':'返回 JSON'}])
    system=captured[0]['messages'][0]['content']
    assert '阿禾' in system and '用例子说明取舍' in system and '优先保证无障碍操作' in system and '新伙伴' not in system
    async def record():await studio.event(run_id,'code','开始实现',role='engineer')
    client.portal.call(record)
    history=client.get(f'/api/v1/studio/projects/{p}/conversations',headers=owner).json()
    assert history['teams'][run_id]['engineer']['name']=='阿禾'
    assert client.delete('/api/v1/studio/runs/'+run_id,headers=owner).status_code==200


def test_direct_chat_uses_custom_agent_and_accepts_gpt(client,monkeypatch):
    from services import studio
    owner,_=account(client);p=project(client,owner)
    config=body(client.get(URL,headers=owner).json());config['agents'][1]['name']='小橙'
    assert client.put(URL,headers=owner,json=config).status_code==200
    async def validate(model):assert model=='gpt-test'
    async def model(*args,**kwargs):
        assert kwargs['agent_team']['design']['name']=='小橙'
        return {'answer':'我建议先让主操作更清楚，减少第一次使用时的犹豫。','plan':[]}
    monkeypatch.setattr(studio,'validate_model',validate);monkeypatch.setattr(studio,'model_call',model)
    result=client.post(f'/api/v1/studio/projects/{p}/conversations',headers=owner,json={'role':'design','content':'你怎么看当前设计？','model':'gpt-test'})
    assert result.status_code==200,result.text
    rows=client.get(f'/api/v1/studio/projects/{p}/conversations',headers=owner).json()['items']
    assert rows[-1]['detail']['agent']['name']=='小橙'
