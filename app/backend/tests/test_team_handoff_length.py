"""Long presentation copy must not invalidate professional deliverables."""
import json
import pytest
from test_demo import client, account
from test_studio import project
from test_team import fake_model, wait_run
from services import studio


@pytest.mark.parametrize('length', [400, 401, 6000])
def test_long_handoff_is_lossless_and_display_only_is_bounded(length):
    from services.team import Brief, Document, validate_review, handoff_preview
    message='交' * length
    for output in [
        Brief.model_validate({'goal':'goal','tasks':['task'],'acceptance':['AC'],'handoff':message}).model_dump(),
        Document.model_validate({'summary':'contract','items':['keep important constraint'],'handoff':message}).model_dump(),
        validate_review({'approved':True,'summary':'review','issues':[],'handoff':message,'tests':[{'action':'visible','selector':'h1'},{'action':'text','selector':'h1','value':'counter'}]}),
    ]:
        assert output['handoff']==message
    preview=handoff_preview(message)
    assert len(preview)<=400
    assert preview==message if length<=400 else preview.endswith('（完整交接见文档）')


def test_oversized_handoffs_do_not_interrupt_or_recall_models_and_reach_downstream(client,monkeypatch):
    owner,_=account(client);p=project(client,owner,mode='team');calls=[]
    base=fake_model(calls)
    full='这是完整交接说明。'*65+'最后一条关键约束：必须保留用户数据。'
    async def model(*args,**kwargs):
        output=await base(*args,**kwargs)
        stage=args[4]
        if stage=='team_code':
            context=json.loads(args[5][-1]['content'])
            assert context['handoffs']['architect']['handoff']==full
        output['handoff']=full
        return output
    async def build(files,tests=None):return {'ok':True,'artifact':{'js':'verified','css':''},'logs':['PASS']}
    monkeypatch.setattr(studio,'model_call',model);monkeypatch.setattr(studio,'runner_build',build)
    rid=client.post(f'/api/v1/studio/projects/{p}/runs',headers=owner,json={'instruction':'counter','mode':'team','interactive':False}).json()['id']
    done=wait_run(client,owner,rid)
    assert done['status']=='done',done
    assert [s for s,_ in calls]==['team_product','team_design','team_architect','team_code','team_qa']
    for role in ['product','design','architect','engineer','qa']:
        assert done['result']['team'][role]['handoff']==full
    events=[e for e in done['events'] if e.get('kind')=='handoff']
    assert len(events)==4
    assert all(len(e['message'])<=400 and e['output']['handoff']==full for e in events)
    assert not any('交接格式需要整理' in e['message'] for e in done['events'])


def test_handoff_tolerance_does_not_weaken_required_fields_or_qa():
    from services.team import Document, validate_review
    with pytest.raises(ValueError):Document.model_validate({'handoff':'交'*1000})
    with pytest.raises(ValueError):Document.model_validate({'summary':'ok','items':['contract'],'handoff':{'wrong':'type'}})
    with pytest.raises(ValueError):validate_review({'approved':True,'summary':'review','issues':['unfixed defect'],'handoff':'交'*1000,'tests':[{'action':'visible','selector':'h1'}]*2})
