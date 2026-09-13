"""AtomForge self-hosted account system.

This module owns AtomForge's own registration / login instead of delegating to
the platform identity provider. Accounts live in the `af_users` table, passwords
are stored as salted bcrypt hashes, and sessions are stateless JWTs signed with a
server-side secret that never reaches the browser.

An account is active as soon as it is registered: there is no email
verification or password-recovery flow.
"""

import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.af_users import Af_users
from services.account_profile import validate_username, username_key, prepare_avatar

logger = logging.getLogger(__name__)

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")

TOKEN_ALGORITHM = "HS256"
TOKEN_TTL_DAYS = 14
TOKEN_AUDIENCE = "atomforge-app"
TOKEN_ISSUER = "atomforge-auth"

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128

# bcrypt only consumes the first 72 bytes of a password.
BCRYPT_MAX_BYTES = 72

_FALLBACK_SECRET_CACHE: Optional[str] = None


def _signing_secret() -> str:
    """Return the JWT signing secret, read from the server environment only.

    Prefers a dedicated AtomForge secret, then falls back to the platform's
    JWT secret. As a last resort (local dev where neither is configured) a
    per-process random secret is generated so tokens still work within one
    runtime while never being hardcoded in source.
    """
    for env_name in ("ATOMFORGE_JWT_SECRET", "JWT_SECRET_KEY", "SECRET_KEY"):
        value = os.environ.get(env_name)
        if value and value.strip():
            return value.strip()

    global _FALLBACK_SECRET_CACHE
    if _FALLBACK_SECRET_CACHE is None:
        _FALLBACK_SECRET_CACHE = secrets.token_urlsafe(48)
        logger.warning(
            "No AtomForge JWT secret configured in the environment; "
            "using an ephemeral per-process secret."
        )
    return _FALLBACK_SECRET_CACHE


def normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


def validate_password_strength(password: str) -> None:
    """Enforce the password policy used at registration time."""
    if not password:
        raise HTTPException(status_code=400, detail="请设置密码")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail="密码至少需要 8 位字符")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail="密码过长，请控制在 128 位以内")
    if password.strip() != password:
        raise HTTPException(status_code=400, detail="密码首尾不能包含空格")

    has_letter = any(ch.isalpha() for ch in password)
    has_digit = any(ch.isdigit() for ch in password)
    if not (has_letter and has_digit):
        raise HTTPException(status_code=400, detail="密码需要同时包含字母和数字")


def validate_registration(email: str, password: str, display_name: str) -> None:
    """Reject malformed registration input with clear, user-facing messages."""
    if not email:
        raise HTTPException(status_code=400, detail="请填写邮箱")
    if len(email) > 190 or not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确，请检查后重试")

    validate_password_strength(password)

    validate_username(display_name)


