"""Additive records for external identities and durable delivery attempts."""
from sqlalchemy import Integer, String, Text, UniqueConstraint, Float
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base


class ExternalIdentity(Base):
    __tablename__ = 'af_external_identities'
    __table_args__ = (UniqueConstraint('provider', 'subject'), UniqueConstraint('owner', 'provider'))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner: Mapped[int] = mapped_column(Integer, index=True)
    provider: Mapped[str] = mapped_column(String)
    subject: Mapped[str] = mapped_column(String)
    login: Mapped[str] = mapped_column(String)
    encrypted: Mapped[str] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(String, default='')


class OAuthFlow(Base):
    __tablename__ = 'af_oauth_flows'
    key: Mapped[str] = mapped_column(String, primary_key=True)
    browser: Mapped[str] = mapped_column(String)
    expires: Mapped[float] = mapped_column(Float)
    encrypted: Mapped[str] = mapped_column(Text)


class Delivery(Base):
    __tablename__ = 'af_deliveries'
    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    owner: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String)
    provider: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default='queued')
    stage: Mapped[str] = mapped_column(String, default='queued')
    request: Mapped[str] = mapped_column(Text, default='{}')
    result: Mapped[str] = mapped_column(Text, default='{}')
    error: Mapped[str] = mapped_column(Text, default='')
    created: Mapped[float] = mapped_column(Float)
