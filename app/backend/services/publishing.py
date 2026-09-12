"""Publish complete runnable source exports on an isolated delivery branch."""
import base64
from fastapi import HTTPException
from urllib.parse import quote
from services.oauth import api

async def publish(provider, token, files, repository, name, private, branch, message, progress):
    if not repository:
        await progress('repository',{})
        body={'name':name,'private':private,'auto_init':True,'description':'Created with AtomForge'}
        if provider=='gitee':body['path']=name
        info=await api(provider,token,'POST','/user/repos',json=body)
        repository=(info['owner']['login']+'/'+info['path']) if provider=='gitee' and info.get('owner',{}).get('login') and info.get('path') else info['full_name']
        await progress('upload',{'repository':repository})
    else:
        info=await api(provider,token,'GET','/repos/'+repository)
    root='/repos/'+repository
    default=info.get('default_branch') or ('main' if provider=='github' else 'master')
    if provider=='github':
        head=await api(provider,token,'GET',root+'/git/ref/heads/'+quote(default,safe=''))
        parent=head['object']['sha']
        # Independent tree: the delivered app lives at repository root without unrelated files.
        tree=await api(provider,token,'POST',root+'/git/trees',json={'tree':[{'path':f['path'],'mode':'100644','type':'blob','content':f['content']} for f in files]})
        commit=await api(provider,token,'POST',root+'/git/commits',json={'message':message,'tree':tree['sha'],'parents':[parent]})
        await progress('upload',{'repository':repository,'commit':commit['sha'],'branch':branch})
        await api(provider,token,'POST',root+'/git/refs',json={'ref':'refs/heads/'+branch,'sha':commit['sha']})
    else:
        await api(provider,token,'POST',root+'/branches',json={'refs':default,'branch_name':branch})
        await progress('upload',{'repository':repository,'branch':branch})
        # A fresh branch keeps incomplete uploads away from the default/live branch.
        existing=await api(provider,token,'GET',root+'/git/trees/'+quote(branch,safe=''),params={'recursive':1})
        if existing.get('truncated'):raise HTTPException(409,'仓库文件过多，无法完整核对，请选择空仓库或新建仓库')
        blobs={e['path']:e['sha'] for e in existing.get('tree',[]) if e.get('type')=='blob'}
        for index,f in enumerate(files):
            body={'content':base64.b64encode(f['content'].encode()).decode(),'message':message,'branch':branch}
            if f['path'] in blobs:body['sha']=blobs[f['path']]
            await api(provider,token,'PUT' if 'sha' in body else 'POST',root+'/contents/'+quote(f['path'],safe='/'),json=body)
            await progress('upload',{'uploaded':index+1,'total':len(files)})
        current={f['path'] for f in files}
        for path,sha in blobs.items():
            if path not in current:await api(provider,token,'DELETE',root+'/contents/'+quote(path,safe='/'),json={'sha':sha,'message':message,'branch':branch})
    return {'repository':repository,'branch':branch,'url':f'https://{provider}.com/{repository}/tree/{branch}'}
