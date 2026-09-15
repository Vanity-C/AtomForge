"""Versioned delivery cards and strategic policy; stored with each run, not its UI."""
import json
import asyncio
import time
from copy import deepcopy

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from core.database import db_manager
from models.studio import StudioRun

VERSION = 'delivery-v1'
MAX_REPAIRS = 30
STATES = [
    dict(id='backlog', name='待办', entry='工作包已记录，负责人唯一', exit='依赖和需求信息齐备', output='任务范围与依赖', next=['ready']),
    dict(id='ready', name='就绪', entry='依赖完成，验收标准和输出物明确', exit='负责人拉取，未超过 WIP', output='执行上下文', next=['doing']),
    dict(id='doing', name='进行中', entry='已拉取工作包', exit='真实产出已保存', output='文档或代码草稿', next=['review']),
    dict(id='review', name='评审中', entry='产出可审查', exit='阶段契约有效；代码须经过独立 QA 审查', output='结构检查或独立审查结论', next=['verifying', 'done', 'doing']),
    dict(id='verifying', name='验证中', entry='审查通过且测试可执行', exit='真实构建和独立交互测试通过', output='执行日志、失败复现信息', next=['acceptance', 'doing']),
    dict(id='acceptance', name='待验收', entry='所有必要验证通过', exit='按基线验收并保存版本成功', output='验收证据与版本号', next=['done', 'doing']),
    dict(id='done', name='完成', entry='工作包 DoD 满足，证据已保存', exit='新增需求另建任务，缺陷创建返工记录', output='已交付产物', next=[]),
]
SPECIALISTS = ('product','design','architect','engineer','qa')
GATES = {'product':'需求与验收标准结构校验','design':'设计说明结构校验','architect':'技术方案结构校验','engineer':'独立源码审查及开发自测','qa':'独立浏览器测试'}


def dependencies_ready(cards, card):
    return all(next(c for c in cards if c['id']==dep)['state'] in ({'review','verifying','acceptance','done'} if card['role']=='qa' else {'done'}) for dep in card['depends_on'])


class Policy(BaseModel):
    model_config = ConfigDict(extra='forbid')
    priority: str = Field(default='normal', pattern='^(urgent|normal|low)$')
    wip: int = Field(default=1, ge=1, le=3)
    sla_minutes: int = Field(default=15, ge=1, le=1440)
    max_repairs: int = Field(default=MAX_REPAIRS, ge=0, le=MAX_REPAIRS)
    min_tests: int = Field(default=2, ge=2, le=16)


class PolicyChange(Policy):
    revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=500)


async def initialize(run_id, plan, members, documents):
    from services import studio
    from services.agent_profiles import roster
    async with studio.start_lock, studio.event_lock, db_manager.session() as db:
        row=await db.get(StudioRun,run_id)
        if not row:raise HTTPException(404,'任务不存在')
        payload=json.loads(row.payload)
        if payload.get('workflow'):return
        now=time.time()
        prefix=run_id+':w'+str(len(payload.get('workflow_archive',[]))+1)
        cards=[]
        for assignment in plan['stages']:
            role=assignment['role']; doc=documents.get(role)
            complete=bool(doc) if role not in {'engineer','qa'} else bool(doc and documents.get('qa',{}).get('verified'))
            awaiting=bool(doc and doc.get('questions') and ('requirements' if role=='product' else 'solution') not in payload.get('confirmed',[]))
            if awaiting:complete=False
            cards.append({'id':prefix+':'+role,'role':role,'owner':members[role]['id'],'owner_name':members[role]['name'],
                'collaborators':list(dict.fromkeys([p['id'] for p in roster(members) if p['role']==role and p['id']!=members[role]['id']]+([members[assignment['gatekeeper']]['id']] if members[assignment['gatekeeper']]['id']!=members[role]['id'] else []))),
                'title':assignment['title'],'tasks':assignment['tasks'],'output':assignment['delivery'],'gate':GATES[role],
                'acceptance':documents.get('product',{}).get('acceptance',[]),
                'depends_on':[prefix+':'+SPECIALISTS[SPECIALISTS.index(role)-1]] if role!='product' else [],
                'state':'review' if awaiting else 'done' if complete else 'backlog','blocked':None,'evidence':None,'created_at':now,'history':[]})
        for card in cards:
            if card['state']=='backlog' and dependencies_ready(cards,card):card['state']='ready'
        payload['workflow']={'version':VERSION,'repair_budget_version':2,'revision':0,'policy':Policy.model_validate(plan.get('policy',{})).model_dump(),'policy_history':[], 'cards':cards,'created_at':now}
        row.payload=json.dumps(payload,ensure_ascii=False);await db.commit()


