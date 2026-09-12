"""Persisted checkpoint deadlines; all decisions are serialized by studio.start_lock."""
import asyncio
import json
import logging
import time

from fastapi import HTTPException
from sqlalchemy import select
from core.database import db_manager
from models.studio import StudioRun

timers: dict[str, asyncio.Task] = {}
TIMEOUT_SECONDS = 30


def choices_for(questions):
    choices = []
    for index, question in enumerate(questions[:3]):
        if isinstance(question, str):
            question = {'question': question, 'options': [{'label': '采用当前方案的默认设置', 'description': '按上方方案执行；有不同想法可选其他。'}], 'recommended': 0, 'reason': '保持当前方案的范围。'}
        choices.append({'id': f'q{index + 1}', 'question': question['question'], 'reason': question.get('reason', ''),
            'recommended': f'o{question.get("recommended", 0) + 1}',
            'options': [{'id': f'o{i + 1}', **option} for i, option in enumerate(question['options'])]})
    if not choices:
        choices = [{'id': 'q1', 'question': '是否按这份方案继续？', 'reason': '当前没有需要额外决策的细节，可直接实施已列出的方案。', 'recommended': 'o1',
            'options': [{'id': 'o1', 'label': '按当前方案继续', 'description': '采用上方方案中的目标、范围与验收标准。'}]}]
    return choices


def normalize(pending):
    return {**pending, 'choices': pending.get('choices') or choices_for(pending.get('questions', [])),
        'auto': pending.get('auto') or {'paused': True, 'deadline': None}}


def stop(run_id):
    task = timers.pop(run_id, None)
    if task and task is not asyncio.current_task():
        task.cancel()


def schedule(owner, run_id, pending):
    stop(run_id)
    auto = pending.get('auto', {})
    if auto.get('paused', True) or not auto.get('deadline'):
        return
    async def expire():
        try:
            while auto['deadline'] > time.time():
                await asyncio.sleep(max(.01, auto['deadline'] - time.time()))
            from services.agent_chat import decide
            await decide(owner, run_id, pending['id'], 'auto', '')
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            # Do not retry decisions silently when permissions, versions or capacity changed.
            from services import studio
            async with studio.start_lock, db_manager.session() as db:
                run = await db.get(StudioRun, run_id)
                if run and run.status == 'awaiting_input':
                    result = json.loads(run.result)
                    card = result.get('pending', {})
                    if card.get('id') == pending['id']:
                        card['auto'] = {'paused': True, 'deadline': None, 'error': str(exc.detail) if isinstance(exc, HTTPException) else '自动确认未完成，请手动选择。'}
                        run.result = json.dumps(result, ensure_ascii=False)
                        await db.commit()
            logging.getLogger(__name__).warning('Checkpoint auto-confirm paused (%s)', type(exc).__name__)
        finally:
            if timers.get(run_id) is asyncio.current_task():
                timers.pop(run_id, None)
    timers[run_id] = asyncio.create_task(expire())


async def shutdown():
    tasks = list(timers.values())
    timers.clear()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def restore():
    await shutdown()
    async with db_manager.session() as db:
        rows = (await db.execute(select(StudioRun).where(StudioRun.status == 'awaiting_input'))).scalars().all()
        for run in rows:
            schedule(run.owner, run.id, json.loads(run.result).get('pending', {}))


async def control(owner, run_id, checkpoint_id, action):
    from services import studio
    from services.af_projects import AfProjectService
    if action not in {'pause', 'resume'}:
        raise HTTPException(400, '未知计时操作')
    async with studio.start_lock:
        await studio.get_run(owner, run_id)
        async with db_manager.session() as db:
            run = await db.get(StudioRun, run_id)
            result = json.loads(run.result)
            pending = normalize(result.get('pending', {}))
            if run.status != 'awaiting_input' or pending.get('id') != checkpoint_id:
                raise HTTPException(409, '确认卡已更新，请刷新后重试')
            await AfProjectService(db, str(owner))._load_owned_project(run.project_id, write=True)
            pending['auto'] = {'paused': action == 'pause', 'deadline': time.time() + TIMEOUT_SECONDS if action == 'resume' else None}
            result['pending'] = pending
            run.result = json.dumps(result, ensure_ascii=False)
            await db.commit()
        schedule(owner, run_id, pending)
        return {'pending': pending, 'server_time': time.time()}
