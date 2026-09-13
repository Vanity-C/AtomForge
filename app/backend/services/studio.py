"""Server-owned build workflow: plan, patch, verify, repair and commit."""
import asyncio
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from openai import APIStatusError, APIConnectionError
from sqlalchemy import select, func

from core.database import db_manager
from models.studio import StudioRun, StudioArtifact, StudioUsage, StudioConversation
from services.af_projects import AfProjectService
from services.aihub import AIHubService
from services.generation import MODELS, active_run_limit
from services.model_catalogue import validate_model, provider_for
from services import codex_provider
from services.leadership import Replan

PATH = re.compile(r'^(?!.*(?:\.\.|\\))[a-zA-Z0-9_][a-zA-Z0-9_./-]*\.(?:jsx?|tsx?|css|json)$')
ACTIVE = {'queued','running'}
tasks: dict[str, asyncio.Task] = {}
start_lock = asyncio.Lock()
build_lock = asyncio.Lock()
event_lock = asyncio.Lock()

ENGINEER = '''你是应用工程师，是 AtomForge 的开发伙伴。使用 React 18 生成可运行应用。返回 JSON 对象：
{"summary":"中文变更摘要","files":[{"path":"App.jsx","content":"完整文件内容"}],"delete":[],"tests":[{"action":"visible|click|fill|text","selector":"CSS 选择器","value":"可选输入或期望文字"}]}
只返回新增或修改的文件，未提及文件会原样保留。删除文件必须在 delete 中明确列出。禁止省略代码。
修改已有代码优先使用精确局部补丁，避免为小改动输出整个大文件：{"summary":"摘要","files":[],"edits":[{"path":"App.jsx","old":"从 currentFiles 原样复制的唯一代码片段","new":"完整替换片段"}],"delete":[],"tests":[]}。old 必须非空且在该文件中恰好出现一次，包含足够上下文；同一文件可有多个 edits，按顺序应用，最多60项。同一文件不能同时出现在 files 和 edits 中。新增文件仍在 files 中提供完整内容；不要将未修改的 CSS 或组件再次输出，不要为了缩短代码删除原有功能。
入口必须为项目根目录 App.jsx 或 App.tsx（不能只提供 src/App.jsx），必须 default export。支持 JSX/TSX/CSS/JSON。可 import react、react-dom、react-router-dom、lucide-react、recharts、date-fns、clsx 以及项目内相对文件。不支持其他 npm 包、Tailwind、远程 CDN 或自行编写服务器。
React 和 hooks 也支持全局使用，但推荐显式 import。所有 CSS 会自动加载。真实交互、中文文案、空状态、响应式布局。为核心控件添加 data-testid 并提供确定性浏览器测试，建议 2–16 步，最多 48 步、总时限 60 秒。步骤在同一个浏览器中按顺序执行，不要省略必要的前置操作；CSS selector 最多 300 字符，fill/text 必须提供字符串 value。测试协议错误应修正 tests，不要因此重写无关的应用代码。涉及今天的功能使用专门的 today/checkin 控件，不要假设周一或第一个日期就是今天；测试在每次新构建的空环境中执行，不能依赖外部网络。
应用云服务：全局 AtomForge.auth.register(email,password)、login(email,password) 返回 {user:{id,email}}；me() 返回 {user} 或抛错；logout()。AtomForge.db.list(collection) 返回 {items:[{id,data}]}；create(collection,data)、update(collection,id,data) 返回 {item:{id,data}}；remove(collection,id)。这些方法均为 async；数据库操作必须先登录。集合必须出现在给定云配置中，private 集合只能读写自己的数据，shared 集合所有登录用户共享读写。不要创建客户端权限判断替代服务端权限。
只有云服务已启用时才能使用 AtomForge.db/auth；否则使用 localStorage。仅当 AI 开启时才能调用 AtomForge.ai.chat(prompt)，返回 {content}。没有配置的能力要如实提示，不得假装成功。禁止使用工作台的账号或 API 密钥。
仅当 payments_enabled 为 true 时才能提供支付：AtomForge.payments.checkout() 返回 {url}，宿主会在预览上方展示“继续付款 · Stripe”链接。应用显示付款页面已准备好，使用该链接继续，不要在沙箱中跳转。status() 返回 {items:[{status,session_id}]}。支付状态必须查询后端，不能根据 URL 参数声称支付成功。
不要生成 package.json、锁文件或构建脚本。'''


