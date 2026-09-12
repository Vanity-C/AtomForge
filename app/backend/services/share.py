"""Read-only access to publicly shared projects.

Anonymous visitors have no auth token, so the generated entity endpoints cannot
serve them. This service exposes only the fields required to run and read a
shared app, and never leaks owner identity.
"""

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.project_files import Project_files
from models.projects import Projects

logger = logging.getLogger(__name__)


class ShareService:
    """Public, unauthenticated read access for shared projects."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_public_project(self, slug: str) -> Optional[Projects]:
        """Return the shared project for `slug`, or None when not shareable."""
        stmt = select(Projects).where(
            Projects.share_slug == slug,
            Projects.is_public.is_(True),
        )
        result = await self.db.execute(stmt)
        return result.scalars().first()

    async def list_files(self, project_id: int) -> List[Project_files]:
        """Return the current file set of a project ordered by path."""
        stmt = (
            select(Project_files)
            .where(Project_files.project_id == project_id)
            .order_by(Project_files.path)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def build_payload(self, slug: str) -> Optional[Dict[str, Any]]:
        """Assemble the public payload and bump the view counter."""
        project = await self.get_public_project(slug)
        if project is None:
            return None

        files = await self.list_files(project.id)

        payload: Dict[str, Any] = {
            "name": project.name or "未命名应用",
            "description": project.description or "",
            "entry_file": project.entry_file or "App.jsx",
            "current_version": int(project.current_version or 0),
            "view_count": int(project.view_count or 0) + 1,
            "updated_at": project.updated_at.isoformat() if project.updated_at else "",
            "files": [
                {
                    "path": item.path,
                    "language": item.language or "",
                    "content": item.content or "",
                }
                for item in files
                if not bool(getattr(item, "is_deleted", False))
            ],
        }

        # Short write phase, committed immediately so no transaction stays open.
        project.view_count = payload["view_count"]
        await self.db.commit()

        return payload
