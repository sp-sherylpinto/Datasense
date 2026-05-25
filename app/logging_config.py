"""Structured logging with correlation IDs.

- FastAPI middleware injects X-Correlation-ID into request.state
- Logging filter binds correlation_id to every log record
- Celery signals propagate the same ID into worker logs
- Postgres application_name includes correlation_id for query tracing
"""
from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar

# Context-local correlation ID — works across async boundaries
_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


def get_correlation_id() -> str:
    return _correlation_id.get() or ""


def set_correlation_id(cid: str | None = None) -> str:
    if not cid:
        cid = str(uuid.uuid4())[:12]
    _correlation_id.set(cid)
    return cid


class CorrelationIdFilter(logging.Filter):
    """Injects `correlation_id` into every LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = get_correlation_id()  # type: ignore[attr-defined]
        return True


def configure_logging(level: str = "INFO") -> None:
    """Idempotent setup: one handler with a format that includes correlation_id."""
    root = logging.getLogger()
    if root.handlers:
        # Already configured (e.g. by uvicorn) — just add our filter to root.
        for h in root.handlers:
            if not any(isinstance(f, CorrelationIdFilter) for f in h.filters):
                h.addFilter(CorrelationIdFilter())
        return

    handler = logging.StreamHandler()
    fmt = (
        "%(asctime)s | %(levelname)-8s | %(correlation_id)s | "
        "%(name)s:%(lineno)d | %(message)s"
    )
    handler.setFormatter(logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S"))
    handler.addFilter(CorrelationIdFilter())
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
