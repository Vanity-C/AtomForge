"""Read durable execution records, independently of the live event cache."""
import json

from fastapi import HTTPException
from sqlalchemy import func, select

from core.database import db_manager
from models.studio import StudioConversation, StudioRun


def log_filter(run):
    # User prompts also carry run_id, but are not execution events.
    return (StudioConversation.run_id == run.id,
            StudioConversation.owner == run.owner,
            StudioConversation.sender != 'user')


async def event_count(db, run):
    count = await db.scalar(select(func.count()).select_from(StudioConversation).where(*log_filter(run)))
    return count or len(json.loads(run.events))


async def read_events(owner, run_id, before=None, limit=100):
    async with db_manager.session() as db:
        run = await db.get(StudioRun, run_id)
        if not run or run.owner != str(owner):
            raise HTTPException(404, '任务不存在')
        filters = log_filter(run)
        total = await db.scalar(select(func.count()).select_from(StudioConversation).where(*filters))
        if not total:
            # Pre-archive tasks can still expose the records they actually retain.
            entries = [{**entry, 'id': i + 1} for i, entry in enumerate(json.loads(run.events))]
            total = len(entries)
            eligible = [entry for entry in entries if before is None or entry['id'] < before]
            items = eligible[-limit:]
            more = len(eligible) > limit
            notice = '此旧任务仅展示现存日志；未保存的历史记录无法补回。'
        else:
            query = select(StudioConversation).where(*filters)
            if before is not None:
                query = query.where(StudioConversation.id < before)
            rows = (await db.execute(query.order_by(StudioConversation.id.desc()).limit(limit + 1))).scalars().all()
            more = len(rows) > limit
            items = []
            for row in reversed(rows[:limit]):
                detail = json.loads(row.detail)
                items.append({**detail, 'id': row.id, 'stage': detail.get('event_stage', 'history'),
                              'message': row.content, 'at': row.created, 'role': row.sender,
                              'recipient': row.recipient, 'kind': row.kind})
            notice = None
        return {'items': items, 'total': total, 'has_more': more,
                'next_before': items[0]['id'] if more and items else None, 'notice': notice}


async def read_issue_history(owner, run_id):
    from services.qa_review import issue_details, unique_issues
    async with db_manager.session() as db:
        run = await db.get(StudioRun, run_id)
        if not run or run.owner != str(owner):
            raise HTTPException(404, '任务不存在')
        rows = (await db.execute(select(StudioConversation).where(
            *log_filter(run), StudioConversation.sender == 'qa',
            StudioConversation.kind == 'handoff', StudioConversation.recipient == 'engineer'
        ).order_by(StudioConversation.id.desc()))).scalars().all()
        items = []
        for row in rows:
            output = json.loads(row.detail).get('output', {})
            issues = unique_issues(output.get('items') or output.get('issues') or [])
            if not issues:
                continue
            items.append({'id': row.id, 'created': row.created, 'attempt': output.get('attempt'),
                          'output': {'summary': output.get('summary') or row.content, 'issues': issues,
                                     'issueDetails': issue_details(issues, output.get('issueDetails', []))}})
        return {'items': items}