async def move(run_id, role, state, evidence='', blocked=None, *, locked=False, acceptance=None):
    from services import studio
    if not locked:
        async with studio.start_lock:return await move(run_id,role,state,evidence,blocked,locked=True,acceptance=acceptance)
    async with studio.event_lock, db_manager.session() as db:
        row=await db.get(StudioRun,run_id)
        if not row or row.status=='cancelled':raise asyncio.CancelledError()
        payload=json.loads(row.payload);board=payload.get('workflow')
        if not board:return
        card=next(c for c in board['cards'] if c['role']==role)
        before=card['state'];now=time.time()
        if before!=state:
            allowed=next(s['next'] for s in STATES if s['id']==before)
            if state not in allowed:raise ValueError(f'无效看板迁移：{before} → {state}')
            if state=='doing':
                if not dependencies_ready(board['cards'],card):raise ValueError('前序工作包尚未完成')
                if sum(c['state']=='doing' for c in board['cards'])>=board['policy']['wip']:raise ValueError('达到进行中 WIP 上限')
            card['history'].append({'from':before,'to':state,'at':now,'evidence':evidence[:1000]})
            card['state']=state
        if blocked!=card.get('blocked'):
            card['history'].append({'from':state,'to':state,'at':now,'blocked':blocked})
        card['blocked']=blocked
        if evidence:card['evidence']=evidence[:2000]
        if acceptance is not None:
            for candidate in board['cards']:candidate['acceptance']=acceptance
        for candidate in board['cards']:
            if candidate['state']=='backlog' and dependencies_ready(board['cards'],candidate):
                candidate['state']='ready';candidate['history'].append({'from':'backlog','to':'ready','at':now,'evidence':'前序交接条件满足'})
        if all(c['state']=='done' for c in board['cards']):board.setdefault('finished_at',now)
        row.payload=json.dumps(payload,ensure_ascii=False);await db.commit()


async def policy(run_id):
    async with db_manager.session() as db:
        row=await db.get(StudioRun,run_id)
        return Policy.model_validate(json.loads(row.payload).get('workflow',{}).get('policy',{}))


def present(payload, status, error=''):
    if not payload.get('workflow'):return None
    board=deepcopy(payload['workflow']);now=time.time()
    board['columns']=STATES
    for card in board['cards']:
        card['lane']='加急' if board['policy']['priority']=='urgent' else '标准'
        start=next((h['at'] for h in card['history'] if h['to']=='doing'),None)
        end=next((h['at'] for h in reversed(card['history']) if h['to']=='done'),None)
        card['cycle_seconds']=max(0,(end or now)-start) if start else None
        card['overdue']=bool(start and not end and now-start>board['policy']['sla_minutes']*60)
        blocked_since=None;blocked_seconds=0
        for entry in card['history']:
            if 'blocked' not in entry:continue
            if entry['blocked'] and blocked_since is None:blocked_since=entry['at']
            elif not entry['blocked'] and blocked_since is not None:
                blocked_seconds+=entry['at']-blocked_since;blocked_since=None
        card['blocked_seconds']=max(0,blocked_seconds+(now-blocked_since if blocked_since else 0))
        if status in {'error','interrupted','cancelled'} and card['state'] not in {'done','backlog','ready'}:
            card['blocked']=error or '任务已停止，产出保留'
            # No fabricated start timestamp for legacy/environment interruptions.
            if blocked_since is None:card['blocked_seconds']=None
    transitions=[h for c in board['cards'] if c['role']=='engineer' for h in c['history']]
    # Do not invent aggregate throughput or escaped defects without a release cohort.
    board['metrics']={'completed_packages':sum(c['state']=='done' for c in board['cards']),
        'rework_count':sum(h['to']=='doing' and h['from'] not in {'ready','doing'} for h in transitions),
        'elapsed_seconds':max(0,board.get('finished_at',now)-board['created_at']), 'escaped_defect_rate':None}
    return board


async def update_policy(owner, run_id, change):
    from services import studio
    async with studio.start_lock, studio.event_lock, db_manager.session() as db:
        studio.task_control.check()
        row=await db.get(StudioRun,run_id)
        if not row or row.owner!=str(owner):raise HTTPException(404,'任务不存在')
        if row.status not in {'queued','running','awaiting_input'}:raise HTTPException(409,'已结束任务的策略不可修改')
        payload=json.loads(row.payload);board=payload.get('workflow')
        if not board:raise HTTPException(409,'本轮尚未生成战略计划')
        if board['revision']!=change.revision:raise HTTPException(409,'策略已被更新，请刷新后重试')
        next_policy=Policy.model_validate(change.model_dump(exclude={'revision','reason'})).model_dump()
        if next_policy['wip']<sum(c['state']=='doing' for c in board['cards']):raise HTTPException(409,'WIP 不能低于正在执行的工作包数量')
        board['revision']+=1
        board['policy_history'].append({'revision':board['revision'],'at':time.time(),'by':str(owner),'reason':change.reason,'before':board['policy'],'after':next_policy})
        board['policy']=next_policy
        row.payload=json.dumps(payload,ensure_ascii=False);await db.commit()
        return present(payload,row.status,row.error)
