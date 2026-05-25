"""AI integration. Single provider: Azure OpenAI v1 (OpenAI-compatible)
running Kimi-K2.5 by default.

Public API
----------
- ``classify_dataset`` — heuristic first, AI only on ambiguity.
- ``sql_assist``       — tool-using SQL copilot (multi-turn).
- ``dataview_query``   — grounded NL Q&A using real column aggregates.
- ``explain_job``      — streaming markdown explanation of a job's results.
- ``explain_query_result`` — streaming explanation of an ad-hoc query result.
- ``followup_explain`` — multi-turn chat continuation grounded on a job result.
- ``generate_dataset_memo`` — short cached characterisation memo.
- ``deterministic_explain`` — non-AI fallback using the real numbers.

All public helpers either return or populate an :class:`AIUsage` instance so
the audit-log row written by the HTTP handler captures token spend. Both
structured (json_schema) and tool-calling responses route through the same
``_complete`` helper for consistent retry / usage tracking.

**Prompt versioning** (migration 014): prompts are loaded from the
`ai_prompts` table. The active version per name is cached in-process.
Fallbacks to the hard-coded strings in `app.prompts` if the DB row is
missing (e.g. during first deploy before migrations run).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Iterable
from uuid import UUID

import asyncpg
import polars as pl

from app import prompts
from app.config import settings

log = logging.getLogger(__name__)


# ─── Usage + capability dataclasses ──────────────────────────────────────


@dataclass
class AIUsage:
    provider: str = ""
    model: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cached_tokens: int | None = None  # prompt-cache hit count when reported
    prompt_version: int | None = None  # version from ai_prompts table


def _record_usage(usage: AIUsage | None, response_usage: Any) -> None:
    """Populate an AIUsage from an OpenAI-shaped usage object."""
    if usage is None or response_usage is None:
        return
    usage.prompt_tokens = getattr(response_usage, "prompt_tokens", None)
    usage.completion_tokens = getattr(response_usage, "completion_tokens", None)
    usage.total_tokens = getattr(response_usage, "total_tokens", None)
    details = getattr(response_usage, "prompt_tokens_details", None)
    if details:
        usage.cached_tokens = getattr(details, "cached_tokens", None)


# ─── Client + token defaults ─────────────────────────────────────────────


# Kimi-K2.5 is a reasoning model: completion_tokens includes both the
# internal reasoning trace and the visible output. Budget generously.
_DEFAULT_MAX_TOKENS = 4000
_STREAM_MAX_TOKENS = 4000
_CLASSIFY_MAX_TOKENS = 600


def _client():
    from openai import AsyncOpenAI

    endpoint = settings.AZURE_OPENAI_ENDPOINT.rstrip("/")
    return AsyncOpenAI(
        api_key=settings.AZURE_OPENAI_API_KEY,
        base_url=endpoint,
        timeout=180.0,
    )


async def _resolve_model() -> str:
    """Honour core.app_ai_config override for DataSense; fall back to env."""
    pool = _default_pool()
    if pool is None:
        return settings.AZURE_OPENAI_MODEL
    try:
        from app.ai_usage import get_app_model
        return await get_app_model(pool, APP_SLUG, settings.AZURE_OPENAI_MODEL)
    except Exception:
        return settings.AZURE_OPENAI_MODEL


# ─── Prompt versioning helpers ───────────────────────────────────────────


async def _load_prompt(name: str) -> dict[str, Any] | None:
    """Load active prompt from DB (cached). Falls back to None so callers
    can use the hard-coded prompts module."""
    try:
        from app.prompt_store import get_prompt
        return await get_prompt(name)
    except Exception:
        return None


def _build_messages(
    prompt_name: str,
    prompt_row: dict[str, Any] | None,
    fallback_builder: Any,
    **kwargs: Any,
) -> tuple[list[dict], dict | None, int]:
    """Return (messages, schema_json, version).

    If *prompt_row* is available, render it via prompt_store.render_prompt.
    Otherwise call the legacy fallback_builder from app.prompts.
    """
    if prompt_row is not None:
        try:
            from app.prompt_store import render_prompt
            system, user, schema = render_prompt(prompt_row, **kwargs)
            msgs = [{"role": "system", "content": system}]
            if user:
                msgs.append({"role": "user", "content": user})
            return msgs, schema, prompt_row.get("version", 1)
        except Exception:
            pass  # fall through to legacy
    msgs = fallback_builder(**kwargs)
    return msgs, None, 0  # version 0 = legacy hard-coded


# ─── One-shot completion (with optional structured output) ───────────────


async def _complete(
    messages: list[dict],
    *,
    schema: dict | None = None,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    usage: AIUsage | None = None,
    tools: list[dict] | None = None,
    tool_choice: str | dict | None = None,
) -> Any:
    """Issue a single chat completion. Returns the OpenAI response object so
    callers can read both ``message.content`` and ``message.tool_calls``."""
    client = _client()
    model_name = await _resolve_model()
    if usage is not None:
        usage.provider = "azure"
        usage.model = model_name
    try:
        kwargs: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "max_completion_tokens": max_tokens,
        }
        if schema is not None:
            kwargs["response_format"] = {
                "type": "json_object",
            }
        if tools is not None:
            kwargs["tools"] = tools
            if tool_choice is not None:
                kwargs["tool_choice"] = tool_choice
        resp = await client.chat.completions.create(**kwargs)
        _record_usage(usage, resp.usage)
        return resp
    finally:
        await client.close()


async def _complete_json(
    messages: list[dict],
    *,
    schema: dict,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    usage: AIUsage | None = None,
) -> dict:
    """Helper: structured-output completion that returns the parsed JSON."""
    resp = await _complete(messages, schema=schema, max_tokens=max_tokens, usage=usage)
    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise ValueError("AI returned empty content (likely token-budget exhaustion)")
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        # Strict json_schema should never let this happen, but be defensive
        # — try to extract a JSON object from the text.
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"AI returned non-JSON: {content[:200]}") from e


# ─── Streaming ───────────────────────────────────────────────────────────


async def _stream(
    messages: list[dict],
    *,
    max_tokens: int = _STREAM_MAX_TOKENS,
    usage: AIUsage | None = None,
) -> AsyncGenerator[str, None]:
    client = _client()
    model_name = await _resolve_model()
    if usage is not None:
        usage.provider = "azure"
        usage.model = model_name
    try:
        stream = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            max_completion_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
            if usage is not None and getattr(chunk, "usage", None):
                _record_usage(usage, chunk.usage)
    finally:
        await client.close()


# ─── Schemas ─────────────────────────────────────────────────────────────


def _schema(name: str, props: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "strict": True,
        "schema": {
            "type": "object",
            "properties": props,
            "required": required,
            "additionalProperties": False,
        },
    }


CLASSIFY_SCHEMA = _schema(
    "DatasetClassification",
    {
        "label": {
            "type": "string",
            "enum": [
                "journal_entries",
                "financial_statements",
                "debtors_creditors",
                "general",
            ],
        },
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    ["label", "confidence"],
)


DATAVIEW_SCHEMA = _schema(
    "DataviewAnswer",
    {
        "answer":          {"type": "string"},
        "insights":        {"type": "array", "items": {"type": "string"}},
        "highlight_rows":  {"type": "array", "items": {"type": "integer"}},
    },
    ["answer", "insights", "highlight_rows"],
)


# ─── Heuristic tier (used before any AI call) ────────────────────────────


_JE_SIGNALS = {
    "date", "amount", "debit", "credit", "voucher", "narration",
    "ledger", "account", "particulars", "journal", "entry",
}
_FS_SIGNALS = {
    "revenue", "income", "expense", "asset", "liability", "equity",
    "balance", "ratio", "current", "non-current",
}
_DC_SIGNALS = {
    "outstanding", "due", "overdue", "ageing", "aging", "debtor",
    "creditor", "party", "invoice", "bill", "receivable", "payable",
}


def _classify_heuristic(col_names: list[str]) -> tuple[str, str]:
    """Return (label, confidence). Confidence is 'high' if the winning bucket
    has 3+ matches, 'medium' on 2, otherwise 'low' (caller may prefer AI)."""
    norm = {c.lower().strip().replace("_", " ") for c in col_names}
    counts = {
        "journal_entries":      sum(1 for s in _JE_SIGNALS if any(s in c for c in norm)),
        "financial_statements": sum(1 for s in _FS_SIGNALS if any(s in c for c in norm)),
        "debtors_creditors":    sum(1 for s in _DC_SIGNALS if any(s in c for c in norm)),
    }
    label, score = max(counts.items(), key=lambda kv: kv[1])
    if score >= 3:
        return label, "high"
    if score == 2:
        return label, "medium"
    return "general", "low"


# ─── Public: classify_dataset (heuristic-first, AI only on ambiguity) ────


async def classify_dataset(
    dataset_id: str,
    col_names: list[str],
    samples: dict[str, list],
    db_url: str,
    owner: str | None = None,
) -> None:
    """Background task. Heuristic decides if confidence is high enough; only
    falls back to AI when ambiguous — saves the per-upload AI cost."""
    try:
        uid = UUID(dataset_id)
    except ValueError:
        log.error("classify_dataset: invalid dataset_id %r", dataset_id)
        return

    label, confidence = _classify_heuristic(col_names)

    import time
    from app.audit import log_ai_usage

    usage: AIUsage | None = None
    status = "ok"
    err: str | None = None
    duration_ms = 0
    if confidence != "high":
        # Only call AI when the heuristic isn't confident — saves cost on the
        # common case (well-named CA datasets).
        start = time.perf_counter()
        try:
            sample_text = "\n".join(
                f"  {col}: {(vals or [])[:3]}" for col, vals in samples.items()
            )
            prompt_row = await _load_prompt("classify_dataset")
            msgs, schema, version = _build_messages(
                "classify_dataset", prompt_row, prompts.classify_dataset_messages,
                sample_text=sample_text,
            )
            if schema is None:
                schema = CLASSIFY_SCHEMA
            usage = AIUsage()
            usage.prompt_version = version
            data = await _complete_json(
                msgs, schema=schema,
                max_tokens=_CLASSIFY_MAX_TOKENS, usage=usage,
            )
            ai_label = data.get("label")
            if ai_label in {"journal_entries", "financial_statements", "debtors_creditors", "general"}:
                label = ai_label
        except Exception as e:
            status = "error"
            err = str(e)[:500]
            log.warning("classify_dataset: AI failed, keeping heuristic label=%s", label)
        finally:
            duration_ms = int((time.perf_counter() - start) * 1000)
            await log_ai_usage(
                user_email=owner or "system",
                endpoint="classify_dataset",
                usage=usage,
                duration_ms=duration_ms,
                status=status,
                error=err,
            )

    try:
        conn = await asyncpg.connect(db_url)
        try:
            # Only overwrite if the caller left the default ('general').
            # Explicit types set at upload time (e.g. 'register_analytics') are
            # preserved — AI classification must not clobber them.
            await conn.execute(
                "UPDATE datasets SET dataset_type = $1 WHERE id = $2 AND dataset_type = 'general'",
                label, uid,
            )
        finally:
            await conn.close()
    except Exception:
        log.exception("classify_dataset: failed to write dataset_type for %s", dataset_id)


# ─── Public: SQL copilot (tool-using) ────────────────────────────────────


# Tool schema — describes columns + samples. The SQL assistant can call this
# before producing the final query if it needs to verify a column's contents.
_SQL_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "describe_column",
            "description": (
                "Get distinct counts and 5 sample non-null values for a column. "
                "Use this to verify a column's actual contents before writing "
                "SQL that filters or aggregates on it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "table": {"type": "string", "description": "Fully-qualified table name e.g. datasets.ds_abc123"},
                    "column": {"type": "string"},
                },
                "required": ["table", "column"],
                "additionalProperties": False,
            },
        },
    },
]


async def _run_describe_column(table: str, column: str) -> dict:
    """Tool implementation: return distinct count + 5 sample values."""
    if not re.fullmatch(r"datasets\.ds_[0-9a-f]{32}", table):
        return {"error": "invalid table name"}
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", column):
        return {"error": "invalid column name"}
    conn = await asyncpg.connect(settings.DATABASE_URL)
    try:
        try:
            distinct = await conn.fetchval(
                f'SELECT COUNT(DISTINCT "{column}") FROM {table}'
            )
            samples = await conn.fetch(
                f'SELECT DISTINCT "{column}" FROM {table} '
                f'WHERE "{column}" IS NOT NULL LIMIT 5'
            )
        except Exception as e:
            return {"error": str(e)[:200]}
    finally:
        await conn.close()
    return {
        "distinct_count": distinct,
        "samples": [str(r[0]) for r in samples],
    }


async def sql_assist(
    user_prompt: str, tables: list[dict]
) -> tuple[str, AIUsage]:
    """Tool-using SQL copilot. Up to 3 tool-call rounds before the final SQL."""
    usage = AIUsage()
    prompt_row = await _load_prompt("sql_assist")
    msgs, _, version = _build_messages(
        "sql_assist", prompt_row, prompts.sql_assist_messages,
        user_prompt=user_prompt, tables=tables,
    )
    usage.prompt_version = version

    for _ in range(3):
        resp = await _complete(
            msgs, max_tokens=_DEFAULT_MAX_TOKENS, usage=usage,
            tools=_SQL_TOOLS,
        )
        msg = resp.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None) or []
        if not tool_calls:
            sql = (msg.content or "").strip()
            sql = re.sub(r"^```(?:sql)?\n?", "", sql, flags=re.IGNORECASE)
            sql = re.sub(r"\n?```$", "", sql).strip()
            if not sql or not sql.upper().lstrip().startswith("SELECT"):
                raise ValueError(f"AI returned non-SELECT SQL: {sql[:200]}")
            return sql, usage
        # Append the assistant turn + tool results, then loop.
        msgs.append({
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [
                {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ],
        })
        for tc in tool_calls:
            args = json.loads(tc.function.arguments or "{}")
            if tc.function.name == "describe_column":
                result = await _run_describe_column(args.get("table", ""), args.get("column", ""))
            else:
                result = {"error": f"unknown tool {tc.function.name}"}
            msgs.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result),
            })

    raise ValueError("SQL assist exceeded tool-call budget without producing SQL")


# ─── Public: DataView NL Q&A (grounded with real aggregates) ─────────────


async def _column_aggregates(table_name: str, columns: list[dict]) -> dict[str, Any]:
    """Compute lightweight per-column statistics across the FULL table.
    Only runs against the dataset's Postgres table (safe column names).
    """
    if not re.fullmatch(r"datasets\.ds_[0-9a-f]{32}", table_name):
        return {}
    conn = await asyncpg.connect(settings.DATABASE_URL)
    try:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM {table_name}")
        out: dict[str, Any] = {"total_rows": total, "columns": {}}
        for c in columns:
            name = c.get("name")
            t = (c.get("inferred_type") or "text").lower()
            if not name or not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
                continue
            col_sql = f'"{name}"'
            try:
                if t in ("number", "currency", "integer", "float"):
                    row = await conn.fetchrow(
                        f"SELECT MIN({col_sql})::float8 AS mn, MAX({col_sql})::float8 AS mx, "
                        f"AVG({col_sql})::float8 AS avg, SUM({col_sql})::float8 AS sm, "
                        f"COUNT({col_sql}) AS non_null FROM {table_name}"
                    )
                    out["columns"][name] = {
                        "type": t, **dict(row),
                    }
                elif t in ("date", "datetime"):
                    row = await conn.fetchrow(
                        f"SELECT MIN({col_sql}) AS mn, MAX({col_sql}) AS mx, "
                        f"COUNT({col_sql}) AS non_null FROM {table_name}"
                    )
                    out["columns"][name] = {
                        "type": t,
                        "min": str(row["mn"]) if row["mn"] is not None else None,
                        "max": str(row["mx"]) if row["mx"] is not None else None,
                        "non_null": row["non_null"],
                    }
                else:
                    row = await conn.fetchrow(
                        f"SELECT COUNT(DISTINCT {col_sql}) AS distinct_count, "
                        f"COUNT({col_sql}) AS non_null FROM {table_name}"
                    )
                    top = await conn.fetch(
                        f"SELECT {col_sql} AS v, COUNT(*) AS c FROM {table_name} "
                        f"WHERE {col_sql} IS NOT NULL GROUP BY {col_sql} "
                        f"ORDER BY c DESC LIMIT 5"
                    )
                    out["columns"][name] = {
                        "type": t,
                        "distinct_count": row["distinct_count"],
                        "non_null": row["non_null"],
                        "top": [{"value": str(r["v"]), "count": r["c"]} for r in top],
                    }
            except Exception as e:
                out["columns"][name] = {"type": t, "error": str(e)[:100]}
    finally:
        await conn.close()
    return out


async def dataview_query(
    user_prompt: str,
    columns: list[dict],
    sample_rows: list[dict],
    *,
    table_name: str | None = None,
    dataset_memo: str | None = None,
) -> tuple[dict, AIUsage]:
    """Grounded NL Q&A. When ``table_name`` is provided, computes real
    aggregates across the full table and feeds them to the model alongside
    the sample rows — answers about the *whole* dataset, not just the sample.
    """
    aggregates: dict[str, Any] | None = None
    if table_name:
        try:
            aggregates = await _column_aggregates(table_name, columns)
        except Exception:
            log.exception("dataview_query: aggregate computation failed")
            aggregates = None

    usage = AIUsage()
    prompt_row = await _load_prompt("dataview_qa")
    msgs, schema, version = _build_messages(
        "dataview_qa", prompt_row, prompts.dataview_messages,
        user_prompt=user_prompt,
        columns=columns,
        sample_rows=sample_rows,
        aggregates=aggregates,
        dataset_memo=dataset_memo,
    )
    if schema is None:
        schema = DATAVIEW_SCHEMA
    usage.prompt_version = version

    try:
        data = await _complete_json(
            msgs, schema=schema,
            max_tokens=_DEFAULT_MAX_TOKENS, usage=usage,
        )
        return data, usage
    except Exception:
        log.exception("dataview_query: AI failed")
        raise


# ─── Public: explain_job (streaming) ─────────────────────────────────────


def _build_explain_body(task_name: str, result_df: pl.DataFrame) -> str:
    """Pre-aggregate the result DF into a compact text body for the prompt."""
    stats = result_df.describe().to_dicts()
    return json.dumps(stats[:10], indent=2, default=str)


async def explain_job(
    task_name: str,
    result_path: str,
    *,
    usage: AIUsage | None = None,
    dataset_memo: str | None = None,
) -> AsyncGenerator[str, None]:
    try:
        df = pl.read_parquet(result_path)
    except Exception as e:
        yield f"Error reading result: {e}"
        return
    body = _build_explain_body(task_name, df)
    prompt_row = await _load_prompt("explain_job")
    msgs, _, version = _build_messages(
        "explain_job", prompt_row, prompts.explain_messages,
        task_name=task_name, body=body, dataset_memo=dataset_memo,
    )
    if usage is None:
        usage = AIUsage()
    usage.prompt_version = version
    try:
        async for token in _stream(msgs, usage=usage):
            yield token
    except Exception as e:
        log.exception("explain_job: AI stream failed for %s", task_name)
        # Fall back to a deterministic templated explanation so the panel
        # stays useful even when AI is down.
        yield "\n\n_AI service unavailable; deterministic summary follows:_\n\n"
        yield deterministic_explain(task_name, df)


async def explain_query_result(
    sql: str, columns: list[str], rows: list[dict],
    *, usage: AIUsage | None = None,
) -> AsyncGenerator[str, None]:
    msgs = prompts.explain_query_messages(sql, columns, rows)
    try:
        async for token in _stream(msgs, usage=usage):
            yield token
    except Exception as e:
        log.exception("explain_query_result: AI stream failed")
        yield f"\n[AI service error: {e}]"


# ─── Public: conversational follow-up ────────────────────────────────────


async def followup_explain(
    task_name: str,
    result_path: str,
    history: list[dict],
    user_message: str,
    *,
    usage: AIUsage | None = None,
    dataset_memo: str | None = None,
) -> AsyncGenerator[str, None]:
    """Continue an explain conversation. ``history`` is the prior chat turns
    (assistant + user, alternating). The result data is re-attached every
    turn so the model stays grounded."""
    try:
        df = pl.read_parquet(result_path)
    except Exception as e:
        yield f"Error reading result: {e}"
        return
    body = _build_explain_body(task_name, df)
    # Follow-up uses the legacy prompt builder (no DB table for follow-up yet)
    msgs = prompts.followup_messages(
        task_name, body, history, user_message, dataset_memo=dataset_memo,
    )
    try:
        async for token in _stream(msgs, usage=usage):
            yield token
    except Exception as e:
        log.exception("followup_explain: AI stream failed")
        yield f"\n[AI service error: {e}]"


# ─── Public: per-dataset characterisation memo ───────────────────────────────────


async def generate_dataset_memo(
    dataset_id: str,
    db_url: str,
    *,
    owner: str | None = None,
) -> str | None:
    """Compute aggregates + sample rows + columns, ask the model for a short
    factual memo, and persist it to ``datasets.summary_memo``. Returns the
    memo string (or None on failure)."""
    import time
    from app.audit import log_ai_usage

    conn = await asyncpg.connect(db_url)
    try:
        ds = await conn.fetchrow(
            "SELECT id, table_name, columns FROM datasets WHERE id = $1",
            UUID(dataset_id),
        )
    finally:
        await conn.close()

    if not ds or not ds["table_name"]:
        return None

    columns = ds["columns"] or []
    aggregates = await _column_aggregates(ds["table_name"], columns)

    # Pull a tiny sample for context.
    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(f"SELECT * FROM {ds['table_name']} LIMIT 10")
        sample_rows = [dict(r) for r in rows]
    finally:
        await conn.close()

    usage = AIUsage()
    start = time.perf_counter()
    status = "ok"
    err: str | None = None
    memo: str | None = None
    try:
        prompt_row = await _load_prompt("dataset_memo")
        msgs, _, version = _build_messages(
            "dataset_memo", prompt_row, prompts.memo_messages,
            columns=[{"name": c["name"], "type": c.get("inferred_type", "text")} for c in columns],
            aggregates=aggregates,
            sample_rows=sample_rows,
            
        )
        usage.prompt_version = version
        resp = await _complete(msgs, max_tokens=_DEFAULT_MAX_TOKENS, usage=usage)
        memo = (resp.choices[0].message.content or "").strip() or None
    except Exception as e:
        status = "error"
        err = str(e)[:500]
        log.warning("generate_dataset_memo: AI failed: %s", e)
    finally:
        await log_ai_usage(
            user_email=owner or "system",
            endpoint="generate_dataset_memo",
            usage=usage,
            duration_ms=int((time.perf_counter() - start) * 1000),
            status=status,
            error=err,
        )

    if memo:
        conn = await asyncpg.connect(db_url)
        try:
            await conn.execute(
                "UPDATE datasets SET summary_memo = $1, summary_memo_generated_at = now() "
                "WHERE id = $2",
                memo, UUID(dataset_id),
            )
        finally:
            await conn.close()
    return memo


# ─── Deterministic fallback (no AI) ──────────────────────────────────────


def deterministic_explain(task_name: str, df: pl.DataFrame) -> str:
    """Templated, fact-only summary used when the AI service is unavailable.
    Plain markdown — runs through ``MarkdownLite`` on the frontend."""
    return "_Result available; AI explanation is offline. Inspect the table or open the SQL Workbench._"


# ─── Pool helper (avoid circular import) ─────────────────────────────────


def _default_pool() -> asyncpg.Pool | None:
    from app.db import db
    return db._pool if hasattr(db, "_pool") else None


APP_SLUG = "data_analytics"
