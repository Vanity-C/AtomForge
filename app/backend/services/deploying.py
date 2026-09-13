"""Standalone bundles and Netlify deploys; a ready draft is verified before promotion."""
import asyncio
import html
import hashlib
import io
import ipaddress
import json
import re
import zipfile
from pathlib import Path
from urllib.parse import urlsplit, quote
import httpx
from fastapi import HTTPException
from services.oauth import api, app_origin

def cloud_origin(slug):
    if not slug:return ''
    origin=app_origin()
    host=urlsplit(origin).hostname or ''
    try:private=not ipaddress.ip_address(host).is_global
    except ValueError:private=host=='localhost' or host.endswith(('.localhost','.local'))
    if not origin.startswith('https://') or private:
        raise HTTPException(409,'此应用启用了云服务。请先将 AtomForge 后端部署到 HTTPS 公网地址并配置 ATOMFORGE_PUBLIC_ORIGIN，再部署应用；否则登录和数据功能无法在公网工作。')
    return origin

def bundle(artifact, name, deployment_id, slug=''):
    if not artifact.get('js'):raise HTTPException(409,'当前版本尚无可部署构建，请先完成构建检查')
    origin=cloud_origin(slug)
    bridge=Path(__file__).with_name('cloud-client.js').read_text(encoding='utf-8').replace("import.meta.env.VITE_ATOMFORGE_APP_SLUG || ''",json.dumps(slug))
    # The checked bundle uses a host-message bridge. Standalone pages supply the host locally.
    bridge+='''\nwindow.addEventListener('message', async e => {
      if(e.source!==window || e.origin!==location.origin || e.data?.source!=='atomforge-cloud-request')return;
      const {id,action,data,channel}=e.data;
      try{const result=await call(action,data);window.postMessage({source:'atomforge-cloud-response',id,channel,result},location.origin);}
      catch(error){window.postMessage({source:'atomforge-cloud-response',id,channel,error:error.message},location.origin);}
    });'''
    files={
        'index.html':f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="atomforge-deployment" content="{deployment_id}"><title>{html.escape(name)}</title><link rel="stylesheet" href="/app.css"><script defer src="/cloud.js"></script><script defer src="/app.js"></script></head><body><div id="root"></div></body></html>',
        'app.js':artifact['js'], 'app.css':'html,body{margin:0}*,*::before,*::after{box-sizing:border-box}'+artifact.get('css',''),
        'cloud.js':'(()=>{'+bridge+'})();',
        '_headers':'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/index.html\n  Cache-Control: no-cache\n',
        '_redirects':(f'/api/v1/cloud/* {origin}/api/v1/cloud/:splat 200\n/api/v1/connections/cloud/* {origin}/api/v1/connections/cloud/:splat 200\n' if slug else '')+'/* /index.html 200\n',
    }
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
        for path,content in files.items():archive.writestr(path,content)
    return stream.getvalue()

def netlify_url(value):
    parsed=urlsplit(value or '')
    if parsed.scheme!='https' or not parsed.hostname or not parsed.hostname.endswith('.netlify.app') or parsed.username or parsed.password or parsed.port not in {None,443}:
        raise HTTPException(502,'部署平台未返回有效的 HTTPS 站点地址')
    return value

async def verify_public(url, marker):
    url=netlify_url(url)
    reason=''
    for attempt in range(5):
        try:
            async with httpx.AsyncClient(timeout=15,follow_redirects=False) as client:
                async with client.stream('GET',url,headers={'Cache-Control':'no-cache'}) as r:
                    if r.status_code==401:
                        raise HTTPException(409,'Netlify 站点需要登录或密码（HTTP 401），无法公开访问。请在该站点的 Project visibility / Visitor access 中检查访问设置；需要公网部署时将其设为 Public，然后点击“继续部署检查”，无需重新上传。')
                    if r.status_code==403:
                        raise HTTPException(409,'Netlify 拒绝公开访问（HTTP 403）。请检查该站点的访问保护或防火墙规则，处理后点击“继续部署检查”，无需重新上传。')
                    body=b''
                    async for part in r.aiter_bytes():
                        body+=part
                        if len(body)>100_000:break
                    if r.status_code==200 and f'content="{marker}"'.encode() in body:return
                    reason='返回的页面不是本次部署版本' if r.status_code==200 else f'站点返回 HTTP {r.status_code}'
        except httpx.TimeoutException:reason='连接站点超时'
        except httpx.HTTPError:reason='无法连接站点，请检查后端到 Netlify 的网络连接'
        if attempt<4:await asyncio.sleep(2)
    raise HTTPException(502,f'公网访问检查未通过：{reason}。已保留部署记录，请稍后继续部署检查，无需重新上传。')