def merge_patch(base, patch):
    if not isinstance(patch, dict) or not isinstance(patch.get('files',[]),list) or not ('files' in patch or 'edits' in patch):
        raise ValueError('模型未返回有效的增量文件 JSON')
    delete = patch.get('delete',[])
    if not isinstance(delete,list) or any(not isinstance(p,str) or not PATH.fullmatch(p) for p in delete):
        raise ValueError('删除文件路径无效')
    result = {f['path']:dict(f) for f in base}
    changed = set()
    for f in patch.get('files',[]):
        if not isinstance(f,dict) or not isinstance(f.get('path'),str) or not PATH.fullmatch(f['path']):
            raise ValueError('生成文件路径无效')
        if f['path'] in changed or f['path'] in delete: raise ValueError('文件修改与删除冲突')
        if not isinstance(f.get('content'),str) or len(f['content'].encode())>200000: raise ValueError('生成文件无效或过大')
        changed.add(f['path'])
        result[f['path']]={'path':f['path'],'content':f['content'],'language':f['path'].rsplit('.',1)[-1]}
    edits=patch.get('edits',[])
    if not isinstance(edits,list) or len(edits)>60: raise ValueError('局部修改必须为最多60项的 edits 数组')
    for edit in edits:
        if not isinstance(edit,dict): raise ValueError('局部修改格式无效')
        path,old,new=edit.get('path'),edit.get('old'),edit.get('new')
        if not isinstance(path,str) or not PATH.fullmatch(path) or path not in result: raise ValueError('局部修改必须指向现有项目文件')
        if path in changed or path in delete: raise ValueError('同一文件不能同时完整写入、局部修改或删除')
        if not isinstance(old,str) or not old or not isinstance(new,str): raise ValueError('局部修改需要非空 old 与字符串 new')
        if result[path]['content'].count(old)!=1: raise ValueError(f'{path} 的 old 片段必须与当前代码精确且唯一匹配，请重新读取 currentFiles 并补充定位上下文')
        result[path]['content']=result[path]['content'].replace(old,new,1)
        if len(result[path]['content'].encode())>200000: raise ValueError('生成文件无效或过大')
    for p in delete: result.pop(p,None)
    if not any(p in result for p in ('App.jsx','App.tsx','App.js','App.ts')):
        nested = next((p for p in ('src/App.jsx','src/App.tsx','src/App.js','src/App.ts') if p in result), None)
        if not nested:
            raise ValueError('缺少应用入口：请新增根目录 App.jsx 或 App.tsx，必须 default export；不能只返回组件或样式文件')
        # Preserve relative imports in src/ rather than moving generated files.
        result['App.jsx'] = {'path':'App.jsx', 'content':f'export {{default}} from "./{nested}";', 'language':'jsx'}
    if len(result)>40 or sum(len(f['content'].encode()) for f in result.values())>1500000: raise ValueError('项目超出大小限制')
    return list(result.values())


def patch_paths(patch):
    entries=[f for key in ('files','edits') for f in (patch.get(key) if isinstance(patch.get(key),list) else [])]
    return list(dict.fromkeys(f['path'] for f in entries if isinstance(f,dict) and isinstance(f.get('path'),str)))


class OutputLimitError(ValueError):
    """Do not repeat an exhausted output strategy as another code repair."""


async def retry_transient(operation, on_retry):
    for attempt in range(3):
        try:
            return await operation()
        except (APIStatusError, APIConnectionError, HTTPException, httpx.TransportError, TimeoutError) as exc:
            status=getattr(exc,'status_code',None)
            transient=status in {408,429,500,502,503,504} if status is not None else True
            if not transient or attempt==2: raise
            await on_retry(attempt+1)
            await asyncio.sleep(attempt+1)


