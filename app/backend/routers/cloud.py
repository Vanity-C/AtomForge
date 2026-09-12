"""Per-generated-app accounts and data. Workspace tokens never grant access here."""
import json
import time
import uuid
from datetime import datetime,timedelta,timezone
from collections import defaultdict,deque
from fastapi import APIRouter,HTTPException,Header,Request
from pydantic import BaseModel,Field
from jose import jwt,JWTError
from sqlalchemy import select,func
from sqlalchemy.exc import IntegrityError
from core.database import db_manager
from models.studio import StudioCloud,CloudUser,CloudRecord
from models.projects import Projects
from services.af_auth import _signing_secret,hash_password,verify_password,validate_registration,normalize_email
from services.studio import model_call

router=APIRouter(prefix='/api/v1/cloud',tags=['generated-app-cloud'])
limits=defaultdict(deque)


def rate(key,limit=30):
    now=time.monotonic();q=limits[key]
    while q and now-q[0]>60:q.popleft()
    if len(q)>=limit:raise HTTPException(429,'请求过于频繁，请稍后重试')
    q.append(now)
    if len(limits)>5000:
        for k in list(limits):
            if not limits[k] or now-limits[k][-1]>60:limits.pop(k,None)


async def config(db,slug):
    c=await db.scalar(select(StudioCloud).where(StudioCloud.slug==slug,StudioCloud.enabled==True))
    if not c or not await db.get(Projects,c.project_id):raise HTTPException(404,'应用云服务未开启')
    return c


async def identity(db,c,token):
    try:
        data=jwt.decode(token or '',_signing_secret(),algorithms=['HS256'],audience='cloud:'+c.slug,issuer='atomforge-cloud')
        u=await db.get(CloudUser,data['sub'])
        if not u or u.project_id!=c.project_id:raise ValueError()
        return u
    except (JWTError,ValueError,KeyError):raise HTTPException(401,'请登录此应用')


class Credentials(BaseModel):
    email:str=Field(max_length=190)
    password:str=Field(max_length=128)


@router.post('/{slug}/{action}')
async def account(slug:str,action:str,data:Credentials,request:Request):
    if action not in {'register','login'}:raise HTTPException(404,'接口不存在')
    rate(('auth',request.client.host if request.client else 'unknown'),20)
    async with db_manager.session() as db:
        c=await config(db,slug);email=normalize_email(data.email)
        u=await db.scalar(select(CloudUser).where(CloudUser.project_id==c.project_id,CloudUser.email==email))
        if action=='register':
            validate_registration(email,data.password,'app-user')
            if u:raise HTTPException(409,'此邮箱已注册')
            count=await db.scalar(select(func.count()).select_from(CloudUser).where(CloudUser.project_id==c.project_id))
            if count>=1000:raise HTTPException(429,'演示应用用户数量已达上限')
            u=CloudUser(id=uuid.uuid4().hex,project_id=c.project_id,email=email,password_hash=hash_password(data.password));db.add(u)
            try:await db.commit()
            except IntegrityError:await db.rollback();raise HTTPException(409,'此邮箱已注册')
        elif not u or not verify_password(data.password,u.password_hash):raise HTTPException(401,'邮箱或密码不正确')
        token=jwt.encode({'sub':u.id,'aud':'cloud:'+slug,'iss':'atomforge-cloud','exp':datetime.now(timezone.utc)+timedelta(days=7)},_signing_secret(),algorithm='HS256')
        return {'access_token':token,'user':{'id':u.id,'email':u.email}}


@router.get('/{slug}/me')
async def me(slug:str,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        c=await config(db,slug);u=await identity(db,c,x_app_token);return {'user':{'id':u.id,'email':u.email}}


def policy(c,collection):
    p=json.loads(c.collections).get(collection)
    if p not in {'private','shared'}:raise HTTPException(403,'集合未配置，请在项目云服务中创建集合')
    return p


class Record(BaseModel):
    data:dict

    def encoded(self):
        raw=json.dumps(self.data,ensure_ascii=False)
        if len(raw.encode())>20000:raise HTTPException(413,'记录过大')
        return raw


@router.get('/{slug}/data/{collection}')
async def rows(slug:str,collection:str,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        c=await config(db,slug);u=await identity(db,c,x_app_token);p=policy(c,collection)
        q=select(CloudRecord).where(CloudRecord.project_id==c.project_id,CloudRecord.collection==collection)
        if p=='private':q=q.where(CloudRecord.user_id==u.id)
        rs=(await db.execute(q.order_by(CloudRecord.id).limit(500))).scalars().all()
        return {'items':[{'id':r.id,'data':json.loads(r.data)} for r in rs]}


@router.post('/{slug}/data/{collection}')
async def create(slug:str,collection:str,data:Record,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        c=await config(db,slug);u=await identity(db,c,x_app_token);policy(c,collection);rate(('data',u.id))
        count=await db.scalar(select(func.count()).select_from(CloudRecord).where(CloudRecord.project_id==c.project_id))
        if count>=5000:raise HTTPException(429,'此应用已达到数据记录上限')
        r=CloudRecord(id=uuid.uuid4().hex,project_id=c.project_id,collection=collection,user_id=u.id,data=data.encoded());db.add(r);await db.commit()
        return {'item':{'id':r.id,'data':data.data}}


async def owned_row(db,c,u,collection,record_id):
    p=policy(c,collection);r=await db.get(CloudRecord,record_id)
    if not r or r.project_id!=c.project_id or r.collection!=collection or (p=='private' and r.user_id!=u.id):raise HTTPException(404,'记录不存在')
    return r


@router.put('/{slug}/data/{collection}/{record_id}')
async def update(slug:str,collection:str,record_id:str,data:Record,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        c=await config(db,slug);u=await identity(db,c,x_app_token);rate(('data',u.id));r=await owned_row(db,c,u,collection,record_id)
        r.data=data.encoded();await db.commit();return {'item':{'id':r.id,'data':data.data}}


@router.delete('/{slug}/data/{collection}/{record_id}')
async def remove(slug:str,collection:str,record_id:str,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        c=await config(db,slug);u=await identity(db,c,x_app_token);rate(('data',u.id));r=await owned_row(db,c,u,collection,record_id)
        await db.delete(r);await db.commit();return {'success':True}


class Prompt(BaseModel):
    prompt:str=Field(min_length=1,max_length=6000)


@router.post('/{slug}/ai/chat')
async def ai(slug:str,data:Prompt,x_app_token:str|None=Header(default=None)):
    async with db_manager.session() as db:
        c=await config(db,slug);u=await identity(db,c,x_app_token)
        if not c.ai_enabled:raise HTTPException(403,'此应用未开启 AI 服务')
        rate(('ai-user',u.id),3);rate(('ai-app',c.project_id),10);rate(('ai-global',),20)
        p=await db.get(Projects,c.project_id)
    result=await model_call(p.user_id,p.id,'cloud-'+u.id,'deepseek-flash','app-ai',[{'role':'system','content':'你是应用内助手。回答用户问题，返回 JSON {"content":"回答正文"}。'},{'role':'user','content':data.prompt}],1500)
    return {'content':str(result.get('content',''))}
