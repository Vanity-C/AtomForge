"""Durable role conversations and user-controlled workflow checkpoints."""
import asyncio
import json
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, or_, func
from core.database import db_manager
from models.studio import StudioConversation, StudioRun
from services.af_projects import AfProjectService
from services import studio

chat_locks = {}


async def messages(owner, project_id, role='all', before=None):
    async with db_manager.session() as db:
        await AfProjectService(db,str(owner)).get_project(project_id)
        query=select(StudioConversation).where(StudioConversation.project_id==project_id,StudioConversation.owner==str(owner))
        if role!='all': query=query.where(or_(StudioConversation.sender==role,StudioConversation.recipient==role))
        if before: query=query.where(StudioConversation.id<before)
        rows=(await db.execute(query.order_by(StudioConversation.id.desc()).limit(100))).scalars().all()
        return {'items':[{'id':r.id,'run_id':r.run_id,'sender':r.sender,'recipient':r.recipient,'kind':r.kind,'content':r.content,'detail':json.loads(r.detail),'created':r.created} for r in reversed(rows)],'next_before':rows[-1].id if len(rows)==100 else None}


async def discussion_context(owner, project_id):
    async with db_manager.session() as db:
        rows=(await db.execute(select(StudioConversation).where(StudioConversation.project_id==project_id,StudioConversation.owner==str(owner),StudioConversation.kind=='chat').order_by(StudioConversation.id.desc()).limit(20))).scalars().all()
        return [{'sender':r.sender,'recipient':r.recipient,'content':r.content[:2000]} for r in reversed(rows)]


async def decision_context(owner, project_id):
    """Retain project decisions when a later edit or repair starts a new run."""
    async with db_manager.session() as db:
        rows=(await db.execute(select(StudioConversation).where(StudioConversation.project_id==project_id,StudioConversation.owner==str(owner),StudioConversation.kind=='decision',StudioConversation.sender=='user').order_by(StudioConversation.id.desc()).limit(20))).scalars().all()
        return [r.content[:2500] for r in reversed(rows)]


async def append(owner,project_id,sender,recipient,kind,content,detail=None):
    async with db_manager.session() as db:
        row=StudioConversation(owner=str(owner),project_id=project_id,sender=sender,recipient=recipient,kind=kind,content=content,detail=json.dumps(detail or {},ensure_ascii=False))
        db.add(row);await db.commit()


async def chat(owner,project_id,role,content,model):
    from services.team import ROLES
    if role not in ROLES or model not in studio.MODELS: raise HTTPException(400,'未知角色或模型')
    lock=chat_locks.setdefault(project_id,asyncio.Lock())
    if lock.locked(): raise HTTPException(429,'此项目已有角色正在回复，请稍候')
    async with lock:
        async with db_manager.session() as db:
            service=AfProjectService(db,str(owner))
            await service._load_owned_project(project_id,write=True)
            since=datetime.fromtimestamp(time.time()-3600,timezone.utc).isoformat()
            count=await db.scalar(select(func.count()).select_from(StudioConversation).where(StudioConversation.owner==str(owner),StudioConversation.kind=='chat',StudioConversation.sender=='user',StudioConversation.created>=since))
            if count>=30:raise HTTPException(429,'本小时角色讨论额度已用完')
            files=await service.list_files(project_id)
            run=await db.scalar(select(StudioRun).where(StudioRun.project_id==project_id,StudioRun.owner==str(owner)).order_by(StudioRun.created.desc()).limit(1))
            context={'files':[{'path':f['path'],'content':f['content'][:20000]} for f in files],'task':json.loads(run.result) if run else {},'discussion':await discussion_context(owner,project_id),'question':content}
        await append(owner,project_id,'user',role,'chat',content)
        await append(owner,project_id,role,'user','activity','正在查阅项目与讨论上下文，准备回复。')
        try:
            result=await studio.model_call(owner,project_id,'',model,'chat_'+role,[{'role':'system','content':f'你是{ROLES[role][0]}，职责是{ROLES[role][1]}\n本次仅讨论：返回 JSON {{"answer":"中文回答","plan":["简要建议或决策依据"]}}。不输出内部思维链。不声称执行了工具、修改了代码或已经通知其他角色。参考真实上下文区分已完成与建议；如果用户要求修改，解释可通过需求确认卡或作为团队需求发送实施。'},{'role':'user','content':json.dumps(context,ensure_ascii=False)}],max_tokens=2200)
            if not isinstance(result.get('answer'),str) or not result['answer'].strip(): raise ValueError('角色未返回有效回复')
            await append(owner,project_id,role,'user','chat',result['answer'][:10000],{'plan':result.get('plan',[])})
        except Exception as exc:
            await append(owner,project_id,role,'user','error','角色回复未完成，请重新发送。')
            raise HTTPException(502,'角色回复未完成，请重试') from exc
    return {'success':True}