class RunnerUnavailable(HTTPException):
    def __init__(self):
        super().__init__(503, '验证服务尚未就绪，已保留代码和进度。服务恢复后可继续验收，无需重新描述需求。')


async def ensure_runner_ready():
    """Check the compiler and an actual browser before spending model tokens."""
    async with httpx.AsyncClient(timeout=12, trust_env=False) as client:
        try:
            response = await client.get(os.getenv('RUNNER_URL','http://127.0.0.1:8001')+'/ready')
            response.raise_for_status()
            if response.json().get('status') != 'ready': raise RunnerUnavailable()
        except (httpx.HTTPError, ValueError) as exc:
            raise RunnerUnavailable() from exc


async def runner_build(files, tests=None, edit=None):
    async with build_lock, httpx.AsyncClient(timeout=75,trust_env=False) as client:
        try:
            r=await client.post(os.getenv('RUNNER_URL','http://127.0.0.1:8001')+'/build',json={'files':files,'tests':tests or [],'edit':edit})
            if r.status_code==429: raise HTTPException(429,'验证队列繁忙，正在等待空闲')
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise RunnerUnavailable() from e


def can_resume_verification(result, error):
    return bool(result.get('draft_files') and (result.get('error_code') == 'runner_unavailable'
        or '构建服务不可用' in error or '验证服务尚未就绪' in error))


async def get_run(owner, run_id):
    from services.agent_profiles import legacy_team
    async with db_manager.session() as db:
        r=await db.get(StudioRun,run_id)
        if not r or r.owner!=str(owner): raise HTTPException(404,'任务不存在')
        result = json.loads(r.result)
        if result.get('pending'):
            from services.checkpoints import normalize
            result['pending'] = normalize(result['pending'])
        return {'id':r.id,'project_id':r.project_id,'mode':json.loads(r.payload).get('mode','build'),'agents':json.loads(r.payload).get('agents') or legacy_team(),'status':r.status,'stage':r.stage,'events':json.loads(r.events),'result':result,'error':r.error,'created':r.created,'server_time':time.time()}


async def change(run_id, **values):
    async with db_manager.session() as db:
        r=await db.get(StudioRun,run_id)
        if not r: raise asyncio.CancelledError()
        for k,v in values.items(): setattr(r,k,json.dumps(v,ensure_ascii=False) if k in {'result','payload','events'} else v)
        await db.commit()


async def event(run_id, stage, text, **metadata):
    async with event_lock, db_manager.session() as db:
        r=await db.get(StudioRun,run_id)
        if not r or r.status=='cancelled': raise asyncio.CancelledError()
        entries=json.loads(r.events)
        entries.append({'stage':stage,'message':str(text)[:6000],'at':datetime.now(timezone.utc).isoformat(),**metadata})
        db.add(StudioConversation(project_id=r.project_id,owner=r.owner,run_id=r.id,
            sender=metadata.get('role','engineer'),recipient=metadata.get('recipient','all'),
            kind=metadata.get('kind','result' if metadata.get('output') else 'activity'),content=str(text)[:6000],
            detail=json.dumps(metadata,ensure_ascii=False)))
        r.events=json.dumps(entries[-160:],ensure_ascii=False);r.stage=stage
        await db.commit()


def parse_model_json(text):
    text = text.strip()
    if text.startswith('```') and text.endswith('```') and '\n' in text:
        text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError('模型结果必须是一个 JSON 对象')
    return value


