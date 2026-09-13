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
    from services.agent_profiles import legacy_team, MEMBER_PREFIX
    async with db_manager.session() as db:
        await AfProjectService(db,str(owner)).get_project(project_id)
        query=select(StudioConversation).where(StudioConversation.project_id==project_id,StudioConversation.owner==str(owner))
        member_id=role.removeprefix(MEMBER_PREFIX) if role.startswith(MEMBER_PREFIX) else None
        if role!='all' and not member_id: query=query.where(or_(StudioConversation.sender==role,StudioConversation.recipient==role))
        if before: query=query.where(StudioConversation.id<before)
        rows=[];teams={};cursor=None
        # Member conversations also include stage events from immutable snapshots;
        # filtering against today's role assignments would misattribute history.
        while len(rows)<100:
            page_query=query.where(StudioConversation.id<cursor) if cursor else query
            page=(await db.execute(page_query.order_by(StudioConversation.id.desc()).limit(100))).scalars().all()
            if not page:break
            run_ids={r.run_id for r in page if r.run_id and r.run_id not in teams}
            runs=(await db.execute(select(StudioRun).where(StudioRun.id.in_(run_ids),StudioRun.owner==str(owner)))).scalars().all() if run_ids else []
            teams.update({r.id:json.loads(r.payload).get('agents') or legacy_team() for r in runs})
            for row in page:
                row_team=teams.get(row.run_id,{})
                if not member_id or role in {row.sender,row.recipient} or json.loads(row.detail).get('agent',{}).get('id')==member_id or any(row_team.get(actor,{}).get('id')==member_id for actor in (row.sender,row.recipient)):
                    rows.append(row)
                    if len(rows)==100:break
            cursor=page[-1].id
            if len(page)<100:break
        run_ids={r.run_id for r in rows if r.run_id}
        teams={rid:team for rid,team in teams.items() if rid in run_ids}
        return {'teams':teams,'items':[{'id':r.id,'run_id':r.run_id,'sender':r.sender,'recipient':r.recipient,'kind':r.kind,'content':r.content,'detail':json.loads(r.detail),'created':r.created} for r in reversed(rows)],'next_before':rows[-1].id if len(rows)==100 else None}


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
    from services.agent_profiles import snapshot,complete_team,resolve_member,MEMBER_PREFIX
    target=role
    if role not in ROLES and not role.startswith(MEMBER_PREFIX): raise HTTPException(400,'未知角色')
    await studio.validate_model(model)
    members=await snapshot(owner)
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
            if run and run.status in {'queued','running','awaiting_input'}:
                members=json.loads(run.payload).get('agents') or members
            members=complete_team(members)
            selected=resolve_member(members,target)
            if not selected:raise HTTPException(400,'该智能体不在当前团队中')
            if target.startswith(MEMBER_PREFIX):
                role='leader' if members['leader']['id']==selected['id'] else selected['role']
                # Same-profession colleagues need their own persona for direct chat.
                members={**members,role:selected}
            context={'files':[{'path':f['path'],'content':f['content'][:20000]} for f in files],'task':json.loads(run.result) if run else {},'discussion':await discussion_context(owner,project_id),'question':content}
            context['currentRun']={'id':run.id,'status':run.status,'stage':run.stage,'error':run.error,'instruction':json.loads(run.payload).get('instruction'),'recentActivity':[e for e in json.loads(run.events) if not e.get('kind','').startswith('tool_')][-8:]} if run else None
            context['strategy']=json.loads(run.payload).get('workflow',{}) if run else {}
        await append(owner,project_id,'user',target,'chat',content)
        await append(owner,project_id,target,'user','activity','收到，我先结合项目进展看看。',{'agent':selected})
        try:
            if role=='leader':return await leader_reply(owner,project_id,content,model,context,members,member_targets=target.startswith(MEMBER_PREFIX))
            result=await studio.model_call(owner,project_id,'',model,'chat_'+role,[{'role':'system','content':f'你是{ROLES[role][0]}，职责是{ROLES[role][1]}\n本次仅讨论：返回 JSON {{"answer":"中文回答","plan":["简要建议或决策依据"]}}。不输出内部思维链。不声称执行了工具、修改了代码或已经通知其他角色。参考真实上下文区分已完成与建议；如果用户要求修改，解释可通过需求确认卡或作为团队需求发送实施。'},{'role':'user','content':json.dumps(context,ensure_ascii=False)}],max_tokens=2200,agent_team=members)
            if not isinstance(result.get('answer'),str) or not result['answer'].strip(): raise ValueError('角色未返回有效回复')
            await append(owner,project_id,target,'user','chat',result['answer'][:10000],{'plan':result.get('plan',[]),'agent':selected})
        except HTTPException:
            raise
        except Exception as exc:
            await append(owner,project_id,target,'user','error','角色回复未完成，请重新发送。')
            raise HTTPException(502,'角色回复未完成，请重试') from exc
    return {'success':True}


