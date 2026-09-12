from core.database import Base
from datetime import datetime as PyDateTime
from typing import Optional
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column


class Projects(Base):
    __tablename__ = "projects"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    initial_prompt: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    agent_mode: Mapped[str] = mapped_column(String, default='build', server_default='build')
    template: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    current_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    entry_file: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    share_slug: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_public: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    view_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[Optional[PyDateTime]] = mapped_column(DateTime(timezone=True), default=PyDateTime.now)
    updated_at: Mapped[Optional[PyDateTime]] = mapped_column(DateTime(timezone=True), default=PyDateTime.now, onupdate=PyDateTime.now)
