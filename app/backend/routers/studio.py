import asyncio
import json
import secrets
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from core.database import db_manager
from dependencies.af_auth import get_af_user
from models.af_users import Af_users
from models.studio import StudioRun, StudioArtifact, StudioUsage, StudioCloud, StudioRelease
from services.af_projects import AfProjectService
from services import studio
from services.team_workflow import PolicyChange, update_policy

router=APIRouter(prefix='/api/v1/studio',tags=['studio'])

@router.patch('/runs/{run_id}/strategy')
async def change_strategy(run_id:str,data:PolicyChange,user:Af_users=Depends(get_af_user)):
    return await update_policy(user.id,run_id,data)

commit_locks={}


async def manage(db,project_id,user):
    return await AfProjectService(db,str(user.id))._load_owned_project(project_id,manage=True)


class MemberInput(BaseModel):
    email:str=Field(max_length=190)
    role:str='viewer'


@router.get('/projects/{project_id}/members')
async def members(project_id:int,user:Af_users=Depends(get_af_user)):
    from models.studio import StudioMember
    async with db_manager.session() as db:
        p=await AfProjectService(db,str(user.id))._load_owned_project(project_id)
        rows=(await db.execute(select(StudioMember,Af_users).join(Af_users,StudioMember.user_id==Af_users.id).where(StudioMember.project_id==project_id))).all()
        return {'can_manage':str(p.user_id)==str(user.id),'items':[{'id':m.id,'email':u.email,'role':m.role} for m,u in rows]}


@router.post('/projects/{project_id}/members')
async def add_member(project_id:int,data:MemberInput,user:Af_users=Depends(get_af_user)):
    from models.studio import StudioMember
    if data.role not in {'viewer','editor'}:raise HTTPException(400,'角色必须为 viewer 或 editor')
    async with db_manager.session() as db:
        p=await manage(db,project_id,user)
        target=await db.scalar(select(Af_users).where(Af_users.email==data.email.strip().lower()))
        if not target:raise HTTPException(404,'此账号尚未注册，请让对方先注册工作台')
        if str(target.id)==str(p.user_id):raise HTTPException(400,'项目所有者不需要添加')
        m=await db.scalar(select(StudioMember).where(StudioMember.project_id==project_id,StudioMember.user_id==str(target.id)))
        if not m:m=StudioMember(project_id=project_id,user_id=str(target.id));db.add(m)
        m.role=data.role;await db.commit();return {'success':True}


@router.delete('/projects/{project_id}/members/{member_id}')
async def remove_member(project_id:int,member_id:int,user:Af_users=Depends(get_af_user)):
    from models.studio import StudioMember
    async with db_manager.session() as db:
        await manage(db,project_id,user);m=await db.get(StudioMember,member_id)
        if not m or m.project_id!=project_id:raise HTTPException(404,'成员不存在')
        await db.delete(m);await db.commit();return {'success':True}


class Start(BaseModel):
    interactive:bool=True
    temperature:float=Field(default=.35,ge=0,le=1,allow_inf_nan=False)
    instruction: str=Field(min_length=1,max_length=6000)
    model: str='deepseek-flash'
    mode: str | None=None


@router.post('/projects/{project_id}/runs',status_code=202)
async def start_run(project_id:int,data:Start,user:Af_users=Depends(get_af_user)):
    if data.mode is not None and data.mode not in {'build','race','team'}: raise HTTPException(400,'未知运行模式')
    return await studio.start(user.id,project_id,data.instruction,data.model,data.mode,data.temperature,data.interactive)


