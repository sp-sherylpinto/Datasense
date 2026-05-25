"""Audit log + AI-usage daily rollup endpoints."""
import asyncpg
from fastapi import APIRouter, Depends

from app.config import settings
from app.db import get_db_pool
from app.deps import get_current_user

router = APIRouter()


def _is_audit_admin(user: str) -> bool:
    return user.lower() in settings.audit_admin_set


@router.get("/audit/queries", response_model=dict)
async def audit_queries(
    start: str | None = None,
    end: str | None = None,
    user_email: str | None = None,
    limit: int = 500,
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """
    Return workbench audit entries. Non-admin callers only see their own rows.
    ``start`` / ``end`` are ISO-8601 timestamps (inclusive lower / exclusive upper).
    """
    limit = max(1, min(5000, limit))
    clauses: list[str] = []
    args: list = []

    if _is_audit_admin(user):
        if user_email:
            args.append(user_email.lower())
            clauses.append(f"user_email = ${len(args)}")
    else:
        args.append(user)
        clauses.append(f"user_email = ${len(args)}")

    if start:
        args.append(start)
        clauses.append(f"created_at >= ${len(args)}::timestamptz")
    if end:
        args.append(end)
        clauses.append(f"created_at <  ${len(args)}::timestamptz")

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    args.append(limit)
    rows = await pool.fetch(
        f"""
        SELECT id, user_email, action, sql_text, row_count, duration_ms,
               status, error, host(ip_addr) AS ip_addr, created_at
        FROM audit_log
        {where}
        ORDER BY created_at DESC
        LIMIT ${len(args)}
        """,
        *args,
    )
    return {
        "rows": [dict(r) for r in rows],
        "scope": "all" if _is_audit_admin(user) else "self",
    }


@router.get("/audit/ai-daily", response_model=dict)
async def audit_ai_daily(
    start: str | None = None,
    end: str | None = None,
    user_email: str | None = None,
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """
    Daily AI usage rollup (IST day boundary via the ``ai_usage_daily`` view).
    Non-admin callers only see their own rows. ``start`` / ``end`` are dates
    (YYYY-MM-DD); if omitted, returns the last 30 days.
    """
    clauses: list[str] = []
    args: list = []

    if _is_audit_admin(user):
        if user_email:
            args.append(user_email.lower())
            clauses.append(f"user_email = ${len(args)}")
    else:
        args.append(user)
        clauses.append(f"user_email = ${len(args)}")

    if start:
        args.append(start)
        clauses.append(f"day >= ${len(args)}::date")
    else:
        clauses.append(
            "day >= (now() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '30 days'"
        )
    if end:
        args.append(end)
        clauses.append(f"day <= ${len(args)}::date")

    where = "WHERE " + " AND ".join(clauses)
    rows = await pool.fetch(
        f"""
        SELECT day, user_email, endpoint, provider, model,
               calls, ok_calls, error_calls,
               prompt_tokens, completion_tokens, total_tokens, total_duration_ms
        FROM ai_usage_daily
        {where}
        ORDER BY day DESC, user_email, endpoint
        """,
        *args,
    )

    totals = await pool.fetchrow(
        f"""
        SELECT
            COALESCE(SUM(calls), 0)             AS calls,
            COALESCE(SUM(error_calls), 0)       AS error_calls,
            COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0)      AS total_tokens
        FROM ai_usage_daily
        {where}
        """,
        *args,
    )

    return {
        "rows": [dict(r) for r in rows],
        "totals": dict(totals) if totals else {},
        "scope": "all" if _is_audit_admin(user) else "self",
    }
