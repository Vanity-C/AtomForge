"""Additive studio schema. Existing project/account tables remain compatible."""
from datetime import datetime, timezone
from sqlalchemy import Integer, String, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base


class StudioSequence(Base):
    __tablename__ = 'studio_sequences'
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[int] = mapped_column(Integer, default=0)


class StudioAgentSettings(Base):
    __tablename__ = 'studio_agent_settings'
    owner: Mapped[str] = mapped_column(String, primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class StudioRun(Base):
    __tablename__ = 'studio_runs'
    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    owner: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default='queued', index=True)
    stage: Mapped[str] = mapped_column(String, default='queued')
    payload: Mapped[str] = mapped_column(Text, default='{}')
    result: Mapped[str] = mapped_column(Text, default='{}')
    events: Mapped[str] = mapped_column(Text, default='[]')
    error: Mapped[str] = mapped_column(Text, default='')
    created: Mapped[str] = mapped_column(String, default=lambda:datetime.now(timezone.utc).isoformat())


class StudioArtifact(Base):
    __tablename__ = 'studio_artifacts'
    project_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)


class StudioUsage(Base):
    __tablename__ = 'studio_usage'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner: Mapped[str] = mapped_column(String, index=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    run_id: Mapped[str] = mapped_column(String, index=True)
    model: Mapped[str] = mapped_column(String)
    stage: Mapped[str] = mapped_column(String)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created: Mapped[str] = mapped_column(String, default=lambda:datetime.now(timezone.utc).isoformat())


class StudioCloud(Base):
    __tablename__ = 'studio_cloud'
    project_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-collection policy: private (creator only), shared (signed-in members).
    collections: Mapped[str] = mapped_column(Text, default='{}')


class CloudUser(Base):
    __tablename__ = 'studio_cloud_users'
    __table_args__ = (UniqueConstraint('project_id','email'),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    email: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String)


class CloudRecord(Base):
    __tablename__ = 'studio_cloud_records'
    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    collection: Mapped[str] = mapped_column(String, index=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    data: Mapped[str] = mapped_column(Text)


class StudioRelease(Base):
    __tablename__ = 'studio_releases'
    project_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True)
    version: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    artifact: Mapped[str] = mapped_column(Text)
    files: Mapped[str] = mapped_column(Text)


class StudioMember(Base):
    __tablename__ = 'studio_members'
    __table_args__ = (UniqueConstraint('project_id','user_id'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String, default='viewer')


class StudioConnection(Base):
    __tablename__='studio_connections'
    project_id:Mapped[int]=mapped_column(Integer,primary_key=True)
    encrypted:Mapped[str]=mapped_column(Text,default='')


class StudioBudget(Base):
    __tablename__='studio_budgets'
    owner:Mapped[str]=mapped_column(String,primary_key=True)
    token_limit:Mapped[int]=mapped_column(Integer,default=0)
    prices:Mapped[str]=mapped_column(Text,default='{}')


class StudioReport(Base):
    __tablename__='studio_reports'
    id:Mapped[str]=mapped_column(String,primary_key=True)
    project_id:Mapped[int]=mapped_column(Integer,index=True)
    kind:Mapped[str]=mapped_column(String)
    content:Mapped[str]=mapped_column(Text)
    created:Mapped[str]=mapped_column(String,default=lambda:datetime.now(timezone.utc).isoformat())


class StudioConversation(Base):
    __tablename__ = 'studio_conversations'
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    project_id:Mapped[int]=mapped_column(Integer,index=True)
    owner:Mapped[str]=mapped_column(String,index=True)
    run_id:Mapped[str]=mapped_column(String,default='',index=True)
    sender:Mapped[str]=mapped_column(String)
    recipient:Mapped[str]=mapped_column(String,default='all')
    kind:Mapped[str]=mapped_column(String,default='message')
    content:Mapped[str]=mapped_column(Text)
    detail:Mapped[str]=mapped_column(Text,default='{}')
    created:Mapped[str]=mapped_column(String,default=lambda:datetime.now(timezone.utc).isoformat())
