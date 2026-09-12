import json
import re
import uuid
from urllib.parse import quote,urlsplit
import httpx
import stripe
from fastapi import APIRouter,Depends,HTTPException,Request,Header
from pydantic import BaseModel,Field
from sqlalchemy import select
from core.database import db_manager
from dependencies.af_auth import get_af_user
from models.af_users import Af_users
from models.studio import StudioRelease,CloudRecord
from services.af_projects import AfProjectService
from services.connections import read_connection,save_connection
from routers.cloud import config,identity,rate

router=APIRouter(prefix='/api/v1/connections',tags=['connections'])
SECRET_FIELDS={'github_token','gitee_token','netlify_token','stripe_secret','stripe_webhook_secret','tavily_key'}


class Config(BaseModel):
    gitee_token:str|None=Field(default=None,max_length=1000)
    netlify_token:str|None=Field(default=None,max_length=1000)
    tavily_key:str|None=Field(default=None,max_length=500)
    github_token:str|None=Field(default=None,max_length=500)
    github_repo:str|None=Field(default=None,max_length=160)
    stripe_secret:str|None=Field(default=None,max_length=500)
    stripe_webhook_secret:str|None=Field(default=None,max_length=500)
    stripe_price_id:str|None=Field(default=None,max_length=100)
    public_base_url:str|None=Field(default=None,max_length=300)


async def owner(db,pid,user):
    return await AfProjectService(db,str(user.id))._load_owned_project(pid,manage=True)