async def verify_cloud(url, slug):
    if not slug:return
    try:
        async with httpx.AsyncClient(timeout=20,follow_redirects=False) as client:
            r=await client.get(netlify_url(url).rstrip('/')+'/api/v1/cloud/'+quote(slug,safe='')+'/me')
        if r.status_code==401 and isinstance(r.json().get('detail'),str):return
    except (httpx.HTTPError,ValueError):pass
    raise HTTPException(502,'应用页面已上传，但云服务代理检查未通过。请检查 AtomForge 后端公网地址和云服务配置；本次不会替换线上版本。')

async def deploy(token, archive, project_id, job_id, saved, progress, slug=''):
    site_id=saved.get('site_id')
    if not site_id:
        await progress('site',{})
        site=await api('netlify',token,'POST','/sites',json={'name':f'atomforge-{project_id}-{job_id[:10]}','force_ssl':True})
        site_id=site['id']
        await progress('upload',{'site_id':site_id})
    else:site=await api('netlify',token,'GET','/sites/'+quote(site_id,safe=''))
    root='/sites/'+quote(site_id,safe='')
    previous=saved.get('previous_deploy_id') or (site.get('published_deploy') or {}).get('id','')
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        files={name:zipped.read(name) for name in zipped.namelist()}
    # Netlify's file digest uses absolute site paths; upload URLs remain relative.
    hashes={'/'+name:hashlib.sha1(content).hexdigest() for name,content in files.items()}
    if not saved.get('deploy_id'):
        result=await api('netlify',token,'POST',root+'/deploys',json={'draft':True,'files':hashes})
        deploy_id=result['id']
        await progress('upload',{'site_id':site_id,'deploy_id':deploy_id,'previous_deploy_id':previous})
    else:
        deploy_id=saved['deploy_id']
        result=await api('netlify',token,'GET','/deploys/'+quote(deploy_id,safe=''))
    if result.get('state') not in {'ready','current','error'}:
        required=set(result.get('required',[]))
        total=len(set(hashes.values()))
        await progress('upload',{'uploaded':total-len(required),'total':total})
        for name,content in files.items():
            digest=hashes['/'+name]
            if digest not in required:continue
            async with httpx.AsyncClient(timeout=90) as client:
                try:r=await client.put('https://api.netlify.com/api/v1/deploys/'+quote(deploy_id,safe='')+'/files/'+quote(name,safe='/'),content=content,headers={'Authorization':'Bearer '+token,'Content-Type':'application/octet-stream'})
                except httpx.HTTPError:raise HTTPException(502,'上传暂未完成，进度已保留；重试会继续上传缺失文件') from None
            if r.status_code>=400:raise HTTPException(502,f'Netlify 上传未完成（{r.status_code}），请检查账号额度与部署权限')
            required.discard(digest)
            await progress('upload',{'uploaded':total-len(required),'total':total})
    await progress('processing',{})
    for _ in range(80):
        result=await api('netlify',token,'GET','/deploys/'+quote(deploy_id,safe=''))
        if result.get('state') in {'ready','current'}:break
        if result.get('state')=='error':
            await progress('processing',{'failed_deploy_id':deploy_id,'deploy_id':''})
            raise HTTPException(502,'Netlify 处理失败，请查看部署平台日志后重试')
        await asyncio.sleep(3)
    else:raise HTTPException(504,'部署仍在处理中，可点击继续检查，无需重复上传')
    draft=netlify_url(result.get('deploy_ssl_url') or '')
    await progress('verifying',{'preview_url':draft})
    await verify_public(draft,job_id)
    await verify_cloud(draft,slug)
    await progress('promoting',{})
    await api('netlify',token,'POST',root+'/deploys/'+quote(deploy_id,safe='')+'/restore')
    site=await api('netlify',token,'GET',root)
    # Use the provider's default HTTPS domain even when a custom domain is pending DNS.
    name=site.get('name','')
    if not re.fullmatch(r'[a-zA-Z0-9-]+',name):raise HTTPException(502,'站点域名无效')
    live='https://'+name+'.netlify.app'
    await progress('verifying',{'url':live})
    try:await verify_public(live,job_id)
    except HTTPException:
        if previous and previous!=deploy_id:
            try:
                await api('netlify',token,'POST',root+'/deploys/'+quote(previous,safe='')+'/restore')
                await progress('verifying',{'rolled_back':True})
            except HTTPException:raise HTTPException(502,'上线检查未通过，自动恢复上一版也未完成。请在 Netlify 检查线上状态后继续部署。') from None
            raise HTTPException(502,'上线检查未通过，已恢复上一版；可稍后继续检查本次部署') from None
        raise
    return {'site_id':site_id,'deploy_id':deploy_id,'url':live,'preview_url':draft}