async def model_call(owner,project_id,run_id,model,stage,messages,max_tokens=12000,temperature=.25,agent_team=None):
    from services.budget import check_budget
    await check_budget(owner)
    from services.agent_profiles import snapshot, prompt_for, ROLE_IDS
    role=stage.removeprefix('team_').removeprefix('chat_')
    if role=='plan':role='leader'
    if role not in ROLE_IDS:role='engineer'
    messages=[dict(m) for m in messages]
    if stage in {'plan','code','repair'} or stage.startswith(('team_','chat_')):
        if agent_team is None:
            async with db_manager.session() as db:
                run=await db.get(StudioRun,run_id) if run_id else None
                agent_team=json.loads(run.payload).get('agents') if run and run.owner==str(owner) else None
                if not agent_team:agent_team=await snapshot(owner,db)
        persona=prompt_for(role,agent_team)
        if messages and messages[0].get('role')=='system':messages[0]['content']+=persona
        else:messages.insert(0,{'role':'system','content':persona})
    is_codex = provider_for(model) == 'codex'
    service=None if is_codex else AIHubService()
    try:
        client=service._require_ai_client() if service else None
        current_messages = list(messages)
        for format_attempt in range(2):
            async def request():
                await check_budget(owner)
                async with asyncio.timeout(180):
                    if is_codex:
                        return await codex_provider.complete(model, current_messages)
                    return await client.chat.completions.create(model=model,messages=current_messages,max_tokens=max_tokens,temperature=temperature if not format_attempt else .1,extra_body={'thinking':{'type':'disabled'}},response_format={'type':'json_object'})
            role=stage.removeprefix('team_').removeprefix('chat_')
            if role=='plan':role='leader'
            if role in {'code','repair'}: role='engineer'
            response=await retry_transient(request,lambda attempt:event(run_id,'recovering',f'模型连接暂时不稳定，正在重试当前步骤（{attempt}/2），无需重新提交需求。',role=role,kind='activity',state='recovering'))
            usage=response.usage
            async with db_manager.session() as db:
                db.add(StudioUsage(owner=str(owner),project_id=project_id,run_id=run_id,model=model,stage=stage,input_tokens=usage.prompt_tokens if usage else 0,output_tokens=usage.completion_tokens if usage else 0))
                await db.commit()
            if response.choices[0].finish_reason=='length':
                if format_attempt: raise OutputLimitError('本次输出仍未能完整返回，已保留代码与交接进度；可继续此任务或拆分本次修改。')
                await event(run_id,'recovering','正在精简重复输出并重新整理本次修改，已有文件与需求会保留。',role=role,kind='activity',state='recovering')
                current_messages=[*messages,{'role':'user','content':'上一轮输出达到长度限制，未应用任何截断代码。不要重复原来的整文件输出。已有文件必须优先用 edits 精确局部修改，仅新增文件返回完整 files；只修改本次需求涉及的片段，保留其他功能。若是交接文档则精简描述和重复条目，完整保留必要字段。请重新返回一个完整 JSON。'}]
                continue
            text=response.choices[0].message.content or ''
            try:
                return parse_model_json(text)
            except (ValueError, json.JSONDecodeError):
                if format_attempt:
                    raise ValueError('模型连续返回了不完整的交接格式，请重试本阶段')
                await event(run_id,'recovering','正在整理模型返回格式，完成后继续当前步骤。',role=role,kind='activity',state='recovering')
                current_messages = [*messages, {'role':'assistant','content':text}, {'role':'user','content':'上一条不是有效的单个 JSON 对象。请保留所有所需字段和完整代码，修正为一个严格合法的 JSON 对象。不要 Markdown 围栏、解释或多个并列 JSON；文件放在同一个 files 数组内。'}]

    finally:
        if service and service.client: await service.client.close()


async def traced_tool(run_id, role, tool, inputs, operation, summarize):
    call_id=uuid.uuid4().hex
    started=time.monotonic()
    await event(run_id,tool,'执行 '+tool,role=role,kind='tool_start',call_id=call_id,tool=tool,inputs=inputs,state='running')
    try:
        result=await operation()
    except BaseException as exc:
        if not isinstance(exc,asyncio.CancelledError):
            await event(run_id,tool,'工具执行失败',role=role,kind='tool_result',call_id=call_id,tool=tool,state='error',duration_ms=round((time.monotonic()-started)*1000))
        raise
    await event(run_id,tool,'执行完成' if result.get('ok',True) else '执行未通过',role=role,kind='tool_result',call_id=call_id,tool=tool,state='done' if result.get('ok',True) else 'error',duration_ms=round((time.monotonic()-started)*1000),output=summarize(result))
    return result


