import base64
import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import urlencode, urlsplit
import httpx
from fastapi import HTTPException
from sqlalchemy import select, delete, update
from sqlalchemy.exc import IntegrityError
from models.delivery import ExternalIdentity, OAuthFlow, Delivery
from models.af_users import Af_users
from services.connections import cipher
from services.af_auth import public_profile, create_session_token

PROVIDERS = {
    'github': {'name':'GitHub','authorize':'https://github.com/login/oauth/authorize','token':'https://github.com/login/oauth/access_token','api':'https://api.github.com'},
    'gitee': {'name':'Gitee','authorize':'https://gitee.com/oauth/authorize','token':'https://gitee.com/oauth/token','api':'https://gitee.com/api/v5'},
    'netlify': {'name':'Netlify','authorize':'https://app.netlify.com/authorize','token':'https://api.netlify.com/oauth/token','api':'https://api.netlify.com/api/v1'},
}

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def pack(value):
    return cipher().encrypt(json.dumps(value).encode()).decode()

def unpack(value):
    return json.loads(cipher().decrypt(value.encode()))

def provider_config(provider):
    if provider not in PROVIDERS: raise HTTPException(404, '不支持的账号平台')
    prefix = 'ATOMFORGE_'+provider.upper()
    return {**PROVIDERS[provider], 'client_id':os.getenv(prefix+'_CLIENT_ID','').strip(), 'client_secret':os.getenv(prefix+'_CLIENT_SECRET','').strip()}

def app_origin():
    origin = os.getenv('ATOMFORGE_PUBLIC_ORIGIN','').strip().rstrip('/')
    u = urlsplit(origin)
    if not u.hostname or u.username or u.password or u.query or u.fragment or u.path or (u.scheme!='https' and not (u.scheme=='http' and u.hostname in {'localhost','127.0.0.1'})):
        raise HTTPException(503, '请管理员配置 ATOMFORGE_PUBLIC_ORIGIN 和第三方 OAuth 应用')
    return origin


def configuration_issue(config):
    try:app_origin()
    except HTTPException:return 'origin_missing'
    if not config['client_id'] or not config['client_secret']:return 'credentials_missing'
    return ''

def return_path(path):
    return path if path.startswith('/') and not path.startswith('//') and '\\' not in path and not any(ord(c)<32 for c in path) else '/dashboard'

async def providers(db, user=None):
    linked = {r.provider:r for r in (await db.execute(select(ExternalIdentity).where(ExternalIdentity.owner==user.id))).scalars()} if user else {}
    result=[]
    for key in PROVIDERS:
        config=provider_config(key)
        try: origin=app_origin()
        except HTTPException: origin=''
        row=linked.get(key)
        issue=configuration_issue(config)
        result.append({'id':key,'name':config['name'],'configured':not issue,'configuration_issue':issue, 'connected':bool(row), 'login':row.login if row else '', 'publish_authorized':bool(row and ('repo' in row.scope.split() or 'projects' in row.scope.split())), 'callback_url':origin+'/api/v1/af-auth/oauth/'+key+'/callback' if origin else ''})
    return result

async def begin(db, provider, browser, user, purpose, redirect):
    c=provider_config(provider); origin=app_origin()
    if not c['client_id'] or not c['client_secret']: raise HTTPException(503, c['name']+' 登录尚未配置，请管理员填写 OAuth Client ID 和 Client Secret')
    if purpose=='connect' and not user: raise HTTPException(401, '绑定账号前请先登录')
    if provider=='netlify' and purpose!='connect': raise HTTPException(400,'Netlify 仅用于连接部署账号，请先登录 AtomForge')
    state=secrets.token_urlsafe(32); verifier=secrets.token_urlsafe(48)
    scope=('read:user user:email' if provider=='github' else 'user_info' if provider=='gitee' else '')
    if purpose=='connect': scope+=(' repo' if provider=='github' else ' projects' if provider=='gitee' else '')
    callback=origin+'/api/v1/af-auth/oauth/'+provider+'/callback'
    payload={'provider':provider,'owner':user.id if purpose=='connect' else None,'purpose':purpose,'redirect':return_path(redirect),'verifier':verifier,'callback':callback,'scope':scope}
    if purpose=='connect':payload['session_version']=user.session_version
    await db.execute(delete(OAuthFlow).where(OAuthFlow.expires<time.time()))
    db.add(OAuthFlow(key=digest(state),browser=digest(browser),expires=time.time()+600,encrypted=pack(payload)))
    await db.commit()
    query={'client_id':c['client_id'],'redirect_uri':callback,'response_type':'code','state':state,'scope':scope}
    if provider=='github': query.update(code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),code_challenge_method='S256')
    if not scope:query.pop('scope')
    return c['authorize']+'?'+urlencode(query)