async def leader_reply(owner,project_id,content,model,context,members,member_targets=False):
    """Bounded, real specialist consultations followed by a reply or execution request."""
    from pydantic import BaseModel,Field
    from typing import Literal
    from services.leadership import queue_feedback
    from services.agent_profiles import MEMBER_PREFIX
    def actor(role):return MEMBER_PREFIX+members[role]['id'] if member_targets else role
    class Consultation(BaseModel):
        role:Literal['product','design','architect','engineer','qa']
        question:str=Field(min_length=1,max_length=1500)
    class Reply(BaseModel):
        answer:str=Field(min_length=1,max_length=8000)
        action:Literal['reply','implement','strategy']='reply'
        instruction:str=Field(default='',max_length=6000)
        consult:list[Consultation]=Field(default_factory=list,max_length=3)
        strategy:dict=Field(default_factory=dict)
    system='''你是团队领导，是用户的第一联系人。结合真实项目状态，直接回答需求、反馈和问题；必要时向专业成员询证。
返回 JSON {"answer":"自然、具体的中文回应","action":"reply|implement","instruction":"本轮完整的实施要求","consult":[{"role":"product|design|architect|engineer|qa","question":"需要该成员具体回答的问题"}]}。
只有用户明确要求创建、修改、修复或继续实施时选择 implement；咨询、状态查询、闲聊使用 reply，不擅自改代码。implementation指令只保留用户授权的范围，不包含付费、公开发布、部署或删除项目等外部动作；这些事项引导用户使用对应功能。
consult 最多3位，必要才咨询，不虚构回复。尚未执行的动作只能描述为安排；调度系统成功后会附上真实状态。已有任务进行中时，明确新反馈会在安全节点合并并重新安排，不能说已完成。用户最新反馈优先于旧任务记录。'''
    system+='\n用户明确要求仅调整优先级、WIP、SLA、修复次数或测试门槛时，使用 action="strategy" 并返回 strategy 对象，仅包含需修改的 priority/wip/sla_minutes/max_repairs/min_tests 字段；沿用当前策略其他值。该操作不改源码、不重新规划工作包、不改变交付列，不更换本轮成员。没有活跃工作流时说明限制，不虚构调整成功。不要为状态咨询执行调整。'
    async def ask(extra):
        raw=await studio.model_call(owner,project_id,'',model,'chat_leader',[{'role':'system','content':system},{'role':'user','content':json.dumps({**context,**extra},ensure_ascii=False)}],max_tokens=2600,agent_team=members)
        return Reply.model_validate(raw)
    reply=await ask({})
    consultations=[];consulted={members['leader']['id']}
    for consultation in reply.consult:
        role=consultation.role
        if members[role]['id'] in consulted:continue
        consulted.add(members[role]['id'])
        await append(owner,project_id,actor('leader'),actor(role),'chat',consultation.question,{'agent':members['leader']})
        raw=await studio.model_call(owner,project_id,'',model,'chat_'+role,[{'role':'system','content':'团队领导正在向你咨询。基于真实源码、任务和验收记录回答。返回 JSON {"answer":"给领导的专业意见"}。此次仅分析，不修改代码、不捏造执行结果，指出依据与可实施的建议。'},{'role':'user','content':json.dumps({**context,'question':consultation.question},ensure_ascii=False)}],max_tokens=1800,agent_team=members)
        answer=raw.get('answer')
        if not isinstance(answer,str) or not answer.strip():raise ValueError('成员未返回有效意见')
        consultations.append({'role':role,'answer':answer[:6000]})
        await append(owner,project_id,actor(role),actor('leader'),'chat',answer[:6000],{'agent':members[role]})
    if consultations:reply=await ask({'consultationResults':consultations,'instructionToLeader':'咨询已实际完成。现在给用户最终回应，不再请求咨询。'})
    run_id=None;queued=False
    if reply.action=='strategy':
        from services.team_workflow import PolicyChange, update_policy
        current=context.get('currentRun') or {}; board=context.get('strategy') or {}
        if not current.get('id') or not board:raise HTTPException(409,'当前没有可调整的活跃战略看板')
        if not reply.strategy:raise HTTPException(400,'请明确需要调整的策略')
        change=PolicyChange.model_validate({**board['policy'],**reply.strategy,'revision':board['revision'],'reason':content[:500]})
        await update_policy(owner,current['id'],change)
        run_id=current['id']
    if reply.action=='implement':
        if not reply.instruction.strip():raise ValueError('领导未提供明确实施要求')
        instruction='用户原始要求：'+content+'\n领导整理的实施安排：'+reply.instruction
        try:
            run_id=await queue_feedback(owner,project_id,instruction)
            queued=bool(run_id)
            if not run_id:
                started=await studio.start(owner,project_id,instruction,model)
                run_id=started['id']
        except HTTPException as exc:
            await append(owner,project_id,actor('leader'),'user','chat','这次调整暂未安排：'+str(exc.detail),{'agent':members['leader']})
            raise
    status='\n新反馈已进入当前任务，会在安全节点保留草稿并重新调度。' if queued else '\n任务已开始，我会协调实现与验证。' if run_id else ''
    if reply.action=='strategy':status='\n战略策略已更新，交付列、已有产出与当前成员保持不变。'
    await append(owner,project_id,actor('leader'),'user','chat',reply.answer+status,{'agent':members['leader'],'scheduled_run':run_id,'queued':queued})
    return {'success':True,'run_id':run_id,'queued':queued}


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
                if payload.get('workflow'):
                    payload.setdefault('workflow_archive',[]).append(payload.pop('workflow'))
                result.get('team',{}).pop('leader',None)
                for role in (['product','design','architect','engineer','qa'] if key=='requirements' else ['design','architect','engineer','qa']):
                    result.get('team',{}).pop(role,None)
            result.pop('pending',None)
            run.payload=json.dumps(payload,ensure_ascii=False);run.result=json.dumps(result,ensure_ascii=False);run.status='queued';run.stage='queued'
            await db.commit()
            stop(run_id)
            await studio.event(run_id,'decision',('30秒未操作，自动采用推荐项：' if automatic else '已确认：' if action=='approve' else '请修改：')+pending['title']+('；'+feedback if feedback else '')+('\n'+'\n'.join(selected_lines) if selected_lines else ''),role='user',recipient=pending['role'],kind='decision',state='done',automatic=automatic)
            studio.tasks[run_id]=asyncio.create_task(studio.execute(run_id,owner,run.project_id,payload))
        return {'id':run_id}