async def call_model(owner,project_id,run_id,model,stage,messages,max_tokens=12000,temperature=.25,agent_team=None,event_role=None):
    from services.leadership import apply_feedback
    await apply_feedback(run_id)
    role=stage.removeprefix('team_')
    if role in {'code','repair'}: role='engineer'
    if role=='plan':role='leader'
    kwargs={'agent_team':agent_team} if agent_team is not None else {}
    return await traced_tool(run_id,event_role or role,'model.generate',{'model':model,'stage':stage},
        lambda:model_call(owner,project_id,run_id,model,stage,messages,max_tokens=max_tokens,temperature=temperature,**kwargs),
        lambda r:{'summary':r.get('summary',r.get('goal','模型已返回结构化产出')),'files':patch_paths(r)})


async def checked_build(run_id, files, tests=None, role='qa'):
    from services.leadership import apply_feedback
    await apply_feedback(run_id)
    return await traced_tool(run_id,role,'runner.build_and_test',{'files':[f['path'] for f in files],'tests':tests or []},
        lambda:retry_transient(lambda:runner_build(files,tests),lambda attempt:event(run_id,'recovering',f'验证连接暂未完成，正在重新连接（{attempt}/2）。代码已保存，不会重新生成。',role=role,kind='activity',state='recovering')),lambda r:{'ok':r.get('ok'),'logs':r.get('logs',[]),'error':r.get('error','')})


async def start(owner, project_id, instruction, model, mode=None,temperature=.35,interactive=True, retry_of=None):
    await validate_model(model)
    if mode is not None and mode not in {'build','race','team'}: raise HTTPException(400,'未知运行模式')
    async with start_lock, db_manager.session() as db:
        service=AfProjectService(db,str(owner)); project=await service.get_project(project_id)
        await service._load_owned_project(project_id,write=True)
        mode = mode or project['agent_mode']
        requested_mode = 'team' if mode == 'team' else 'build'
        if requested_mode != project['agent_mode']:
            raise HTTPException(409, '项目模式在创建时已确定；如需切换，请创建新项目')
        active=(await db.execute(select(StudioRun).where(StudioRun.status.in_(ACTIVE|{'awaiting_input'})))).scalars().all()
        if any(r.owner==str(owner) or r.project_id==project_id for r in active): raise HTTPException(429,'账号或项目已有任务执行中，请等待或取消')
        if sum(r.status in ACTIVE for r in active)>=active_run_limit(): raise HTTPException(429,'当前体验服务器正在处理其他生成任务，请稍后重试')
        since=datetime.fromtimestamp(time.time()-3600,timezone.utc).isoformat()
        count=await db.scalar(select(func.count()).select_from(StudioRun).where(StudioRun.created>=since))
        if count>=int(os.getenv('AI_HOURLY_LIMIT','30')): raise HTTPException(429,'本小时任务配额已用完')
        await ensure_runner_ready()
        files=await service.list_files(project_id)
        messages=await service.list_messages(project_id)
        run_id=uuid.uuid4().hex
        payload={'instruction':instruction,'model':model,'mode':mode,'base_version':project['current_version'],'files':[{'path':f['path'],'content':f['content'],'language':f['language']} for f in files],'history':[{'role':m['role'],'content':m['content'][:2000]} for m in messages[-4:]]}
        payload['temperature']=temperature
        payload['interactive']=interactive
        from services.agent_profiles import snapshot
        payload['agents']=await snapshot(owner,db)
        resume_result = {}
        if retry_of:
            previous = await db.get(StudioRun, retry_of)
            if not previous or previous.owner != str(owner) or previous.project_id != project_id:
                raise HTTPException(404, '原任务不存在')
            old_payload = json.loads(previous.payload)
            if old_payload.get('leader_feedback'):
                payload['leader_feedback']=old_payload['leader_feedback']
                payload['original_instruction']=old_payload.get('original_instruction',old_payload['instruction'])
            payload['agents']=old_payload.get('agents') or payload['agents']
            if previous.status in ACTIVE | {'awaiting_input'}:
                raise HTTPException(409, '原任务仍在执行')
            if mode == 'team':
                payload['decisions'] = old_payload.get('decisions', [])
                if old_payload.get('base_version') == project['current_version']:
                    old_result = json.loads(previous.result)
                    resume_result['team'] = {key:value for key,value in old_result.get('team', {}).items() if key in {'product','design','architect'}}
                    payload['confirmed'] = old_payload.get('confirmed', [])
                    if old_result.get('draft_files'):
                        resume_result['draft_files'] = old_result['draft_files']
                    payload['previousError'] = previous.error
                    if can_resume_verification(old_result, previous.error) and old_result.get('team', {}).get('engineer'):
                        resume_result['team'] = old_result['team']
                        resume_result['resume_stage'] = 'verification'
                        # Older runs saved test inputs in their tool trace only.
                        engineer = resume_result['team']['engineer']
                        if 'tests' not in engineer:
                            build_event = next((e for e in json.loads(previous.events) if e.get('tool')=='runner.build_and_test' and e.get('inputs')), {})
                            engineer['tests'] = build_event.get('inputs', {}).get('tests', [])

                else:
                    payload['instruction'] += '\n请保留此前用户已选择的业务规则：\n' + json.dumps(payload['decisions'], ensure_ascii=False)
            elif old_payload.get('base_version') == project['current_version']:
                old_result = json.loads(previous.result)
                if can_resume_verification(old_result, previous.error):
                    resume_result = {**old_result, 'resume_stage':'verification'}
                    resume_result.pop('error_code', None)
        db.add(StudioRun(id=run_id,owner=str(owner),project_id=project_id,payload=json.dumps(payload,ensure_ascii=False),result=json.dumps(resume_result,ensure_ascii=False)))
        await db.commit()
        await service.add_message(project_id,'user',instruction,'plan',0,model)
        db.add(StudioConversation(project_id=project_id,owner=str(owner),run_id=run_id,sender='user',recipient='leader',kind='message',content=instruction))
        await db.commit()
        tasks[run_id]=asyncio.create_task(execute(run_id,owner,project_id,payload))
        return {'id':run_id}