@router.get('/projects/{project_id}/runs')
async def runs(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        await AfProjectService(db,str(user.id)).get_project(project_id)
        rows=(await db.execute(select(StudioRun).where(StudioRun.project_id==project_id,StudioRun.owner==str(user.id)).order_by(StudioRun.created.desc()).limit(20))).scalars().all()
        return {'items':[{'id':r.id,'status':r.status,'stage':r.stage,'created':r.created,'error':r.error} for r in rows]}


@router.get('/runs/{run_id}')
async def run(run_id:str,user:Af_users=Depends(get_af_user)):
    return await studio.get_run(user.id,run_id)


@router.get('/runs/{run_id}/events')
async def run_events(run_id:str,before:int|None=Query(default=None,ge=1),
                     limit:int=Query(default=100,ge=1,le=200),user:Af_users=Depends(get_af_user)):
    from services.run_logs import read_events
    return await read_events(user.id,run_id,before,limit)


@router.get('/runs/{run_id}/qa-reports')
async def qa_reports(run_id:str,user:Af_users=Depends(get_af_user)):
    from services.run_logs import read_issue_history
    return await read_issue_history(user.id,run_id)


@router.delete('/runs/{run_id}')
async def cancel(run_id:str,user:Af_users=Depends(get_af_user)):
    await studio.cancel(user.id,run_id)
    return {'success':True}


@router.post('/projects/{project_id}/stop')
async def stop_project(project_id:int,user:Af_users=Depends(get_af_user)):
    return await studio.stop_project(user.id,project_id)


class Decision(BaseModel):
    checkpoint_id:str=Field(max_length=80)
    action:str
    feedback:str=Field(default='',max_length=6000)
    selections:dict[str,str]|None=Field(default=None,max_length=3)
    other:dict[str,str]=Field(default_factory=dict,max_length=3)


@router.post('/runs/{run_id}/decision',status_code=202)
async def decision(run_id:str,data:Decision,user:Af_users=Depends(get_af_user)):
    from services.agent_chat import decide
    if data.action not in {'approve','revise'}: raise HTTPException(400,'未知确认动作')
    return await decide(user.id,run_id,data.checkpoint_id,data.action,data.feedback,data.selections,data.other)


class DecisionControl(BaseModel):
    checkpoint_id:str=Field(max_length=80)
    action:str


@router.post('/runs/{run_id}/decision-control')
async def decision_control(run_id:str,data:DecisionControl,user:Af_users=Depends(get_af_user)):
    from services.checkpoints import control
    return await control(user.id,run_id,data.checkpoint_id,data.action)


class RoleChat(BaseModel):
    role:str
    content:str=Field(min_length=1,max_length=6000)
    model:str='deepseek-flash'


@router.get('/projects/{project_id}/conversations')
async def conversations(project_id:int,role:str='all',before:int|None=None,user:Af_users=Depends(get_af_user)):
    from services.agent_chat import messages
    return await messages(user.id,project_id,role,before)


@router.post('/projects/{project_id}/conversations')
async def role_chat(project_id:int,data:RoleChat,user:Af_users=Depends(get_af_user)):
    from services.agent_chat import chat
    return await chat(user.id,project_id,data.role,data.content,data.model)


class Choice(BaseModel):
    index: int=Field(ge=0,le=2)


@router.post('/runs/{run_id}/choose')
async def choose(run_id:str,data:Choice,user:Af_users=Depends(get_af_user)):
    async with commit_locks.setdefault(run_id,asyncio.Lock()):
        run=await studio.get_run(user.id,run_id)
        candidates=run['result'].get('candidates',[])
        if run['status']!='review' or data.index>=len(candidates): raise HTTPException(409,'候选不存在或已选择')
        version=await studio.commit_result(user.id,run['project_id'],run['result']['base_version'],candidates[data.index],run_id)
        await studio.change(run_id,status='done',stage='done',result={'version':version,'summary':candidates[data.index]['summary']})
        return {'version':version}


@router.post('/runs/{run_id}/retry',status_code=202)
async def retry(run_id:str,user:Af_users=Depends(get_af_user)):
    run=await studio.get_run(user.id,run_id)
    if run['status'] in studio.ACTIVE|{'awaiting_input'}: raise HTTPException(409,'任务仍在运行或等待确认')
    async with db_manager.session() as db:
        r=await db.get(StudioRun,run_id);p=json.loads(r.payload)
    return await studio.start(user.id,run['project_id'],p['instruction'],p['model'],p['mode'],p.get('temperature',.35),p.get('interactive',True),retry_of=run_id)


@router.get('/projects/{project_id}/artifact')
async def artifact(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        p=await AfProjectService(db,str(user.id)).get_project(project_id)
        artifact=await db.get(StudioArtifact,project_id)
        cloud=await db.get(StudioCloud,project_id)
        return {'artifact':json.loads(artifact.content) if artifact and artifact.version==p['current_version'] else None,'cloud_slug':cloud.slug if cloud and cloud.enabled else None}


@router.post('/projects/{project_id}/build')
async def build(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        service=AfProjectService(db,str(user.id));p=await service.get_project(project_id);files=await service.list_files(project_id)
        await service._load_owned_project(project_id,write=True)
    result=await studio.runner_build(files)
    if not result['ok']: raise HTTPException(422,result.get('error','检查失败'))
    async with db_manager.session() as db:
        current=await AfProjectService(db,str(user.id)).get_project(project_id)
        if current['current_version']!=p['current_version']: raise HTTPException(409,'代码已变化，请重新构建')
        a=await db.get(StudioArtifact,project_id)
        if not a:a=StudioArtifact(project_id=project_id);db.add(a)
        a.version=p['current_version'];a.content=json.dumps(result['artifact']);await db.commit()
    return result


class CloudConfig(BaseModel):
    enabled: bool=False
    ai_enabled: bool=False
    collections: dict[str,str]=Field(default_factory=dict)


class VisualEdit(BaseModel):
    source:str=Field(max_length=240)
    text:str|None=Field(default=None,max_length=2000)
    style:dict[str,str]=Field(default_factory=dict)
    version:int=Field(ge=0)


@router.post('/projects/{project_id}/visual')
async def visual(project_id:int,data:VisualEdit,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        s=AfProjectService(db,str(user.id));p=await s.get_project(project_id);files=await s.list_files(project_id)
        await s._load_owned_project(project_id,write=True)
        if p['current_version']!=data.version:raise HTTPException(409,'代码已变化，请重新选择元素')
    checked=await studio.runner_build(files,edit=data.model_dump(exclude_none=True))
    if not checked['ok']:raise HTTPException(422,checked.get('error','编辑检查失败'))
    version=await studio.commit_result(user.id,project_id,data.version,{'files':checked['files'],'artifact':checked['artifact'],'summary':'可视化修改 '+data.source,'model':'visual-editor'},'visual')
    return {'version':version}


@router.get('/projects/{project_id}/cloud')
async def cloud_config(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        await AfProjectService(db,str(user.id)).get_project(project_id)
        c=await db.get(StudioCloud,project_id)
        return {'enabled':bool(c and c.enabled),'ai_enabled':bool(c and c.ai_enabled),'collections':json.loads(c.collections) if c else {},'slug':c.slug if c else ''}


@router.put('/projects/{project_id}/cloud')
async def save_cloud(project_id:int,data:CloudConfig,user:Af_users=Depends(get_af_user)):
    import re
    if len(data.collections)>20 or any(not re.fullmatch('[a-z][a-z0-9_]{0,39}',k) or v not in {'private','shared'} for k,v in data.collections.items()): raise HTTPException(400,'集合名须为小写字母/数字/下划线，策略须为 private 或 shared')
    async with db_manager.session() as db:
        await manage(db,project_id,user)
        c=await db.get(StudioCloud,project_id)
        if not c:c=StudioCloud(project_id=project_id,slug=secrets.token_urlsafe(18));db.add(c)
        c.enabled=data.enabled;c.ai_enabled=data.ai_enabled;c.collections=json.dumps(data.collections);await db.commit()
    return {'success':True}


@router.get('/projects/{project_id}/release')
async def release_info(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        await AfProjectService(db,str(user.id)).get_project(project_id)
        r=await db.get(StudioRelease,project_id)
        return {'release':{'slug':r.slug,'version':r.version,'active':r.active} if r else None}


@router.post('/projects/{project_id}/release')
async def publish(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        service=AfProjectService(db,str(user.id));p=await service.get_project(project_id)
        await manage(db,project_id,user)
        a=await db.get(StudioArtifact,project_id)
        if not a or a.version!=p['current_version']: raise HTTPException(409,'请先构建并检查当前版本再发布')
        files=await service.list_files(project_id)
        r=await db.get(StudioRelease,project_id)
        if not r:r=StudioRelease(project_id=project_id,slug=secrets.token_urlsafe(12));db.add(r)
        r.version=a.version;r.active=True;r.artifact=a.content;r.files=json.dumps(files,ensure_ascii=False);await db.commit()
        return {'slug':r.slug,'version':r.version}


@router.delete('/projects/{project_id}/release')
async def unpublish(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        await manage(db,project_id,user)
        r=await db.get(StudioRelease,project_id)
        if r:r.active=False;await db.commit()
        return {'success':True}


@router.get('/published/{slug}')
async def published(slug:str):
    async with db_manager.session() as db:
        from models.projects import Projects
        r=await db.scalar(select(StudioRelease).where(StudioRelease.slug==slug,StudioRelease.active==True))
        p=await db.get(Projects,r.project_id) if r else None
        if not r or not p:raise HTTPException(404,'应用未发布或已下线')
        c=await db.get(StudioCloud,r.project_id)
        return {'name':p.name,'version':r.version,'artifact':json.loads(r.artifact),'cloud_slug':c.slug if c and c.enabled else None}


@router.get('/shared/{slug}/artifact')
async def share_artifact(slug:str):
    from models.projects import Projects
    async with db_manager.session() as db:
        p=await db.scalar(select(Projects).where(Projects.share_slug==slug,Projects.is_public==True))
        if not p:raise HTTPException(404,'分享未开启')
        a=await db.get(StudioArtifact,p.id);c=await db.get(StudioCloud,p.id)
        return {'artifact':json.loads(a.content) if a and a.version==p.current_version else None,'cloud_slug':c.slug if c and c.enabled else None}


@router.get('/usage')
async def usage(user:Af_users=Depends(get_af_user)):
    from models.projects import Projects
    async with db_manager.session() as db:
        rows=(await db.execute(select(StudioUsage.project_id, Projects.name,
            func.sum(StudioUsage.input_tokens), func.sum(StudioUsage.output_tokens),
            func.count(StudioUsage.id), func.max(StudioUsage.created))
            .outerjoin(Projects, Projects.id==StudioUsage.project_id)
            .where(StudioUsage.owner==str(user.id)).group_by(StudioUsage.project_id, Projects.name)
            .order_by(func.max(StudioUsage.id).desc()))).all()
        projects=[{'project_id':p,'name':name or f'已删除项目 #{p}','deleted':name is None,
                   'input_tokens':i,'output_tokens':o,'calls':count,'last_used':last}
                  for p,name,i,o,count,last in rows]
        return {'projects':projects,'input_tokens':sum(p['input_tokens'] for p in projects),
                'output_tokens':sum(p['output_tokens'] for p in projects),
                'scope':'当前账号全部项目调用记录；Codex tokens 不等同于账号额度百分比，DeepSeek 金额以供应商账单为准'}


@router.get('/usage/projects/{project_id}')
async def usage_details(project_id:int, before:int|None=Query(default=None,ge=1),
                        limit:int=Query(default=50,ge=1,le=100), user:Af_users=Depends(get_af_user)):
    from services.model_catalogue import provider_for
    async with db_manager.session() as db:
        query=select(StudioUsage).where(StudioUsage.owner==str(user.id),StudioUsage.project_id==project_id)
        if before is not None: query=query.where(StudioUsage.id<before)
        rows=(await db.execute(query.order_by(StudioUsage.id.desc()).limit(limit+1))).scalars().all()
        page=rows[:limit]
        return {'items':[{'id':r.id,'model':r.model,'provider':provider_for(r.model),'stage':r.stage,
                 'run_id':r.run_id,'input_tokens':r.input_tokens,'output_tokens':r.output_tokens,'created':r.created}
                 for r in page], 'next_cursor':page[-1].id if len(rows)>limit else None}


@router.get('/models')
async def models(user:Af_users=Depends(get_af_user)):
    from services.model_catalogue import catalogue
    return await catalogue()


@router.get('/projects/{project_id}/export')
async def export_project(project_id:int,user:Af_users=Depends(get_af_user)):
    from services.exporting import entries
    async with db_manager.session() as db:
        files=await AfProjectService(db,str(user.id)).list_files(project_id)
        cloud=await db.get(StudioCloud,project_id)
    if not files:raise HTTPException(409,'项目尚无代码')
    return {'entries':entries(files,cloud.slug if cloud and cloud.enabled else '')}


@router.get('/shared/{slug}/export')
async def export_shared(slug:str):
    from models.projects import Projects
    from services.exporting import entries
    async with db_manager.session() as db:
        p=await db.scalar(select(Projects).where(Projects.share_slug==slug,Projects.is_public==True))
        if not p:raise HTTPException(404,'分享未开启')
        files=await AfProjectService(db,str(p.user_id)).list_files(p.id)
        cloud=await db.get(StudioCloud,p.id)
    if not files:raise HTTPException(409,'项目尚无代码')
    return {'entries':entries(files,cloud.slug if cloud and cloud.enabled else '')}


class Price(BaseModel):
    input:float=Field(ge=0,le=100000,allow_inf_nan=False)
    output:float=Field(ge=0,le=100000,allow_inf_nan=False)


class BudgetInput(BaseModel):
    token_limit:int=Field(ge=0,le=1000000000)
    prices:dict[str,Price]=Field(default_factory=dict,max_length=10)


@router.get('/budget')
async def budget(user:Af_users=Depends(get_af_user)):
    from services.budget import summary
    async with db_manager.session() as db:return await summary(db,user.id)


@router.put('/budget')
async def save_budget(data:BudgetInput,user:Af_users=Depends(get_af_user)):
    from models.studio import StudioBudget
    async with db_manager.session() as db:
        b=await db.get(StudioBudget,str(user.id))
        if not b:b=StudioBudget(owner=str(user.id));db.add(b)
        b.token_limit=data.token_limit;b.prices=json.dumps(data.model_dump()['prices']);await db.commit()
    return {'success':True}
