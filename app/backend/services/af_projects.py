"""Project data access owned by AtomForge's own account system.

Every read and write in this service is scoped by the AtomForge account id, so a
user can never touch another user's projects, files, versions, messages or
settings. The generated entity routers are no longer used by the frontend for
these tables; this service is the single authoritative gate.
"""

import json
import logging
import secrets
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import select, update, func, or_, union_all, delete
from sqlalchemy.dialects.sqlite import insert
from core.database import Base
from sqlalchemy.ext.asyncio import AsyncSession

from models.chat_messages import Chat_messages
from models.project_files import Project_files
from models.project_versions import Project_versions
from models.projects import Projects
from models.studio import StudioMember, StudioSequence, StudioRun
from models.user_settings import User_settings

logger = logging.getLogger(__name__)

SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

DEFAULT_PROVIDER = "deepseek"
DEFAULT_MODEL = "deepseek-flash"
DEFAULT_TEMPERATURE_PCT = 35
DEFAULT_AUTO_PREVIEW = True

MAX_FILES_PER_COMMIT = 40
MAX_FILE_BYTES = 200_000


def _random_slug(length: int = 10) -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(length))


def _iso(value: Optional[datetime]) -> str:
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat() if value else ""


def serialize_project(project: Projects) -> Dict[str, Any]:
    """Shape a project for the frontend. Owner identity is never included."""
    return {
        "id": project.id,
        "name": project.name or "",
        "description": project.description or "",
        "initial_prompt": project.initial_prompt or "",
        "agent_mode": project.agent_mode or 'build',
        "template": project.template or "react-spa",
        "status": project.status or "draft",
        "current_version": int(project.current_version or 0),
        "entry_file": project.entry_file or "App.jsx",
        "share_slug": project.share_slug or "",
        "is_public": bool(project.is_public),
        "view_count": int(project.view_count or 0),
        "created_at": _iso(project.created_at),
        "updated_at": _iso(project.updated_at),
    }


def serialize_file(item: Project_files) -> Dict[str, Any]:
    return {
        "id": item.id,
        "project_id": item.project_id,
        "path": item.path,
        "language": item.language or "",
        "content": item.content or "",
        "version": int(item.version or 0),
    }


def serialize_version(item: Project_versions) -> Dict[str, Any]:
    return {
        "id": item.id,
        "project_id": item.project_id,
        "version": int(item.version or 0),
        "summary": item.summary or "",
        "prompt": item.prompt or "",
        "files_snapshot": item.files_snapshot or "[]",
        "source": item.source or "agent",
        "created_at": _iso(item.created_at),
    }


def serialize_message(item: Chat_messages) -> Dict[str, Any]:
    return {
        "id": item.id,
        "project_id": item.project_id,
        "role": item.role,
        "content": item.content or "",
        "phase": item.phase or "done",
        "version": int(item.version or 0),
        "model": item.model or "",
        "created_at": _iso(item.created_at),
    }


