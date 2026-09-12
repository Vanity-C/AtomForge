import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from core.database import db_manager
from dependencies.af_auth import get_af_user
from models.af_users import Af_users
from models.studio import StudioAgentSettings
from services.agent_profiles import AgentConfiguration, configuration, defaults
from services.account_profile import prepare_avatar

router=APIRouter(prefix='/api/v1/studio/agents',tags=['agents'])


@router.get('')
async def read_agents(user:Af_users=Depends(get_af_user)):
    return {**await configuration(user.id),'defaults':defaults()}


@router.put('')
async def save_agents(data:AgentConfiguration,user:Af_users=Depends(get_af_user)):
    value=data.model_dump(exclude={'revision'})
    for agent in value['agents']:
        agent['avatar']=prepare_avatar(agent['avatar']) or ''
    content=json.dumps(value,ensure_ascii=False)
    if len(content.encode())>6_000_000:raise HTTPException(413,'智能体资料过大，请减少头像图片大小')
    async with db_manager.session() as db:
        if data.revision==0:
            db.add(StudioAgentSettings(owner=str(user.id),content=content,revision=1))
            try:await db.commit()
            except IntegrityError:
                await db.rollback()
                raise HTTPException(409,'智能体设置已更新，请重新加载后再保存')
        else:
            result=await db.execute(update(StudioAgentSettings).where(StudioAgentSettings.owner==str(user.id),StudioAgentSettings.revision==data.revision)
                                    .values(content=content,revision=data.revision+1))
            if not result.rowcount:raise HTTPException(409,'智能体设置已更新，请重新加载后再保存')
            await db.commit()
    return {**value,'revision':data.revision+1,'defaults':defaults()}
