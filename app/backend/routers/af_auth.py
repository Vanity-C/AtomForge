"""Authentication routes for AtomForge's own account system.

These endpoints replace the platform login flow entirely: registration, login,
current-user lookup and logout all operate on the `af_users` table. An account
is usable the moment it is created - there is no email-verification step.
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, AliasChoices
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.af_auth import get_af_user, get_optional_af_user
from models.af_users import Af_users
from services.af_auth import AfAuthService, create_session_token, public_profile
from services.account_profile import validate_username

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/af-auth", tags=["af-auth"])


class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=200)
    password: str = Field(..., max_length=200)
    display_name: str = Field(..., max_length=80, validation_alias=AliasChoices('username', 'display_name'))


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=200, validation_alias=AliasChoices('identifier', 'email'))
    password: str = Field(..., max_length=200)


class ProfileRequest(BaseModel):
    username: str = Field(..., max_length=80)
    email: str = Field(..., max_length=200)
    avatar: str | None = Field(None, max_length=1_400_000)


class PasswordRequest(BaseModel):
    current_password: str = Field('', max_length=200)
    new_password: str = Field(..., max_length=128)


@router.post('/password')
async def change_password(data: PasswordRequest, current_user: Af_users = Depends(get_af_user), db: AsyncSession = Depends(get_db)):
    user = await AfAuthService(db).change_password(current_user, data.current_password, data.new_password)
    return {'user': public_profile(user), **create_session_token(user)}


@router.get('/username-availability')
async def username_availability(username: str, current_user: Af_users | None = Depends(get_optional_af_user), db: AsyncSession = Depends(get_db)):
    clean = validate_username(username)
    existing = await AfAuthService(db).find_by_username(clean)
    return {'available': existing is None or current_user is not None and existing.id == current_user.id}


@router.patch('/me')
async def update_profile(data: ProfileRequest, current_user: Af_users = Depends(get_af_user), db: AsyncSession = Depends(get_db)):
    user = await AfAuthService(db).update_profile(current_user, data.username, data.email, data.avatar)
    return {'user': public_profile(user)}


@router.post("/register")
async def register(
    data: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a new AtomForge account and return an active session.

    The account is immediately usable: registration signs the user in and no
    additional confirmation step is required.
    """
    service = AfAuthService(db)
    user = await service.register(data.email, data.password, data.display_name)
    session = create_session_token(user)
    return {
        "user": public_profile(user),
        "access_token": session["access_token"],
        "expires_at": session["expires_at"],
    }


@router.post("/login")
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate an AtomForge account and return a session token."""
    service = AfAuthService(db)
    user = await service.login(data.email, data.password)
    session = create_session_token(user)
    return {
        "user": public_profile(user),
        "access_token": session["access_token"],
        "expires_at": session["expires_at"],
    }


@router.get("/me")
async def me(current_user: Af_users = Depends(get_af_user)):
    """Return the signed-in AtomForge account."""
    return {"user": public_profile(current_user)}


@router.post("/logout")
async def logout(current_user: Af_users = Depends(get_af_user)):
    """Stateless logout: the client drops the token, nothing to revoke."""
    return {"success": True}
