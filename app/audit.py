# app/audit.py
"""
Audit-log helpers.

All writes go through the superuser pool (``app.db.db``) because the
``audit_log`` / ``ai_usage_log`` tables are insert-only from the app's
perspective and we don't want RLS rules to reject a legitimate trail
entry if the active user context is ever unset.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.db import db

if TYPE_CHECKING:
    from app.ai import AIUsage

log = logging.getLogger(__name__)


async def log_query(
    *,
    user_email: str,
    action: str,
    sql_text: str | None,
    row_count: int | None,
    duration_ms: int,
    status: str,
    error: str | None = None,
    ip_addr: str | None = None,
) -> None:
    """Insert a row into ``audit_log``. Swallows errors — audit must not break the request."""
    if not db.pool:
        await db.connect()
    try:
        await db.pool.execute(
            """
            INSERT INTO audit_log
                (user_email, action, sql_text, row_count, duration_ms,
                 status, error, ip_addr)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet)
            """,
            user_email,
            action,
            sql_text,
            row_count,
            duration_ms,
            status,
            error,
            ip_addr,
        )
    except Exception:
        log.exception("audit.log_query failed (user=%s action=%s)", user_email, action)


async def log_ai_usage(
    *,
    user_email: str,
    endpoint: str,
    usage: "AIUsage | None",
    duration_ms: int,
    status: str,
    error: str | None = None,
) -> str | None:
    """Insert a row into ``ai_usage_log`` and return its id (or ``None`` on
    failure — audit must not break the request). The id is returned so HTTP
    handlers can include it in the response body, letting the frontend
    attach a 👍/👎 feedback row to the specific call.
    """
    if not db.pool:
        await db.connect()
    provider = usage.provider if usage else "unknown"
    model = usage.model if usage else None
    pt = usage.prompt_tokens if usage else None
    ct = usage.completion_tokens if usage else None
    tt = usage.total_tokens if usage else None
    try:
        row_id = await db.pool.fetchval(
            """
            INSERT INTO ai_usage_log
                (user_email, endpoint, provider, model,
                 prompt_tokens, completion_tokens, total_tokens,
                 duration_ms, status, error)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
            """,
            user_email, endpoint, provider, model,
            pt, ct, tt, duration_ms, status, error,
        )
        return str(row_id) if row_id else None
    except Exception:
        log.exception(
            "audit.log_ai_usage failed (user=%s endpoint=%s)",
            user_email, endpoint,
        )
        return None
