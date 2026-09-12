import json
from datetime import datetime,timezone
from sqlalchemy import select,func
from fastapi import HTTPException
from core.database import db_manager
from models.studio import StudioUsage,StudioBudget


async def summary(db,owner):
    since=datetime.now(timezone.utc).strftime('%Y-%m-01T00:00:00+00:00')
    rows=(await db.execute(select(StudioUsage.model,func.sum(StudioUsage.input_tokens),func.sum(StudioUsage.output_tokens)).where(StudioUsage.owner==str(owner),StudioUsage.created>=since).group_by(StudioUsage.model))).all()
    b=await db.get(StudioBudget,str(owner));prices=json.loads(b.prices) if b else {}
    estimated=0;missing=False
    for model,i,o in rows:
        price=prices.get(model)
        if price:estimated+=(i*price['input']+o*price['output'])/1000000
        else:missing=True
    return {'token_limit':b.token_limit if b else 0,'prices':prices,'month':since[:7],'used_tokens':sum(i+o for _,i,o in rows),'estimated_cost':round(estimated,4),'unpriced_usage':missing}


async def check_budget(owner):
    async with db_manager.session() as db:
        s=await summary(db,owner)
        if s['token_limit'] and s['used_tokens']>=s['token_limit']:raise HTTPException(429,'本月模型 token 预算已达到上限，可在设置中调整')
