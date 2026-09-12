"""Public share endpoints (no authentication required)."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.share import ShareService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/share", tags=["share"])


@router.get("/{slug}")
async def get_shared_project(slug: str, db: AsyncSession = Depends(get_db)):
    """Return a publicly shared project with its current files."""
    clean_slug = (slug or "").strip()
    if not clean_slug or len(clean_slug) > 64:
        raise HTTPException(status_code=404, detail="分享链接不存在或已被关闭")

    service = ShareService(db)
    try:
        payload = await service.build_payload(clean_slug)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("failed to load shared project: %s", exc)
        raise HTTPException(status_code=500, detail="加载分享内容失败，请稍后重试")

    if payload is None:
        raise HTTPException(status_code=404, detail="分享链接不存在或已被关闭")

    return payload
