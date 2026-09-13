import secrets
from typing import Literal
from fastapi import APIRouter, Depends, Request, Response, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from core.database import get_db
from dependencies.af_auth import get_optional_af_user, get_af_user
from models.af_users import Af_users
from services import oauth
from services.af_auth import public_profile, create_session_token

router=APIRouter(prefix='/api/v1/af-auth/oauth',tags=['oauth'])
COOKIE='af_oauth_browser'

class Start(BaseModel):
    purpose: Literal['login','connect']='login'
    redirect: str=Field('/dashboard',max_length=300)

class Exchange(BaseModel):
    ticket: str=Field(min_length=20,max_length=200)

class Transfer(Exchange):
    confirm: bool

@router.get('/providers')
async def providers(response:Response,user=Depends(get_optional_af_user),db=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    return {'items':await oauth.providers(db,user)}

@router.post('/{provider}/start')
async def start(provider:str,data:Start,request:Request,response:Response,user=Depends(get_optional_af_user),db=Depends(get_db)):
    # An origin mismatch loses the browser-bound cookie on the callback. Detect it
    # before asking the user to approve an authorization that cannot succeed.
    source=request.headers.get('origin')
    if source and source.rstrip('/')!=oauth.app_origin():
        raise HTTPException(409,'登录地址与授权回调不一致，请从 '+oauth.app_origin()+' 打开 AtomForge 后重试（localhost 与 127.0.0.1 不能混用）。')
    browser=request.cookies.get(COOKIE) or secrets.token_urlsafe(32)
    url=await oauth.begin(db,provider,browser,user,data.purpose,data.redirect)
    response.set_cookie(COOKIE,browser,max_age=900,httponly=True,secure=oauth.app_origin().startswith('https:'),samesite='lax',path='/api/v1/af-auth/oauth')
    response.headers['Cache-Control']='no-store'
    return {'url':url}

@router.get('/{provider}/callback')
async def callback(provider:str,request:Request,code:str='',state:str='',error:str='',db=Depends(get_db)):
    try:
        if error or not code: raise HTTPException(400,'授权已取消，请重新选择登录方式')
        ticket=await oauth.callback(db,provider,state,request.cookies.get(COOKIE,''),code)
        target=oauth.app_origin()+'/auth/callback?ticket='+ticket
    except HTTPException as exc:
        from urllib.parse import urlencode
        target=oauth.app_origin()+'/auth/callback?'+urlencode({'error':str(exc.detail)})
    return RedirectResponse(target,status_code=303,headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})

@router.post('/exchange')
async def exchange(data:Exchange,request:Request,response:Response,user=Depends(get_optional_af_user),db=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    pending=await oauth.inspect_flow(db,data.ticket,request.cookies.get(COOKIE,''))
    if pending.get('purpose')=='transfer':
        oauth.require_transfer_owner(pending,user)
        return {'status':'confirmation_required','provider':pending['provider'],'login':pending['login'],'target_name':user.display_name or user.username}
    flow=await oauth.consume(db,data.ticket,request.cookies.get(COOKIE,''))
    if flow.get('purpose')!='exchange':raise HTTPException(400,'无效的登录凭证')
    user=await db.get(Af_users,flow['owner'])
    if not user or (user.status or 'active')!='active':raise HTTPException(403,'账号不可用')
    if flow.get('session_version',0)!=user.session_version:raise HTTPException(400,'密码已更新，请重新发起授权')
    response.headers['Cache-Control']='no-store'
    return {**create_session_token(user),'user':public_profile(user),'redirect':flow['redirect']}

@router.post('/transfer')
async def transfer(data:Transfer,request:Request,response:Response,user=Depends(get_af_user),db=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    return await oauth.resolve_transfer(db,data.ticket,request.cookies.get(COOKIE,''),user,data.confirm)