@router.get('/projects/{project_id}')
async def get(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        await owner(db,project_id,user);data=await read_connection(db,project_id)
        return {**{k:v for k,v in data.items() if k not in SECRET_FIELDS},**{k+'_configured':bool(data.get(k)) for k in SECRET_FIELDS}}


@router.put('/projects/{project_id}')
async def put(project_id:int,data:Config,user:Af_users=Depends(get_af_user)):
    if data.github_repo and not re.fullmatch(r'[\w.-]+/[\w.-]+',data.github_repo):raise HTTPException(400,'仓库格式为 owner/repo')
    if data.public_base_url:
        u=urlsplit(data.public_base_url)
        if u.scheme!='https' or not u.hostname or u.username or u.query or u.fragment or u.path not in {'','/'}:raise HTTPException(400,'公网地址须为 HTTPS 站点根地址')
    async with db_manager.session() as db:
        await owner(db,project_id,user);await save_connection(db,project_id,data.model_dump(exclude_none=True))
        return {'success':True}


@router.delete('/projects/{project_id}')
async def disconnect(project_id:int,user:Af_users=Depends(get_af_user)):
    from models.studio import StudioConnection
    async with db_manager.session() as db:
        await owner(db,project_id,user);r=await db.get(StudioConnection,project_id)
        if r:await db.delete(r);await db.commit()
        return {'success':True}


async def github(client,method,url,**kwargs):
    r=await client.request(method,url,**kwargs)
    if r.status_code>=400:raise HTTPException(502,f'GitHub 请求失败（{r.status_code}），请检查仓库权限或远端是否有新提交')
    return r.json()


@router.post('/projects/{project_id}/github')
async def sync_github(project_id:int,user:Af_users=Depends(get_af_user)):
    async with db_manager.session() as db:
        p=await owner(db,project_id,user);c=await read_connection(db,project_id)
        files=await AfProjectService(db,str(user.id)).list_files(project_id)
    if not c.get('github_token') or not c.get('github_repo'):raise HTTPException(409,'请先配置 GitHub 仓库和令牌')
    if not files:raise HTTPException(409,'项目尚无代码')
    from services.exporting import entries as export_entries
    from models.studio import StudioCloud
    async with db_manager.session() as db:cloud=await db.get(StudioCloud,project_id)
    files=export_entries(files,cloud.slug if cloud and cloud.enabled else '')
    repo=c['github_repo'];branch='atomforge-'+str(project_id)
    async with httpx.AsyncClient(base_url='https://api.github.com',headers={'Authorization':'Bearer '+c['github_token'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},timeout=25) as client:
        root='/repos/'+repo
        info=await github(client,'GET',root)
        ref=await client.get(root+'/git/ref/heads/'+branch)
        exists=ref.status_code==200
        if ref.status_code not in {200,404}:raise HTTPException(502,'读取 GitHub 分支失败')
        head=ref.json() if exists else await github(client,'GET',root+'/git/ref/heads/'+quote(info['default_branch'],safe=''))
        sha=head['object']['sha'];commit=await github(client,'GET',root+'/git/commits/'+sha)
        # Keep all remote files outside this project's generated/ directory.
        tree=await github(client,'GET',root+'/git/trees/'+commit['tree']['sha']+'?recursive=1')
        if tree.get('truncated'):raise HTTPException(409,'远端仓库过大，无法安全同步')
        entries=[{'path':'generated/'+f['path'],'mode':'100644','type':'blob','content':f['content']} for f in files]
        current={e['path'] for e in entries}
        entries.extend({'path':e['path'],'mode':'100644','type':'blob','sha':None} for e in tree.get('tree',[]) if e['type']=='blob' and e['path'].startswith('generated/') and e['path'] not in current)
        built=await github(client,'POST',root+'/git/trees',json={'base_tree':commit['tree']['sha'],'tree':entries})
        new=await github(client,'POST',root+'/git/commits',json={'message':f'AtomForge: {p.name} v{p.current_version}','tree':built['sha'],'parents':[sha]})
        if exists:await github(client,'PATCH',root+'/git/refs/heads/'+branch,json={'sha':new['sha'],'force':False})
        else:await github(client,'POST',root+'/git/refs',json={'ref':'refs/heads/'+branch,'sha':new['sha']})
    return {'url':'https://github.com/'+repo+'/tree/'+branch+'/generated','commit':new['sha'],'branch':branch}


@router.post('/cloud/{slug}/checkout')
async def checkout(slug:str,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        cloud=await config(db,slug);u=await identity(db,cloud,x_app_token);rate(('checkout',u.id),3)
        c=await read_connection(db,cloud.project_id);release=await db.get(StudioRelease,cloud.project_id)
        if not all(c.get(k) for k in ['stripe_secret','stripe_price_id','stripe_webhook_secret','public_base_url']) or not release or not release.active:raise HTTPException(409,'支付配置或应用发布尚未完成')
        return_url=c['public_base_url'].rstrip('/')+'/apps/'+release.slug
        async with httpx.AsyncClient(timeout=25) as client:
            r=await client.post('https://api.stripe.com/v1/checkout/sessions',auth=(c['stripe_secret'],''),headers={'Idempotency-Key':uuid.uuid4().hex},data={'mode':'payment','line_items[0][price]':c['stripe_price_id'],'line_items[0][quantity]':'1','success_url':return_url+'?payment=success','cancel_url':return_url+'?payment=cancelled','client_reference_id':u.id,'metadata[project_id]':str(cloud.project_id)})
        if r.status_code>=400:raise HTTPException(502,'Stripe 创建收款页面失败，请检查价格和测试/正式密钥是否匹配')
        session=r.json();url=session.get('url','')
        if urlsplit(url).hostname!='checkout.stripe.com':raise HTTPException(502,'Stripe 未返回有效收款地址')
        db.add(CloudRecord(id='payment-'+session['id'],project_id=cloud.project_id,collection='_payments',user_id=u.id,data=json.dumps({'status':'pending','session_id':session['id']})));await db.commit()
        return {'url':url}


@router.get('/cloud/{slug}/payments')
async def payments(slug:str,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        cloud=await config(db,slug);u=await identity(db,cloud,x_app_token)
        rows=(await db.execute(select(CloudRecord).where(CloudRecord.project_id==cloud.project_id,CloudRecord.user_id==u.id,CloudRecord.collection=='_payments'))).scalars().all()
        return {'items':[json.loads(r.data) for r in rows]}


@router.post('/stripe/{project_id}/webhook')
async def webhook(project_id:int,request:Request,stripe_signature:str|None=Header(default=None)):
    payload=await request.body()
    async with db_manager.session() as db:
        c=await read_connection(db,project_id)
        if not c.get('stripe_webhook_secret'):raise HTTPException(404,'支付未配置')
        try:event=stripe.Webhook.construct_event(payload,stripe_signature or '',c['stripe_webhook_secret'])
        except (ValueError,stripe.SignatureVerificationError):raise HTTPException(400,'支付回调签名无效')
        # Stripe SDK resource objects vary by version; parse the verified bytes.
        event=json.loads(payload)
        if event['type'] not in {'checkout.session.completed','checkout.session.async_payment_succeeded'}:return {'received':True}
        obj=event['data']['object'];row=await db.get(CloudRecord,'payment-'+obj['id'])
        if not row or row.project_id!=project_id or obj.get('client_reference_id')!=row.user_id or obj.get('metadata',{}).get('project_id')!=str(project_id):raise HTTPException(400,'支付记录不匹配')
        if obj.get('payment_status')=='paid':row.data=json.dumps({'status':'paid','session_id':obj['id'],'event_id':event['id']});await db.commit()
        return {'received':True}
