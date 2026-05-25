"""AI-powered endpoints — explain job results, NL→SQL, NL data Q&A,
conversational follow-up, and 👍/👎 feedback."""
import json
import logging
import os
import time
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.ai import (
    AIUsage,
    dataview_query,
    explain_job,
    explain_query_result,
    followup_explain,
    sql_assist,
)
from app.audit import log_ai_usage
from app.config import settings
from app.db import get_db_pool
from app.deps import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Helpers ─────────────────────────────────────────────────────────────


async def _load_dataset_memo(pool, dataset_id: str | None) -> str | None:
    """Pull the cached characterisation memo for a dataset, if any."""
    if not dataset_id:
        return None
    try:
        row = await pool.fetchval(
            "SELECT summary_memo FROM datasets WHERE id = $1", UUID(dataset_id)
        )
        return row
    except Exception:
        return None


async def _job_dataset_id(pool, job_id: UUID) -> str | None:
    row = await pool.fetchval(
        "SELECT dataset_id FROM jobs WHERE id = $1", job_id
    )
    return str(row) if row else None


# ─── Job result explanation (streaming) ──────────────────────────────────


@router.post("/ai/explain/{job_id}")
async def ai_explain(
    job_id: UUID,
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Stream a plain-English explanation of a completed job's results.

    The trailing event includes the AI-usage row id so the frontend can attach
    a 👍/👎 feedback rating: ``data: {"_meta":{"usage_id":"..."}}``.
    """
    async with pool.acquire() as conn:
        job = await conn.fetchrow(
            "SELECT task_name, result_path, owner, dataset_id FROM jobs WHERE id = $1",
            job_id,
        )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job["owner"] or job["owner"] != user:
        raise HTTPException(status_code=403, detail="Not your job")
    if not job["result_path"]:
        raise HTTPException(status_code=400, detail="Job has no result yet")

    results_dir = os.path.join(os.path.realpath(settings.DATA_DIR), "results")
    if not os.path.realpath(job["result_path"]).startswith(results_dir + os.sep):
        raise HTTPException(status_code=403, detail="Access denied")

    memo = await _load_dataset_memo(
        pool, str(job["dataset_id"]) if job["dataset_id"] else None
    )
    usage = AIUsage()
    start = time.perf_counter()

    async def event_stream():
        status_str = "ok"
        err: str | None = None
        try:
            async for token in explain_job(
                job["task_name"], job["result_path"],
                usage=usage, dataset_memo=memo,
            ):
                yield f"data: {token.replace(chr(92), chr(92)+chr(92)).replace(chr(10), chr(92)+'n').replace(chr(13), '')}\n\n"
        except Exception as e:
            status_str = "error"
            err = str(e)[:500]
            raise
        finally:
            usage_id = await log_ai_usage(
                user_email=user, endpoint="explain_job", usage=usage,
                duration_ms=int((time.perf_counter() - start) * 1000),
                status=status_str, error=err,
            )
            # Trailing meta frame so frontend knows which usage row to attach
            # feedback to. JSON is escape-free in our SSE protocol.
            yield f"data: {json.dumps({'_meta': {'usage_id': usage_id}})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ─── Query result explanation (streaming) ────────────────────────────────


@router.post("/ai/explain-query")
async def ai_explain_query(
    sql: str = Body(..., embed=True),
    columns: list[str] = Body(..., embed=True),
    rows: list[dict] = Body(..., embed=True),
    user: str = Depends(get_current_user),
):
    """Stream a plain-English explanation of an ad-hoc query result."""
    usage = AIUsage()
    start = time.perf_counter()

    async def event_stream():
        status_str = "ok"
        err: str | None = None
        try:
            async for token in explain_query_result(sql, columns, rows, usage=usage):
                yield f"data: {token.replace(chr(92), chr(92)+chr(92)).replace(chr(10), chr(92)+'n').replace(chr(13), '')}\n\n"
        except Exception as e:
            status_str = "error"
            err = str(e)[:500]
            raise
        finally:
            usage_id = await log_ai_usage(
                user_email=user, endpoint="explain_query_result", usage=usage,
                duration_ms=int((time.perf_counter() - start) * 1000),
                status=status_str, error=err,
            )
            yield f"data: {json.dumps({'_meta': {'usage_id': usage_id}})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ─── Conversational follow-up on an explained job (streaming) ────────────


@router.post("/ai/chat/{job_id}")
async def ai_chat(
    job_id: UUID,
    history: list[dict] = Body(default_factory=list, embed=True),
    message: str = Body(..., embed=True),
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Continue an explain-job conversation. ``history`` is the prior
    turns ([{role: 'assistant', content: …}, {role: 'user', content: …}, …]).
    Streams the next assistant turn back, grounded on the original result data.
    """
    async with pool.acquire() as conn:
        job = await conn.fetchrow(
            "SELECT task_name, result_path, owner, dataset_id FROM jobs WHERE id = $1",
            job_id,
        )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job["owner"] or job["owner"] != user:
        raise HTTPException(status_code=403, detail="Not your job")
    if not job["result_path"]:
        raise HTTPException(status_code=400, detail="Job has no result yet")

    results_dir = os.path.join(os.path.realpath(settings.DATA_DIR), "results")
    if not os.path.realpath(job["result_path"]).startswith(results_dir + os.sep):
        raise HTTPException(status_code=403, detail="Access denied")

    if not message or not message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")
    # Light hygiene on history: only keep role+content, drop anything else.
    safe_history = [
        {"role": h.get("role", "user"), "content": str(h.get("content", ""))}
        for h in history
        if h.get("role") in ("user", "assistant")
    ][-10:]  # cap at last 10 turns to keep the prompt bounded

    memo = await _load_dataset_memo(
        pool, str(job["dataset_id"]) if job["dataset_id"] else None
    )
    usage = AIUsage()
    start = time.perf_counter()

    async def event_stream():
        status_str = "ok"
        err: str | None = None
        try:
            async for token in followup_explain(
                job["task_name"], job["result_path"],
                safe_history, message,
                usage=usage, dataset_memo=memo,
            ):
                yield f"data: {token.replace(chr(92), chr(92)+chr(92)).replace(chr(10), chr(92)+'n').replace(chr(13), '')}\n\n"
        except Exception as e:
            status_str = "error"
            err = str(e)[:500]
            raise
        finally:
            usage_id = await log_ai_usage(
                user_email=user, endpoint="followup_explain", usage=usage,
                duration_ms=int((time.perf_counter() - start) * 1000),
                status=status_str, error=err,
            )
            yield f"data: {json.dumps({'_meta': {'usage_id': usage_id}})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ─── SQL copilot ─────────────────────────────────────────────────────────


@router.post("/ai/sql-assist", response_model=dict)
async def ai_sql_assist(
    prompt: str = Body(..., embed=True),
    tables: list[dict] = Body(..., embed=True),
    user: str = Depends(get_current_user),
):
    """Generate a SELECT SQL query from a natural language prompt.
    Uses tool calling — the model may call `describe_column` to verify
    column contents before producing the final SQL."""
    logger.info(f"sql_assist called with prompt: {prompt[:50]}...")
    start = time.perf_counter()
    status_str = "ok"
    err: str | None = None
    usage: AIUsage | None = None
    try:
        sql, usage = await sql_assist(prompt, tables)
        usage_id = await log_ai_usage(
            user_email=user, endpoint="sql_assist", usage=usage,
            duration_ms=int((time.perf_counter() - start) * 1000),
            status=status_str, error=err,
        )
        return {"sql": sql, "usage_id": usage_id}
    except Exception as e:
        status_str = "error"
        err = str(e)[:500]
        logger.exception("sql_assist failed")
        await log_ai_usage(
            user_email=user, endpoint="sql_assist", usage=usage,
            duration_ms=int((time.perf_counter() - start) * 1000),
            status=status_str, error=err,
        )
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")


# ─── DataView NL Q&A ─────────────────────────────────────────────────────


@router.post("/ai/dataview-query", response_model=dict)
async def ai_dataview_query(
    prompt: str = Body(..., embed=True),
    columns: list[dict] = Body(..., embed=True),
    sample_rows: list[dict] = Body(..., embed=True),
    table_name: str | None = Body(default=None, embed=True),
    dataset_id: str | None = Body(default=None, embed=True),
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Answer a natural language question. When the caller provides
    ``table_name``, real per-column aggregates are computed across the full
    dataset and fed to the model alongside the sample rows.
    """
    start = time.perf_counter()
    status_str = "ok"
    err: str | None = None
    usage: AIUsage | None = None
    memo = await _load_dataset_memo(pool, dataset_id)
    try:
        result, usage = await dataview_query(
            prompt, columns, sample_rows,
            table_name=table_name, dataset_memo=memo,
        )
        usage_id = await log_ai_usage(
            user_email=user, endpoint="dataview_query", usage=usage,
            duration_ms=int((time.perf_counter() - start) * 1000),
            status=status_str, error=err,
        )
        return {**result, "usage_id": usage_id}
    except Exception as e:
        status_str = "error"
        err = str(e)[:500]
        await log_ai_usage(
            user_email=user, endpoint="dataview_query", usage=usage,
            duration_ms=int((time.perf_counter() - start) * 1000),
            status=status_str, error=err,
        )
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")


# ─── Feedback widget ────────────────────────────────────────────────────


@router.post("/ai/feedback", response_model=dict)
async def ai_feedback(
    usage_id: str = Body(..., embed=True),
    rating: int = Body(..., embed=True),  # +1 or -1
    comment: str | None = Body(default=None, embed=True),
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Record a 👍/👎 (+ optional free-text comment) for a specific AI call.
    Joined to ``ai_usage_log`` by usage_id so a future quality dashboard can
    correlate ratings with the prompt / model / endpoint that produced them.
    """
    if rating not in (-1, 1):
        raise HTTPException(status_code=400, detail="rating must be -1 or 1")
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO ai_feedback (usage_id, user_email, rating, comment)
                VALUES ($1, $2, $3, $4)
                RETURNING id, created_at
                """,
                UUID(usage_id), user, rating, (comment or None),
            )
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=404, detail="usage_id not found")
    except Exception as e:
        logger.exception("ai_feedback insert failed")
        raise HTTPException(status_code=500, detail=f"Could not record feedback: {e}")
    return {"id": str(row["id"]), "created_at": row["created_at"].isoformat()}


# ─── Dataset memo (read-only, for debugging) ─────────────────────────────


@router.get("/ai/dataset-memo/{dataset_id}", response_model=dict)
async def ai_dataset_memo(
    dataset_id: UUID,
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT summary_memo, summary_memo_generated_at FROM datasets WHERE id = $1",
            dataset_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {
        "memo": row["summary_memo"],
        "generated_at": row["summary_memo_generated_at"].isoformat() if row["summary_memo_generated_at"] else None,
    }