async def inspect_flow(db, key, browser):
    row=await db.get(OAuthFlow,digest(key))
    if not row or row.expires<time.time() or not secrets.compare_digest(row.browser,digest(browser)):
        raise HTTPException(400,'授权已过期或浏览器不匹配，请重新发起授权')
    return unpack(row.encrypted)

async def consume(db, key, browser, commit=True):
    payload=await inspect_flow(db,key,browser)
    result=await db.execute(delete(OAuthFlow).where(OAuthFlow.key==digest(key),OAuthFlow.expires>=time.time()))
    if result.rowcount!=1: raise HTTPException(400,'授权已使用，请重新发起授权')
    if commit:await db.commit()
    return payload

async def api(provider, token, method, path, **kwargs):
    config=provider_config(provider)
    headers={'Authorization':'Bearer '+token,'Accept':'application/json'}
    if provider=='github': headers.update({'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r=await client.request(method,config['api']+path,headers=headers,**kwargs)
    except httpx.HTTPError: raise HTTPException(502, config['name']+' 暂时无法连接，请稍后重试') from None
    if r.status_code==429:raise HTTPException(429,config['name']+' 请求频率已达到限制，请稍后重试')
    if r.status_code>=400: raise HTTPException(409 if r.status_code in {401,403,404,409,422} else 502, config['name']+f' 请求未完成（{r.status_code}），请检查授权是否过期、操作权限或目标名称是否已被占用')
    return r.json() if r.content else {}

async def callback(db, provider, state, browser, code):
    flow=await consume(db,state,browser)
    if flow.get('provider')!=provider or flow.get('purpose') not in {'login','connect'}: raise HTTPException(400,'授权平台不匹配')
    if flow['owner']:
        owner=await db.get(Af_users,flow['owner'])
        if not owner or flow.get('session_version',0)!=owner.session_version:
            raise HTTPException(400,'密码已更新，请重新发起授权')
    c=provider_config(provider)
    data={'grant_type':'authorization_code','client_id':c['client_id'],'client_secret':c['client_secret'],'code':code,'redirect_uri':flow['callback']}
    if provider=='github':data['code_verifier']=flow['verifier']
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            r=await client.post(c['token'],data=data,headers={'Accept':'application/json'})
        token_data=r.json()
        if r.status_code>=400 or not token_data.get('access_token'): raise ValueError()
    except (httpx.HTTPError, ValueError): raise HTTPException(502,'第三方授权未完成，请重新授权') from None
    profile=await api(provider,token_data['access_token'],'GET','/user')
    granted=token_data.get('scope',flow['scope'])
    granted=' '.join(granted) if isinstance(granted,list) else str(granted).replace(',',' ')
    if provider=='netlify': profile['login']=profile.get('slug') or profile.get('full_name') or profile.get('email') or str(profile.get('id',''))
    subject=str(profile.get('id',''))
    if not subject or not profile.get('login'): raise HTTPException(502,'未能获取第三方账号身份')
    row=(await db.execute(select(ExternalIdentity).where(ExternalIdentity.provider==provider,ExternalIdentity.subject==subject))).scalar_one_or_none()
    if row and flow['owner'] and row.owner!=flow['owner']:
        target=await db.get(Af_users,flow['owner'])
        if not target or (target.status or 'active')!='active':raise HTTPException(403,'账号不可用')
        existing=await db.scalar(select(ExternalIdentity.id).where(ExternalIdentity.owner==target.id,ExternalIdentity.provider==provider))
        if existing:raise HTTPException(409,'当前账号已绑定其他 '+c['name']+' 身份，无法转移绑定')
        ticket=secrets.token_urlsafe(32)
        pending={'purpose':'transfer','owner':target.id,'provider':provider,'identity':row.id,'previous_owner':row.owner,'previous_encrypted':row.encrypted,'login':profile['login'],'token_data':token_data,'scope':granted,'redirect':'/account'}
        pending['session_version']=target.session_version
        db.add(OAuthFlow(key=digest(ticket),browser=digest(browser),expires=time.time()+600,encrypted=pack(pending)))
        await db.commit()
        return ticket
    user=await db.get(Af_users,flow['owner'] or (row.owner if row else 0))
    if not user:
        if flow['owner'] or row: raise HTTPException(403,'关联账号不存在')
        # Provider IDs are authoritative. Never merge accounts by an unverified email.
        username=provider+'_'+subject
        user=Af_users(email=username+'@identity.atomforge.invalid',password_hash='',display_name=username,username=username,username_key=username,status='active')
        db.add(user);await db.flush()
    if (user.status or 'active')!='active': raise HTTPException(403,'该账号已被停用')
    user.last_login_at=datetime.now(timezone.utc).isoformat()
    if not row:
        existing=(await db.execute(select(ExternalIdentity).where(ExternalIdentity.owner==user.id,ExternalIdentity.provider==provider))).scalar_one_or_none()
        if existing: raise HTTPException(409,'当前账号已绑定此平台的其他身份')
        row=ExternalIdentity(owner=user.id,provider=provider,subject=subject,login=profile['login'],encrypted=pack(token_data),scope=granted)
        db.add(row)
    else:
        # A login-only consent must not discard an existing repository grant.
        if flow['purpose']=='connect' or not row.scope:
            row.encrypted=pack(token_data);row.scope=granted
        row.login=profile['login']
    ticket=secrets.token_urlsafe(32)
    db.add(OAuthFlow(key=digest(ticket),browser=digest(browser),expires=time.time()+120,encrypted=pack({'purpose':'exchange','owner':user.id,'session_version':user.session_version,'redirect':flow['redirect']})))
    try: await db.commit()
    except IntegrityError:
        await db.rollback();raise HTTPException(409,'账号关联发生冲突，请重新登录后绑定') from None
    return ticket

def require_transfer_owner(flow,user):
    if flow.get('purpose')!='transfer':raise HTTPException(400,'无效的绑定转移凭证')
    if not user or user.id!=flow['owner']:raise HTTPException(403,'请使用发起连接的 AtomForge 账号确认转移')
    if flow.get('session_version',0)!=user.session_version:raise HTTPException(400,'密码已更新，请重新连接并确认')

async def resolve_transfer(db,ticket,browser,user,confirm):
    flow=await inspect_flow(db,ticket,browser)
    require_transfer_owner(flow,user)
    name=PROVIDERS[flow['provider']]['name']
    await consume(db,ticket,browser,commit=False)
    if confirm:
        # Match delivery.create's submission lock so no job can retain the old
        # owner's OAuth token while a transfer is being committed.
        from models.studio import StudioSequence
        await db.execute(update(StudioSequence).where(StudioSequence.key=='project_id').values(value=StudioSequence.value))
        active=await db.scalar(select(Delivery.id).where(Delivery.owner==flow['previous_owner'],Delivery.provider==flow['provider'],Delivery.status.in_(['queued','running'])))
        if active:
            await db.rollback()
            raise HTTPException(409,'原账号正在使用 '+name+' 发布项目，请等待发布完成后再次确认')
        existing=await db.scalar(select(ExternalIdentity.id).where(ExternalIdentity.owner==user.id,ExternalIdentity.provider==flow['provider']))
        if existing:
            await db.rollback()
            raise HTTPException(409,'当前账号的 '+name+' 绑定已发生变化，请重新连接')
        # Compare the identity and its authorization snapshot as well as the owner:
        # another confirmation or reauthorization must invalidate this consent.
        result=await db.execute(update(ExternalIdentity).where(ExternalIdentity.id==flow['identity'],ExternalIdentity.owner==flow['previous_owner'],ExternalIdentity.encrypted==flow['previous_encrypted']).values(owner=user.id,login=flow['login'],encrypted=pack(flow['token_data']),scope=flow['scope']))
        if result.rowcount!=1:
            await db.rollback()
            raise HTTPException(409,name+' 绑定已发生变化，请重新连接并确认')
    try:await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409,'账号关联发生冲突，请重新连接') from None
    return {'redirect':'/account','transferred':confirm}

async def token_for(db, owner, provider):
    row=(await db.execute(select(ExternalIdentity).where(ExternalIdentity.owner==owner,ExternalIdentity.provider==provider))).scalar_one_or_none()
    if not row or (provider!='netlify' and not ('repo' in row.scope.split() or 'projects' in row.scope.split())): raise HTTPException(409,'请先连接 '+PROVIDERS[provider]['name']+' 并完成授权')
    return unpack(row.encrypted)['access_token']
