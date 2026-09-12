"""Owner-scoped project API for AtomForge's own account system.

The frontend no longer talks to the generated entity endpoints for project data.
Every route here depends on `get_af_user`, so isolation is enforced server-side
by the AtomForge account id rather than by the platform identity.
"""

import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.af_auth import get_af_user
from models.af_users import Af_users
from services.af_projects import AfProjectService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/af", tags=["af-projects"])


def _service(db: AsyncSession, user: Af_users) -> AfProjectService:
    return AfProjectService(db, str(user.id))


class CreateProjectRequest(BaseModel):
    name: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=600)
    initial_prompt: str = Field(default="", max_length=6000)
    agent_mode: Literal['build', 'team'] = 'build'


class UpdateProjectRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=600)
    status: Optional[str] = Field(default=None, max_length=40)
    entry_file: Optional[str] = Field(default=None, max_length=200)
    is_public: Optional[bool] = None


class FilePayload(BaseModel):
    path: str = Field(..., max_length=200)
    content: str = ""
    language: str = Field(default="", max_length=40)


class CommitFilesRequest(BaseModel):
    expected_version: int | None = Field(default=None,ge=0)
    files: List[FilePayload]
    summary: str = Field(default="", max_length=1000)
    prompt: str = Field(default="", max_length=6000)
    source: str = Field(default="agent", max_length=40)


class RollbackRequest(BaseModel):
    version_id: int


class AddMessageRequest(BaseModel):
    role: str = Field(..., max_length=20)
    content: str = Field(default="", max_length=30000)
    phase: str = Field(default="done", max_length=40)
    version: int = 0
    model: str = Field(default="", max_length=80)


class SettingsRequest(BaseModel):
    provider: Literal["deepseek"] = "deepseek"
    model: Literal["deepseek-flash", "deepseek-v4-pro"] = "deepseek-flash"
    temperature_pct: int = Field(default=35, ge=0, le=100)
    auto_preview: bool = True


# ----------------------------------------------------------------- projects


@router.get("/projects")
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """List the caller's own projects."""
    items = await _service(db, current_user).list_projects()
    return {"items": items}


@router.post("/projects")
async def create_project(
    data: CreateProjectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Create a project owned by the caller."""
    project = await _service(db, current_user).create_project(
        data.name, data.description, data.initial_prompt, data.agent_mode
    )
    return {"project": project}


@router.get("/projects/{project_id}")
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Read a single owned project."""
    project = await _service(db, current_user).get_project(project_id)
    return {"project": project}


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: int,
    data: UpdateProjectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Update mutable fields of an owned project."""
    changes: Dict[str, Any] = data.model_dump(exclude_unset=True)
    project = await _service(db, current_user).update_project(project_id, changes)
    return {"project": project}


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Delete an owned project together with its files, versions and messages."""
    import asyncio
    from services import studio
    from services.agent_chat import chat_locks
    async with studio.start_lock:
        lock = chat_locks.setdefault(project_id, asyncio.Lock())
        if lock.locked():
            raise HTTPException(409, '请等待智能体回复完成后再删除项目')
        async with lock:
            await _service(db, current_user).delete_project(project_id)
    return {"success": True}


# -------------------------------------------------------------------- files


@router.get("/projects/{project_id}/files")
async def list_files(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """List the current file tree of an owned project."""
    items = await _service(db, current_user).list_files(project_id)
    return {"items": items}


@router.post("/projects/{project_id}/files")
async def commit_files(
    project_id: int,
    data: CommitFilesRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Replace the file set and record a new version snapshot."""
    payload = [item.model_dump() for item in data.files]
    result = await _service(db, current_user).commit_files(
        project_id, payload, data.summary, data.prompt, data.source, data.expected_version
    )
    return result


# ----------------------------------------------------------------- versions


@router.get("/projects/{project_id}/versions")
async def list_versions(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """List version snapshots of an owned project."""
    items = await _service(db, current_user).list_versions(project_id)
    return {"items": items}


@router.post("/projects/{project_id}/rollback")
async def rollback(
    project_id: int,
    data: RollbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Roll back an owned project to a previous snapshot."""
    result = await _service(db, current_user).rollback(project_id, data.version_id)
    return result


# ----------------------------------------------------------------- messages


@router.get("/projects/{project_id}/messages")
async def list_messages(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Read the agent conversation of an owned project."""
    items = await _service(db, current_user).list_messages(project_id)
    return {"items": items}


@router.post("/projects/{project_id}/messages")
async def add_message(
    project_id: int,
    data: AddMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Append one conversation message to an owned project."""
    message = await _service(db, current_user).add_message(
        project_id, data.role, data.content, data.phase, data.version, data.model
    )
    return {"message": message}


# -------------------------------------------------------------------- share


@router.post("/projects/{project_id}/share")
async def enable_share(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Turn on the public read-only share link."""
    project = await _service(db, current_user).enable_share(project_id)
    return {"project": project}


@router.delete("/projects/{project_id}/share")
async def disable_share(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Turn off the public read-only share link."""
    project = await _service(db, current_user).disable_share(project_id)
    return {"project": project}


# ----------------------------------------------------------------- settings


@router.get("/settings")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Read the caller's generation profile."""
    settings = await _service(db, current_user).get_settings()
    return {"settings": settings}


@router.put("/settings")
async def save_settings(
    data: SettingsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Af_users = Depends(get_af_user),
):
    """Persist the caller's generation profile."""
    settings = await _service(db, current_user).save_settings(
        data.provider, data.model, data.temperature_pct, data.auto_preview
    )
    return {"settings": settings}
