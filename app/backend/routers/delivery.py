import json
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update
from core.database import get_db
from dependencies.af_auth import get_af_user
from models.delivery import Delivery
from models.studio import StudioArtifact, StudioSequence, StudioCloud
from services.af_projects import AfProjectService
from services import delivery, deploying

router=APIRouter(prefix='/api/v1/delivery',tags=['delivery'])

class Submit(BaseModel):
    kind: Literal['publish','deploy']
    provider: Literal['github','gitee','netlify']
    name: str=Field('',max_length=80,pattern=r'^[a-zA-Z0-9_.-]*$')
    repository: str=Field('',max_length=180,pattern=r'^(?:[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)?$')
    private: bool=True
    @model_validator(mode='after')
    def valid_target(self):
        if (self.kind=='deploy') != (self.provider=='netlify'):raise ValueError('部署请选择 Netlify，源码发布请选择 GitHub 或 Gitee')
        if self.kind=='publish' and not (self.name or self.repository):raise ValueError('请填写仓库名称')
        if self.name in {'.','..'} or any(p in {'.','..'} for p in self.repository.split('/') if p):raise ValueError('仓库名称无效')
        return self

async def own(db,pid,user):
    return await AfProjectService(db,str(user.id))._load_owned_project(pid,manage=True)

@router.get('/projects/{pid}')
async def list_jobs(pid:int,user=Depends(get_af_user),db=Depends(get_db)):
    p=await own(db,pid,user)
    rows=(await db.execute(select(Delivery).where(Delivery.project_id==pid).order_by(Delivery.created.desc()).limit(30))).scalars().all()
    artifact=await db.get(StudioArtifact,pid)
    cloud=await db.get(StudioCloud,pid)
    reason=''
    try:deploying.cloud_origin(cloud.slug if cloud and cloud.enabled else '')
    except HTTPException as exc:reason=str(exc.detail)
    connections={}
    for provider in ['github','gitee','netlify']:
        try:await delivery.credentials(db,user.id,pid,provider);connections[provider]=True
        except HTTPException:connections[provider]=False
    return {'items':[delivery.public(r) for r in rows],'version':p.current_version,'build_ready':bool(artifact and artifact.version==p.current_version),'deploy_blocker':reason,'connections':connections}

@router.post('/projects/{pid}')
async def submit(pid:int,data:Submit,user=Depends(get_af_user),db=Depends(get_db)):
    row=await delivery.create(db,user.id,pid,data.model_dump())
    delivery.launch(row.id)
    return delivery.public(row)

@router.post('/projects/{pid}/{job_id}/retry')
async def retry(pid:int,job_id:str,user=Depends(get_af_user),db=Depends(get_db)):
    await own(db,pid,user)
    await db.execute(update(StudioSequence).where(StudioSequence.key=='project_id').values(value=StudioSequence.value))
    from models.projects import Projects
    await db.execute(select(Projects).where(Projects.id==pid).with_for_update())
    row=await db.get(Delivery,job_id)
    if not row or row.project_id!=pid:raise HTTPException(404,'发布记录不存在')
    if row.status not in {'error','interrupted'}:raise HTTPException(409,'此任务无需重试')
    if await db.scalar(select(Delivery.id).where(Delivery.project_id==pid,Delivery.status.in_(['queued','running']))):raise HTTPException(409,'请等待当前发布任务完成')
    await delivery.credentials(db,user.id,pid,row.provider)
    if row.kind=='publish':
        import uuid,time
        payload=json.loads(row.request);result=json.loads(row.result)
        new_id=uuid.uuid4().hex
        payload['repository']=result.get('repository') or payload.get('repository','')
        payload['branch']=f'atomforge-v{row.version}-{new_id[:8]}'
        row=Delivery(id=new_id,owner=user.id,project_id=pid,kind=row.kind,provider=row.provider,version=row.version,created=time.time(),request=json.dumps(payload))
        db.add(row)
    else:
        row.status='queued';row.error='';row.stage='queued'
    await db.commit();delivery.launch(row.id)
    return delivery.public(row)
