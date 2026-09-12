"""Validated leadership plans and durable, boundary-applied user adjustments."""
import asyncio
import json
import uuid
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from core.database import db_manager
from models.studio import StudioRun

SPECIALISTS = ('product', 'design', 'architect', 'engineer', 'qa')


class Assignment(BaseModel):
    role: Literal['product','design','architect','engineer','qa']
    title: str = Field(min_length=1,max_length=50)
    tasks: list[str] = Field(min_length=1,max_length=8)
    delivery: str = Field(min_length=1,max_length=300)
    gatekeeper: Literal['leader','product','design','architect','qa']


class LeadershipPlan(BaseModel):
    goal: str = Field(min_length=1,max_length=1500)
    summary: str = Field(min_length=1,max_length=1500)
    stages: list[Assignment] = Field(min_length=5,max_length=5)
    @model_validator(mode='after')
    def valid_schedule(self):
        roles=[s.role for s in self.stages]
        if set(roles)!=set(SPECIALISTS):raise ValueError('每个专业岗位需要一个明确阶段')
        # Design and architecture may be scheduled in either order, but implementation
        # always receives the complete specification and QA always follows code.
        if roles[0]!='product' or roles[-2:]!=['engineer','qa']:
            raise ValueError('需求先行，设计与架构完成后开发，最后独立验收')
        for stage in self.stages:
            if stage.role in {'engineer','qa'} and stage.gatekeeper!='qa':
                raise ValueError('实现与验收必须由独立测试岗位把关')
        return self


PLAN_PROMPT = '''你是团队领导，负责本次任务的实际拆分、分配和调度。根据最新用户需求、现有代码和交接结果制定计划。
返回 JSON {"goal":"目标","summary":"向用户说明的安排","stages":[{"role":"product|design|architect|engineer|qa","title":"本次阶段名","tasks":["该成员具体要做的工作"],"delivery":"应交付的结果","gatekeeper":"leader|product|design|architect|qa"}]}。
每个专业岗位恰好一个阶段，product 必须第一，engineer 和 qa 必须最后两位；design、architect 的先后由你依据项目决定。工程与验收的 gatekeeper 必须是 qa，其他阶段由你安排把关人。
任务要贴合本轮需求，保留已有未涉及功能，不能只返回通用流程。给每位成员明确边界，遇到反馈调整任务与顺序。不得跳过真实构建或独立验收，不声称尚未执行的任务已经完成。'''


class Replan(Exception):
    pass


async def queue_feedback(owner, project_id, instruction):
    """Queue against the current run under the same lock used at the save boundary."""
    from sqlalchemy import select,func
    from services import studio
    async with studio.start_lock, db_manager.session() as db:
        run=await db.scalar(select(StudioRun).where(StudioRun.project_id==project_id,StudioRun.owner==str(owner),StudioRun.status.in_({'queued','running','awaiting_input'})).order_by(StudioRun.created.desc()).limit(1))
        if not run:return None
        if run.stage=='save':raise HTTPException(409,'当前版本正在保存，请稍后把调整交给团队领导。')
        if run.status=='awaiting_input' and (await db.scalar(select(func.count()).select_from(StudioRun).where(StudioRun.status.in_(studio.ACTIVE))))>=3:
            raise HTTPException(429,'当前执行队列已满，请稍后发送调整；原确认事项仍保留。')
        payload=json.loads(run.payload)
        feedback=payload.setdefault('leader_feedback',[])
        if len([f for f in feedback if not f.get('applied')])>=8:raise HTTPException(429,'待处理反馈较多，请等待领导合并安排。')
        feedback.append({'id':uuid.uuid4().hex,'instruction':instruction,'applied':False})
        run.payload=json.dumps(payload,ensure_ascii=False)
        resume=run.status=='awaiting_input'
        if resume:run.status='queued'
        await db.commit()
        if resume:
            from services.checkpoints import stop
            stop(run.id)
            previous=studio.tasks.get(run.id)
            async def resume_run():
                if previous:await previous
                await studio.execute(run.id,owner,project_id,payload)
            studio.tasks[run.id]=asyncio.create_task(resume_run())
        return run.id


async def apply_feedback(run_id, *, locked=False):
    from services import studio
    if not locked:
        async with studio.start_lock:return await apply_feedback(run_id,locked=True)
    async with db_manager.session() as db:
        run=await db.get(StudioRun,run_id)
        if not run:return
        payload=json.loads(run.payload)
        pending=[f for f in payload.get('leader_feedback',[]) if not f.get('applied')]
        if not pending:return
        result=json.loads(run.result)
        payload.setdefault('original_instruction',payload['instruction'])
        for item in pending:item['applied']=True
        payload['instruction']=payload['original_instruction']+'\n用户后续调整（按时间顺序，较新的要求优先）：\n'+'\n'.join(f['instruction'] for f in payload['leader_feedback'])
        if result.get('draft_files'):payload['files']=result['draft_files']
        payload['confirmed']=[]
        # Old confirmations remain context, but must never outrank new instructions.
        payload.setdefault('decisions',[]).append({'checkpoint':'leader','action':'revise','feedback':payload['instruction']})
        for key in ('team','plan','pending','resume_stage','developer_tests','summary','error_code'):
            result.pop(key,None)
        run.payload=json.dumps(payload,ensure_ascii=False);run.result=json.dumps(result,ensure_ascii=False)
        run.stage='leader';run.status='running'
        await db.commit()
    await studio.event(run_id,'leader','新的反馈已合并，保留已有代码，重新分配本轮任务。',role='leader',kind='activity',state='running')
    raise Replan()