class AfProjectService:
    """Owner-scoped persistence for AtomForge projects."""

    def __init__(self, db: AsyncSession, owner_id: str):
        self.db = db
        # `user_id` columns are strings across the generated models.
        self.owner_id = str(owner_id)
        self.actor_id = str(owner_id)

    # ------------------------------------------------------------- projects

    async def list_projects(self) -> List[Dict[str, Any]]:
        stmt = (
            select(Projects)
            .where(or_(Projects.user_id == self.actor_id, Projects.id.in_(select(StudioMember.project_id).where(StudioMember.user_id == self.actor_id))))
            .order_by(Projects.updated_at.desc(), Projects.id.desc())
            .limit(200)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        roles=dict((await self.db.execute(select(StudioMember.project_id,StudioMember.role).where(StudioMember.user_id==self.actor_id))).all())
        return [{**serialize_project(row),'role':'owner' if str(row.user_id)==self.actor_id else roles.get(row.id,'viewer')} for row in rows]

    async def _load_owned_project(self, project_id: int, write=False, manage=False) -> Projects:
        """Fetch a project and enforce ownership on the server side."""
        stmt = select(Projects).where(Projects.id == project_id)
        project = (await self.db.execute(stmt)).scalars().first()
        if project is None:
            raise HTTPException(status_code=404, detail="项目不存在")
        if str(project.user_id) != self.actor_id:
            member = await self.db.scalar(select(StudioMember).where(StudioMember.project_id==project_id, StudioMember.user_id==self.actor_id))
            if not member: raise HTTPException(404, '项目不存在')
            if manage or (write and member.role!='editor'): raise HTTPException(403, '当前项目角色没有此操作权限')
        self.owner_id = str(project.user_id)
        return project

    async def get_project(self, project_id: int) -> Dict[str, Any]:
        project = await self._load_owned_project(project_id)
        role='owner'
        if str(project.user_id)!=self.actor_id:
            member=await self.db.scalar(select(StudioMember).where(StudioMember.project_id==project_id,StudioMember.user_id==self.actor_id))
            role=member.role
        return {**serialize_project(project),'role':role}

    async def create_project(
        self, name: str, description: str, initial_prompt: str, agent_mode: str = 'build'
    ) -> Dict[str, Any]:
        clean_name = (name or "").strip() or "未命名项目"
        if agent_mode not in {'build', 'team'}:
            raise HTTPException(400, '未知项目模式')
        # Seed above every historic project reference, including legacy orphaned logs.
        related = [t for t in Base.metadata.sorted_tables if 'project_id' in t.c]
        maxima = union_all(select(func.coalesce(func.max(Projects.id), 0).label('value')), *[select(func.coalesce(func.max(t.c.project_id), 0).label('value')) for t in related]).subquery()
        high = await self.db.scalar(select(func.max(maxima.c.value))) or 0
        sequence = insert(StudioSequence).values(key='project_id', value=high + 1)
        next_id = await self.db.scalar(sequence.on_conflict_do_update(index_elements=['key'], set_={'value': func.max(StudioSequence.value, high) + 1}).returning(StudioSequence.value))
        project = Projects(
            id=next_id,
            user_id=self.owner_id,
            name=clean_name[:120],
            description=(description or "")[:400],
            initial_prompt=(initial_prompt or "")[:4000],
            agent_mode=agent_mode,
            template="react-spa",
            status="draft",
            current_version=0,
            entry_file="App.jsx",
            share_slug="",
            is_public=False,
            view_count=0,
        )
        self.db.add(project)
        await self.db.commit()
        return serialize_project(project)

    async def update_project(
        self, project_id: int, changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        project = await self._load_owned_project(project_id, write=True)

        if "name" in changes and changes["name"] is not None:
            clean = str(changes["name"]).strip()
            if clean:
                project.name = clean[:120]
        if "description" in changes and changes["description"] is not None:
            project.description = str(changes["description"])[:400]
        if "status" in changes and changes["status"]:
            project.status = str(changes["status"])[:40]
        if "entry_file" in changes and changes["entry_file"]:
            project.entry_file = str(changes["entry_file"])[:200]
        if "is_public" in changes and changes["is_public"] is not None:
            await self._load_owned_project(project_id,manage=True)
            project.is_public = bool(changes["is_public"])

        await self.db.commit()
        return serialize_project(project)

    async def delete_project(self, project_id: int) -> None:
        project = await self._load_owned_project(project_id, manage=True)
        active = await self.db.scalar(select(StudioRun.id).where(StudioRun.project_id == project_id, StudioRun.status.in_({'queued', 'running', 'awaiting_input'})))
        if active:
            raise HTTPException(409, '请先停止此项目的任务，再删除项目')
        # Usage is retained for account billing; project IDs are never recycled.
        for table in reversed(Base.metadata.sorted_tables):
            if 'project_id' in table.c and table.name != 'studio_usage':
                await self.db.execute(delete(table).where(table.c.project_id == project_id))
        await self.db.delete(project)
        await self.db.commit()

    # ---------------------------------------------------------------- files

    async def list_files(self, project_id: int) -> List[Dict[str, Any]]:
        await self._load_owned_project(project_id)
        stmt = (
            select(Project_files)
            .where(
                Project_files.project_id == project_id,
                Project_files.user_id == self.owner_id,
            )
            .order_by(Project_files.path)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return [
            serialize_file(row)
            for row in rows
            if not bool(getattr(row, "is_deleted", False))
        ]

    @staticmethod
    def _validate_files(files: List[Dict[str, Any]]) -> List[Dict[str, str]]:
        """Normalize an incoming file set and reject unusable payloads."""
        if not isinstance(files, list) or not files:
            raise HTTPException(status_code=400, detail="没有可保存的代码文件")
        if len(files) > MAX_FILES_PER_COMMIT:
            raise HTTPException(status_code=400, detail="单次保存的文件数量过多")

        cleaned: List[Dict[str, str]] = []
        seen: set = set()
        for item in files:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path") or "").strip().lstrip("/")
            content = item.get("content")
            if not path or not isinstance(content, str):
                continue
            if ".." in path or len(path) > 200 or not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_./-]*',path):
                raise HTTPException(status_code=400, detail=f"非法的文件路径：{path}")
            if len(content.encode("utf-8")) > MAX_FILE_BYTES:
                raise HTTPException(status_code=400, detail=f"文件过大：{path}")
            if path in seen:
                continue
            seen.add(path)
            cleaned.append(
                {
                    "path": path,
                    "content": content,
                    "language": str(item.get("language") or ""),
                }
            )

        if not cleaned:
            raise HTTPException(status_code=400, detail="没有可保存的代码文件")
        return cleaned

    async def commit_files(
        self,
        project_id: int,
        files: List[Dict[str, Any]],
        summary: str,
        prompt: str,
        source: str,
        expected_version: int | None = None,
    ) -> Dict[str, Any]:
        """Replace the project's file set and persist an immutable snapshot."""
        project = await self._load_owned_project(project_id, write=True)
        if expected_version is not None and int(project.current_version or 0)!=expected_version:
            raise HTTPException(409,'项目已有新版本，请刷新后合并修改')
        cleaned = self._validate_files(files)
        next_version = int(project.current_version or 0) + 1
        # Compare-and-swap prevents overlapping editor/agent commits from
        # overwriting a version that was saved while this request was reading.
        claimed = await self.db.execute(update(Projects).where(
            Projects.id == project.id,
            func.coalesce(Projects.current_version, 0) == next_version - 1,
        ).values(current_version=next_version).execution_options(synchronize_session=False))
        if claimed.rowcount != 1:
            await self.db.rollback()
            raise HTTPException(409, '项目已有新版本，请刷新后重试')

        stmt = select(Project_files).where(
            Project_files.project_id == project.id,
            Project_files.user_id == self.owner_id,
        )
        existing = {row.path: row for row in (await self.db.execute(stmt)).scalars().all()}

        for item in cleaned:
            row = existing.pop(item["path"], None)
            if row is not None:
                row.content = item["content"]
                row.language = item["language"]
                row.version = next_version
                row.is_deleted = False
            else:
                self.db.add(
                    Project_files(
                        user_id=self.owner_id,
                        project_id=project.id,
                        path=item["path"],
                        language=item["language"],
                        content=item["content"],
                        version=next_version,
                        is_deleted=False,
                    )
                )

        # Files absent from the new set are removed from the current tree.
        for stale in existing.values():
            await self.db.delete(stale)

        self.db.add(
            Project_versions(
                user_id=self.owner_id,
                project_id=project.id,
                version=next_version,
                summary=(summary or "")[:500],
                prompt=(prompt or "")[:2000],
                files_snapshot=json.dumps(cleaned, ensure_ascii=False),
                source=(source or "agent")[:40],
            )
        )

        entry = next((p for p in ('App.tsx','App.jsx','App.ts','App.js') if any(f['path']==p for f in cleaned)),cleaned[0]['path'])
        project.current_version = next_version
        project.status = "ready"
        project.entry_file = entry

        await self.db.commit()
        return {"version": next_version, "files": cleaned, "project": serialize_project(project)}

    # ------------------------------------------------------------- versions

    async def list_versions(self, project_id: int) -> List[Dict[str, Any]]:
        await self._load_owned_project(project_id)
        stmt = (
            select(Project_versions)
            .where(
                Project_versions.project_id == project_id,
                Project_versions.user_id == self.owner_id,
            )
            .order_by(Project_versions.version.desc())
            .limit(100)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return [serialize_version(row) for row in rows]

    async def rollback(self, project_id: int, version_id: int) -> Dict[str, Any]:
        """Roll back by re-committing an older snapshot as a new version."""
        await self._load_owned_project(project_id, write=True)
        stmt = select(Project_versions).where(
            Project_versions.id == version_id,
            Project_versions.project_id == project_id,
            Project_versions.user_id == self.owner_id,
        )
        snapshot_row = (await self.db.execute(stmt)).scalars().first()
        if snapshot_row is None:
            raise HTTPException(status_code=404, detail="版本不存在")

        try:
            files = json.loads(snapshot_row.files_snapshot or "[]")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="该版本快照已损坏，无法回滚")
        if not isinstance(files, list) or not files:
            raise HTTPException(status_code=400, detail="该版本快照为空，无法回滚")

        target_version = int(snapshot_row.version or 0)
        return await self.commit_files(
            project_id,
            files,
            summary=f"回滚到 v{target_version}",
            prompt=snapshot_row.prompt or "",
            source="rollback",
        )

    # ------------------------------------------------------------- messages

    async def list_messages(self, project_id: int) -> List[Dict[str, Any]]:
        await self._load_owned_project(project_id)
        stmt = (
            select(Chat_messages)
            .where(
                Chat_messages.project_id == project_id,
                Chat_messages.user_id == self.owner_id,
            )
            .order_by(Chat_messages.id)
            .limit(400)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return [serialize_message(row) for row in rows]

    async def add_message(
        self,
        project_id: int,
        role: str,
        content: str,
        phase: str,
        version: int,
        model: str,
    ) -> Dict[str, Any]:
        await self._load_owned_project(project_id, write=True)
        if role not in {"user", "assistant", "system"}:
            raise HTTPException(status_code=400, detail="非法的消息角色")
        text = content or ""
        message = Chat_messages(
            user_id=self.owner_id,
            project_id=project_id,
            role=role,
            content=text[:20000],
            phase=(phase or "done")[:40],
            version=int(version or 0),
            model=(model or "")[:80],
            token_estimate=max(1, len(text) // 3),
        )
        self.db.add(message)
        await self.db.commit()
        return serialize_message(message)

    # ------------------------------------------------------------- settings

    async def get_settings(self) -> Dict[str, Any]:
        """Read the caller's generation profile, creating it on first use."""
        stmt = (
            select(User_settings)
            .where(User_settings.user_id == self.owner_id)
            .order_by(User_settings.id.desc())
            .limit(1)
        )
        row = (await self.db.execute(stmt)).scalars().first()
        if row is None:
            row = User_settings(
                user_id=self.owner_id,
                provider=DEFAULT_PROVIDER,
                model=DEFAULT_MODEL,
                temperature_pct=DEFAULT_TEMPERATURE_PCT,
                auto_preview=DEFAULT_AUTO_PREVIEW,
            )
            self.db.add(row)
            await self.db.commit()
        if row.provider != DEFAULT_PROVIDER or row.model not in {"deepseek-flash", "deepseek-v4-pro"}:
            row.provider = DEFAULT_PROVIDER
            row.model = DEFAULT_MODEL
            await self.db.commit()
        return {
            "provider": row.provider or DEFAULT_PROVIDER,
            "model": row.model or DEFAULT_MODEL,
            "temperature_pct": int(
                row.temperature_pct if row.temperature_pct is not None else DEFAULT_TEMPERATURE_PCT
            ),
            "auto_preview": bool(row.auto_preview),
        }

    async def save_settings(
        self,
        provider: str,
        model: str,
        temperature_pct: int,
        auto_preview: bool,
    ) -> Dict[str, Any]:
        stmt = (
            select(User_settings)
            .where(User_settings.user_id == self.owner_id)
            .order_by(User_settings.id.desc())
            .limit(1)
        )
        row = (await self.db.execute(stmt)).scalars().first()
        clean_pct = max(0, min(100, int(temperature_pct)))
        if row is None:
            row = User_settings(user_id=self.owner_id)
            self.db.add(row)
        row.provider = (provider or DEFAULT_PROVIDER)[:60]
        row.model = (model or DEFAULT_MODEL)[:80]
        row.temperature_pct = clean_pct
        row.auto_preview = bool(auto_preview)
        await self.db.commit()
        return {
            "provider": row.provider,
            "model": row.model,
            "temperature_pct": clean_pct,
            "auto_preview": bool(row.auto_preview),
        }

    # ---------------------------------------------------------------- share

    async def enable_share(self, project_id: int) -> Dict[str, Any]:
        project = await self._load_owned_project(project_id, manage=True)
        if not project.share_slug:
            slug = _random_slug()
            # Extremely unlikely collision, but keep the slug unique regardless.
            for _ in range(5):
                stmt = select(Projects).where(Projects.share_slug == slug)
                if (await self.db.execute(stmt)).scalars().first() is None:
                    break
                slug = _random_slug()
            project.share_slug = slug
        project.is_public = True
        await self.db.commit()
        return serialize_project(project)

    async def disable_share(self, project_id: int) -> Dict[str, Any]:
        project = await self._load_owned_project(project_id, manage=True)
        project.is_public = False
        await self.db.commit()
        return serialize_project(project)