async def commit_result(owner, project_id, base_version, result, run_id):
    from services.leadership import apply_feedback
    async with start_lock:
        if run_id!='visual':
            await apply_feedback(run_id,locked=True)
            await change(run_id,stage='save')
        return await _commit_result(owner,project_id,base_version,result,run_id)


async def _commit_result(owner, project_id, base_version, result, run_id):
    async with db_manager.session() as db:
        service=AfProjectService(db,str(owner)); project=await service.get_project(project_id)
        if project['current_version']!=base_version: raise HTTPException(409,'项目已有新版本，请重新生成，避免覆盖其他修改')
        commit=await service.commit_files(project_id,result['files'],result['summary'],'','studio-agent',base_version)
        artifact=await db.get(StudioArtifact,project_id)
        if not artifact: artifact=StudioArtifact(project_id=project_id);db.add(artifact)
        artifact.version=commit['version'];artifact.content=json.dumps(result['artifact'])
        await db.commit()
        await service.add_message(project_id,'assistant',result['summary']+'\n构建与浏览器检查通过。','done',commit['version'],result['model'])
        return commit['version']


async def execute(run_id,owner,project_id,payload):
    from services.leadership import Replan,apply_feedback
    try:
        for _ in range(8):
            try:
                await apply_feedback(run_id)
                await _execute(run_id,owner,project_id,payload)
                return
            except Replan:
                async with db_manager.session() as db:
                    payload=json.loads((await db.get(StudioRun,run_id)).payload)
        await change(run_id,status='interrupted',stage='leader',error='本轮调整较多，需求与草稿已保留，可继续任务。')
    except asyncio.CancelledError:
        await change(run_id,status='cancelled',stage='cancelled',error='任务已停止；已保存版本不变')
    except Exception:
        await change(run_id,status='interrupted',stage='leader',error='调度暂未完成，需求与草稿已保留，请继续任务。')
    finally:
        if tasks.get(run_id) is asyncio.current_task():tasks.pop(run_id,None)


