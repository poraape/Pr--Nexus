"""Database session and metadata configuration."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.core.config import settings


def _create_engine() -> Engine:

    url = make_url(settings.sqlalchemy_sync_url)
    engine_kwargs: dict[str, object] = {"future": True}
    connect_args: dict[str, object] = {}

    if url.drivername.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        engine_kwargs["connect_args"] = connect_args
        if url.database in (None, "", ":memory:"):
            engine_kwargs["poolclass"] = StaticPool
        else:
            engine_kwargs["pool_pre_ping"] = True
    else:
        engine_kwargs["pool_pre_ping"] = True

    return create_engine(url, **engine_kwargs)


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)

Base = declarative_base()


def get_session() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session for dependency injection."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Provide a transactional scope for database operations."""

    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