def hash_password(password: str) -> str:
    """Hash a password with a freshly generated bcrypt salt."""
    payload = password.encode("utf-8")[:BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(payload, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time password verification; never raises on malformed hashes."""
    if not password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(
            password.encode("utf-8")[:BCRYPT_MAX_BYTES],
            password_hash.encode("utf-8"),
        )
    except (ValueError, TypeError):
        logger.warning("Stored password hash is malformed")
        return False


def create_session_token(user: Af_users) -> Dict[str, Any]:
    """Issue a signed JWT session for `user`."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=TOKEN_TTL_DAYS)
    claims = {
        "sub": str(user.id),
        "ver": user.session_version or 0,
        "email": user.email,
        "name": user.display_name,
        "aud": TOKEN_AUDIENCE,
        "iss": TOKEN_ISSUER,
        "iat": now,
        "nbf": now,
        "exp": expires_at,
    }
    token = jwt.encode(claims, _signing_secret(), algorithm=TOKEN_ALGORITHM)
    return {"access_token": token, "expires_at": expires_at.isoformat()}


def decode_session_token(token: str) -> Dict[str, Any]:
    """Decode and validate an AtomForge session token."""
    try:
        return jwt.decode(
            token,
            _signing_secret(),
            algorithms=[TOKEN_ALGORITHM],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_ISSUER,
        )
    except JWTError as exc:
        logger.info("AtomForge session token rejected: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态已失效，请重新登录",
        ) from exc


def public_profile(user: Af_users) -> Dict[str, Any]:
    """Serialize a user for the frontend; never exposes the password hash."""
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "username": user.username or user.display_name,
        "avatar_url": user.avatar_data or "",
        "has_password": bool(user.password_hash),
        "created_at": user.created_at.isoformat() if user.created_at else "",
        "last_login_at": user.last_login_at or "",
    }


class AfAuthService:
    """Registration, login and current-user lookup for AtomForge accounts."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_by_email(self, email: str) -> Optional[Af_users]:
        stmt = select(Af_users).where(func.lower(Af_users.email) == email)
        result = await self.db.execute(stmt)
        return result.scalars().first()

    async def find_by_id(self, user_id: int) -> Optional[Af_users]:
        stmt = select(Af_users).where(Af_users.id == user_id)
        result = await self.db.execute(stmt)
        return result.scalars().first()

    async def find_by_username(self, value: str) -> Optional[Af_users]:
        return (await self.db.execute(select(Af_users).where(Af_users.username_key == username_key(value)))).scalars().first()

    async def register(self, email: str, password: str, display_name: str) -> Af_users:
        """Create a new account, enforcing email uniqueness at write time."""
        clean_email = normalize_email(email)
        clean_name = validate_username(display_name)
        validate_registration(clean_email, password, clean_name)

        if await self.find_by_email(clean_email) is not None:
            raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录")
        if await self.find_by_username(clean_name) is not None:
            raise HTTPException(status_code=409, detail="该用户名已被占用，请换一个")

        user = Af_users(
            email=clean_email,
            password_hash=hash_password(password),
            display_name=clean_name,
            username=clean_name,
            username_key=username_key(clean_name),
            status="active",
            last_login_at=datetime.now(timezone.utc).isoformat(),
        )
        self.db.add(user)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise HTTPException(status_code=409, detail="用户名或邮箱已被占用，请更换后重试")
        return user

    async def login(self, email: str, password: str) -> Af_users:
        """Authenticate an account and stamp the login time."""
        clean_email = normalize_email(email)
        if not clean_email or not password:
            raise HTTPException(status_code=400, detail="请填写用户名或邮箱和密码")

        user = await self.find_by_email(clean_email) if '@' in clean_email else await self.find_by_username(email)
        # Same message for unknown email and wrong password to avoid enumeration.
        if user is None or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="用户名、邮箱或密码不正确")
        if (user.status or "active") != "active":
            raise HTTPException(status_code=403, detail="该账号已被停用")

        user.last_login_at = datetime.now(timezone.utc).isoformat()
        await self.db.commit()
        return user

    async def update_profile(self, user: Af_users, username: str, email: str, avatar: Optional[str] = None) -> Af_users:
        clean_name = validate_username(username)
        clean_email = normalize_email(email)
        if len(clean_email) > 190 or not EMAIL_PATTERN.fullmatch(clean_email):
            raise HTTPException(400, '邮箱格式不正确，请检查后重试')
        existing = await self.find_by_username(clean_name)
        if existing and existing.id != user.id:
            raise HTTPException(409, '该用户名已被占用，请换一个')
        existing = await self.find_by_email(clean_email)
        if existing and existing.id != user.id:
            raise HTTPException(409, '该邮箱已绑定其他账号')
        image = prepare_avatar(avatar) if avatar is not None else user.avatar_data
        user.username = clean_name
        user.username_key = username_key(clean_name)
        user.display_name = clean_name
        user.email = clean_email
        user.avatar_data = image
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise HTTPException(409, '用户名或邮箱已被占用，请更换后重试')
        return user

    async def change_password(self, user: Af_users, current_password: str, new_password: str) -> Af_users:
        if user.password_hash and not verify_password(current_password, user.password_hash):
            # A wrong password is a form error, not an expired session.
            raise HTTPException(400, '当前密码不正确，请重新输入')
        validate_password_strength(new_password)
        if verify_password(new_password, user.password_hash):
            raise HTTPException(400, '新密码不能与当前密码相同')
        previous_hash, previous_version = user.password_hash, user.session_version
        result = await self.db.execute(update(Af_users).where(
            Af_users.id == user.id,
            Af_users.password_hash == previous_hash,
            Af_users.session_version == previous_version,
        ).values(password_hash=hash_password(new_password), session_version=previous_version + 1))
        if result.rowcount != 1:
            await self.db.rollback()
            raise HTTPException(409, '密码已发生变化，请重新登录后再试')
        await self.db.commit()
        await self.db.refresh(user)
        return user