async def _execute(run_id,owner,project_id,payload):
    try:
        if not payload.get('agents'):
            from services.agent_profiles import snapshot
            payload['agents']=await snapshot(owner)
            await change(run_id,payload=payload)
        await change(run_id,status='running')
        if payload.get('mode')=='team':
            from services.team import execute_team
            await execute_team(run_id,owner,project_id,payload)
            return
        async with db_manager.session() as db:
            saved_result = json.loads((await db.get(StudioRun,run_id)).result)
        resume_verification = saved_result.get('resume_stage') == 'verification'
        if resume_verification:
            plan = saved_result.get('plan', {})
        else:
            await event(run_id,'plan','我先拆分本轮目标，再交给工程师实现与验证。',role='leader')
            plan=await call_model(owner,project_id,run_id,payload['model'],'plan',[{'role':'system','content':'你是团队领导。当前为工程师模式，由你拆解任务并安排工程师实施和自测。返回 JSON {"goal":"目标","tasks":["分配给工程师的具体任务"],"acceptance":["可验证标准"]}。只规划当前需求，至多6项任务。不要声称已执行。'},{'role':'user','content':payload['instruction']}],1800)
            await event(run_id,'plan',json.dumps(plan,ensure_ascii=False),role='leader',recipient='engineer',kind='handoff',output=plan)
        from models.studio import StudioCloud
        async with db_manager.session() as db:
            cloud=await db.get(StudioCloud,project_id)
            config={'enabled':bool(cloud and cloud.enabled),'ai_enabled':bool(cloud and cloud.ai_enabled),'collections':json.loads(cloud.collections) if cloud else {}}
            from services.connections import read_connection
            connection=await read_connection(db,project_id)
            config['payments_enabled']=bool(config['enabled'] and all(connection.get(k) for k in ['stripe_secret','stripe_webhook_secret','stripe_price_id','public_base_url']))
        models=[payload['model']]
        if payload['mode']=='race': models=[payload['model']]+[m for m in sorted(MODELS) if m!=payload['model']]
        async def generate_candidate(model):
            files=payload['files']; failure=''
            for attempt in range(3):
                if not (resume_verification and attempt == 0):
                    await event(run_id,'code' if not attempt else 'repair',f'{model}：'+('增量修改代码' if not attempt else f'根据检查错误进行第 {attempt} 次修复'))
                user={'request':payload['instruction'],'plan':plan,'cloud':config,'currentFiles':files,'previousError':failure}
                try:
                    if resume_verification and attempt == 0:
                        files = saved_result['draft_files']
                        patch = {'summary':saved_result.get('summary','应用已更新'), 'tests':saved_result.get('developer_tests',[])}
                        await event(run_id,'test','继续验证已保存的代码，不重复生成。',role='engineer')
                    else:
                        patch=await call_model(owner,project_id,run_id,model,'code' if not attempt else 'repair',[{'role':'system','content':ENGINEER},*payload['history'],{'role':'user','content':json.dumps(user,ensure_ascii=False)}],temperature=payload.get('temperature',.35))
                        files=merge_patch(files,patch)
                        if payload['mode']!='race':
                            await change(run_id,result={'draft_files':files,'plan':plan,'developer_tests':patch.get('tests',[]),'summary':str(patch.get('summary','应用已更新'))[:2000]})
                        await event(run_id,'build','修改文件：'+', '.join(patch_paths(patch)))
                    await event(run_id,'test','编译依赖并运行隔离浏览器测试')
                    checked=await checked_build(run_id,files,patch.get('tests',[]),role='engineer')
                    for line in checked.get('logs',[]): await event(run_id,'test',line)
                    if not checked['ok']: raise ValueError(checked.get('error','构建失败'))
                    result={'files':files,'summary':str(patch.get('summary','应用已更新'))[:2000],'artifact':checked['artifact'],'model':model,'tests':patch.get('tests',[]),'plan':plan}
                    return result
                except (ValueError,json.JSONDecodeError) as exc:
                    if isinstance(exc,OutputLimitError): raise
                    failure=str(exc)[:5000];await event(run_id,'error',failure)
                    if attempt==2:
                        if payload['mode']!='race':raise ValueError('两次自动修复后仍未通过检查：'+failure)
                        await event(run_id,'error',model+' 候选未通过，不会进入选择列表')
        if payload['mode']=='race':
            results=await asyncio.gather(*(generate_candidate(model) for model in models),return_exceptions=True)
            if any(isinstance(result,Replan) for result in results):raise Replan()
            candidates=[r for r in results if isinstance(r,dict)]
            for model,result in zip(models,results):
                if isinstance(result,Exception):await event(run_id,'error',model+' 候选失败：'+(str(result)[:500] if isinstance(result,ValueError) else '模型服务或构建服务未完成'))
        else:candidates=[await generate_candidate(models[0])]
        if not candidates:raise ValueError('所有候选均未通过检查，请调整需求后重试')
        if payload['mode']=='race':
            await change(run_id,status='review',stage='review',result={'candidates':candidates,'base_version':payload['base_version']})
            await event(run_id,'review','候选均已通过构建检查，请选择要保存的版本')
        else:
            await event(run_id,'save','检查通过，正在保存代码和构建产物')
            version=await commit_result(owner,project_id,payload['base_version'],candidates[0],run_id)
            await event(run_id,'save',f"{candidates[0]['summary']}\n\n构建与浏览器检查通过，已保存为 v{version}。可以在右侧预览中体验。",role='engineer',kind='summary')
            await change(run_id,status='done',stage='done',result={'version':version,'summary':candidates[0]['summary'],'plan':plan})
    except Replan:
        raise
    except asyncio.CancelledError:
        await change(run_id,status='cancelled',stage='cancelled',error='任务已停止；已保存版本不变')
    except Exception as exc:
        if isinstance(exc,HTTPException): message=str(exc.detail)
        elif isinstance(exc,APIStatusError): message={401:'模型鉴权失败',402:'模型账户余额不足',429:'模型服务限流'}.get(exc.status_code,'模型服务暂不可用')
        elif isinstance(exc,TimeoutError): message='任务阶段超时，请缩小需求后重试'
        elif isinstance(exc,ValueError): message=str(exc)
        else: message='任务执行失败，请检查服务日志或重试'
        if isinstance(exc, RunnerUnavailable):
            async with db_manager.session() as db:
                result = json.loads((await db.get(StudioRun,run_id)).result)
            result['error_code'] = 'runner_unavailable'
            await change(run_id, result=result)
            await event(run_id,'test','验证服务暂不可用。代码和交接已保存，恢复后从验收继续。',role='qa' if payload.get('mode')=='team' else 'engineer',kind='activity',state='error')
        await change(run_id,status='error',stage='error',error=message)