async def decide(owner,run_id,checkpoint_id,action,feedback,selections=None,other=None):
    from services.checkpoints import normalize, stop
    automatic = action == 'auto'
    if action not in {'approve','revise','auto'}:raise HTTPException(400,'未知确认动作')
    if action=='revise' and not feedback.strip():raise HTTPException(400,'请填写需要修改的内容')
    # Any new requirement must be reflected in the document the user approves.
    if action=='approve' and feedback.strip():action='revise'
    async with studio.start_lock:
        state=await studio.get_run(owner,run_id)
        if state['status']!='awaiting_input':raise HTTPException(409,'此任务不在等待确认')
        previous=studio.tasks.get(run_id)
        if previous: await previous
        async with db_manager.session() as db:
            run=await db.get(StudioRun,run_id)
            result=json.loads(run.result);pending=result.get('pending',{})
            if run.status!='awaiting_input' or pending.get('id')!=checkpoint_id:raise HTTPException(409,'确认卡已更新，请刷新后重试')
            pending = normalize(pending)
            if automatic:
                auto = pending['auto']
                if auto.get('paused', True) or not auto.get('deadline') or auto['deadline'] > time.time():
                    raise HTTPException(409, '倒计时未到或已经暂停')
                action = 'approve'
                selections = {q['id']: q['recommended'] for q in pending['choices']}
            selected_lines = []
            other_lines = []
            if selections is not None:
                if set(selections) != {q['id'] for q in pending['choices']}:
                    raise HTTPException(400, '请为每个问题选择一个选项')
                for question in pending['choices']:
                    value = selections[question['id']]
                    if value == 'other':
                        text = (other or {}).get(question['id'], '').strip()
                        if not text:
                            raise HTTPException(400, '请填写其他想法')
                        other_lines.append(question['question'] + '：' + text)
                    else:
                        option = next((o for o in question['options'] if o['id'] == value), None)
                        if not option:
                            raise HTTPException(400, '选项不存在')
                        selected_lines.append(question['question'] + '：' + option['label'] + ' — ' + option['description'])
            if other_lines:
                feedback = '\n'.join([feedback, *other_lines]).strip()
                action = 'revise'
            if len(feedback) > 6000:
                raise HTTPException(400, '补充想法过长，请精简到6000字以内')
            service=AfProjectService(db,str(owner))
            await service._load_owned_project(run.project_id,write=True)
            payload=json.loads(run.payload)
            project=await service.get_project(run.project_id)
            if project['current_version']!=payload['base_version']:raise HTTPException(409,'项目版本已变化，请停止本次任务并基于新版本重新发起')
            active=await db.scalar(select(func.count()).select_from(StudioRun).where(StudioRun.status.in_(studio.ACTIVE)))
            if active>=3:raise HTTPException(429,'服务繁忙，请稍后确认')
            key=pending['key']
            payload.setdefault('decisions',[]).append({'checkpoint':key,'action':action,'feedback':feedback[:6000], 'choices':selected_lines,'automatic':automatic})
            # Keep concrete selected behavior in the approved documents used by every downstream role.
            if selected_lines:
                targets = ['product'] if key == 'requirements' else ['design', 'architect']
                for role in targets:
                    doc = result.get('team', {}).get(role)
                    if doc is not None:
                        doc['confirmed_choices'] = selected_lines
                if action == 'revise':
                    payload['decisions'][-1]['feedback'] = '\n'.join([feedback, '同时保留以下选择：', *selected_lines])
            if action=='approve':payload.setdefault('confirmed',[]).append(key)
            else:
                for role in (['product','design','architect','engineer','qa'] if key=='requirements' else ['design','architect','engineer','qa']):
                    result.get('team',{}).pop(role,None)
            result.pop('pending',None)
            run.payload=json.dumps(payload,ensure_ascii=False);run.result=json.dumps(result,ensure_ascii=False);run.status='queued';run.stage='queued'
            await db.commit()
            stop(run_id)
            await studio.event(run_id,'decision',('30秒未操作，自动采用推荐项：' if automatic else '已确认：' if action=='approve' else '请修改：')+pending['title']+('；'+feedback if feedback else '')+('\n'+'\n'.join(selected_lines) if selected_lines else ''),role='user',recipient=pending['role'],kind='decision',state='done',automatic=automatic)
            studio.tasks[run_id]=asyncio.create_task(studio.execute(run_id,owner,run.project_id,payload))
        return {'id':run_id}
