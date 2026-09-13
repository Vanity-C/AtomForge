"""Dependency helpers for AtomForge's own account system.

`get_af_user` resolves the AtomForge session token into an account row and is the
single gate every owned-data route depends on. `get_optional_af_user` is used by
routes that must also serve anonymous visitors (public share pages).
"""

import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.af_users import Af_users
from services.af_auth import AfAuthService, decode_session_token

logger = logging.getLogger(__name__)


def _extract_token(request: Request) -> Optional[str]:
    """Read the AtomForge session token from the request headers."""
    # A dedicated header keeps AtomForge sessions independent from the platform
    # Authorization header that the SDK attaches for its own purposes.
    direct = request.headers.get("X-AtomForge-Token")
    if direct and direct.strip():
        return direct.strip()

    raw = request.headers.get("Authorization") or ""
    if raw.lower().startswith("bearer "):
        candidate = raw[7:].strip()
        return candidate or None
    return None


async def get_optional_af_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Optional[Af_users]:
    """Resolve the current AtomForge account, or None for anonymous visitors."""
    token = _extract_token(request)
    if not token:
        return None
    try:
        payload = decode_session_token(token)
    except HTTPException:
        return None

    subject = payload.get("sub")
    try:
        user_id = int(subject)
    except (TypeError, ValueError):
        return None

    service = AfAuthService(db)
    user = await service.find_by_id(user_id)
    if user is None or (user.status or "active") != "active":
        return None
    if payload.get('ver', 0) != user.session_version:
        return None
    return user


async def get_af_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Af_users:
    """Require a valid AtomForge session; raises 401 otherwise."""
    token = _extract_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录 AtomForge 账号",
        )

    payload = decode_session_token(token)
    subject = payload.get("sub")
    try:
        user_id = int(subject)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态已失效，请重新登录",
        )

    service = AfAuthService(db)
    user = await service.find_by_id(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号不存在或已被删除，请重新登录",
        )
    if (user.status or "active") != "active":
        raise HTTPException(status_code=403, detail="该账号已被停用")
    if payload.get('ver', 0) != user.session_version:
        raise HTTPException(status_code=401, detail="密码已更新，请重新登录")
    return user