async def cancel(owner,run_id):
    run=await get_run(owner,run_id)
    if run['stage']=='save':raise HTTPException(409,'正在保存版本，请等待完成')
    if run['status']=='awaiting_input':
        await change(run_id,status='cancelled',stage='cancelled',error='任务已停止；已保存版本不变')
        from services.checkpoints import stop
        stop(run_id)
        return
    task=tasks.get(run_id)
    if task:
        task.cancel()
        try:await task
        except asyncio.CancelledError:
            await change(run_id,status='cancelled',stage='cancelled',error='任务已停止')
        tasks.pop(run_id,None)


async def recover():
    async with db_manager.session() as db:
        rows=(await db.execute(select(StudioRun).where(StudioRun.status.in_(ACTIVE)))).scalars().all()
        for r in rows: r.status='interrupted';r.error='服务曾重启，任务已中断。可以重新执行，已保存版本不变。'
        # Preserve genuine historic role records without inventing missing tool traces.
        archived=(await db.execute(select(StudioRun).where(~StudioRun.id.in_(select(StudioConversation.run_id).where(StudioConversation.run_id!=''))))).scalars().all()
        for r in archived:
            for entry in json.loads(r.events):
                metadata={k:v for k,v in entry.items() if k not in {'stage','message','at'}}
                db.add(StudioConversation(project_id=r.project_id,owner=r.owner,run_id=r.id,sender=entry.get('role','engineer'),recipient=entry.get('recipient','all'),kind=entry.get('kind','result' if entry.get('output') else 'activity'),content=entry.get('message',''),detail=json.dumps(metadata,ensure_ascii=False),created=entry.get('at',r.created)))
        await db.commit()
    from services.checkpoints import restore
    await restore()
