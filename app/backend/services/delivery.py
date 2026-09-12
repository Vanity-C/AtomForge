import asyncio
import json
import time
import uuid
from fastapi import HTTPException
from sqlalchemy import select, update
from core.database import db_manager
from models.delivery import Delivery
from models.studio import StudioArtifact, StudioCloud, StudioSequence
from services.af_projects import AfProjectService
from services.connections import read_connection
from services.oauth import token_for
from services import publishing, deploying
from services.exporting import entries

TASKS=set()

def public(row):
    return {'id':row.id,'project_id':row.project_id,'kind':row.kind,'provider':row.provider,'version':row.version,'status':row.status,'stage':row.stage,'result':json.loads(row.result),'error':row.error,'created':row.created}

async def credentials(db, owner, pid, provider):
    connection=await read_connection(db,pid)
    if connection.get(provider+'_token'):return connection[provider+'_token']
    return await token_for(db,owner,provider)

async def progress(job_id, stage, result=None, status='running', error=''):
    async with db_manager.session() as db:
        row=await db.get(Delivery,job_id)
        if not row:return
        row.stage=stage;row.status=status;row.error=error
        row.result=json.dumps({**json.loads(row.result),**(result or {})})
        await db.commit()

async def execute(job_id):
    try:
        async with db_manager.session() as db:
            row=await db.get(Delivery,job_id)
            if not row:return
            payload=json.loads(row.request);saved=json.loads(row.result)
            token=await credentials(db,row.owner,row.project_id,row.provider)
            provider,kind,pid,version=row.provider,row.kind,row.project_id,row.version
        async def record(stage,result):await progress(job_id,stage,result)
        await record('preparing',{})
        if kind=='publish':
            result=await publishing.publish(provider,token,payload['files'],payload.get('repository',''),payload.get('name',''),payload['private'],payload['branch'],f'AtomForge v{version}',record)
        else:
            archive=deploying.bundle(payload['artifact'],payload['title'],job_id,payload.get('slug',''))
            result=await deploying.deploy(token,archive,pid,job_id,saved,record,slug=payload.get('slug',''))
        await progress(job_id,'done',result,'done')
    except asyncio.CancelledError:
        await progress(job_id,'interrupted',status='interrupted',error='服务已重启，进度已保存；可继续检查或重新发布')
        raise
    except HTTPException as exc:await progress(job_id,'error',status='error',error=str(exc.detail))
    except Exception:await progress(job_id,'error',status='error',error='外部服务返回异常，进度已保留，请重试或检查授权配置')

def launch(job_id):
    task=asyncio.create_task(execute(job_id));TASKS.add(task);task.add_done_callback(TASKS.discard)

async def create(db, owner, pid, data):
    project=await AfProjectService(db,str(owner))._load_owned_project(pid,manage=True)
    # Serialize delivery submissions across tabs/processes with an existing project sequence row.
    await db.execute(update(StudioSequence).where(StudioSequence.key=='project_id').values(value=StudioSequence.value))
    # Database write lock (SQLite) / project row lock (PostgreSQL).
    from models.projects import Projects
    await db.execute(select(Projects).where(Projects.id==pid).with_for_update())
    active=await db.scalar(select(Delivery.id).where(Delivery.project_id==pid,Delivery.status.in_(['queued','running'])))
    if active:raise HTTPException(409,'这个项目已有发布或部署进行中，请等待完成')
    await credentials(db,owner,pid,data['provider'])
    artifact=await db.get(StudioArtifact,pid)
    files=await AfProjectService(db,str(owner)).list_files(pid)
    if not files:raise HTTPException(409,'请先生成并保存应用代码')
    cloud=await db.get(StudioCloud,pid)
    slug=cloud.slug if cloud and cloud.enabled else ''
    job_id=uuid.uuid4().hex
    payload={**data,'title':project.name,'slug':slug}
    saved={}
    if data['kind']=='deploy':
        if not artifact or artifact.version!=project.current_version:raise HTTPException(409,'请先构建检查当前版本，再部署到公网')
        payload['artifact']=json.loads(artifact.content)
        deploying.cloud_origin(slug)
        latest=await db.scalar(select(Delivery).where(Delivery.project_id==pid,Delivery.kind=='deploy').order_by(Delivery.created.desc()))
        if latest:
            site=json.loads(latest.result).get('site_id')
            if site:saved['site_id']=site
    else:
        payload['files']=entries(files,slug)
        payload['branch']=f'atomforge-v{project.current_version}-{job_id[:8]}'
    row=Delivery(id=job_id,project_id=pid,owner=owner,kind=data['kind'],provider=data['provider'],version=project.current_version,request=json.dumps(payload),result=json.dumps(saved),created=time.time())
    db.add(row);await db.commit()
    return row

async def recover():
    async with db_manager.session() as db:
        await db.execute(update(Delivery).where(Delivery.status.in_(['queued','running'])).values(status='interrupted',error='服务重启，进度已保存。请继续检查或重新发布。'))
        await db.commit()

async def shutdown():
    for task in list(TASKS):task.cancel()
    if TASKS:await asyncio.gather(*TASKS,return_exceptions=True)
