"""SQL Workbench — table browser, schema, query, saved queries."""
import time
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from app.audit import log_query
from app.db import get_db_pool
from app.deps import _validate_table_name, get_current_user, get_user_conn, rls_conn

router = APIRouter()


@router.get("/workbench/tables", response_model=list)
async def workbench_tables(rls: tuple = Depends(get_user_conn)):
    """List dataset tables visible to the current user (RLS enforced)."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            """
            SELECT d.id, d.original_filename, d.file_type,
                   d.table_name, d.row_count, d.columns, d.created_at
            FROM datasets d
            WHERE d.table_name IS NOT NULL
            ORDER BY d.created_at DESC
            """
        )
    return [dict(r) for r in rows]


@router.get("/workbench/schema/{table_name:path}", response_model=list)
async def workbench_schema(
    table_name: str,
    rls: tuple = Depends(get_user_conn),
):
    """Return column names and types for a dataset table."""
    _validate_table_name(table_name)

    rls_pool, owner = rls
    schema, tbl = table_name.split(".", 1)
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            """,
            schema,
            tbl,
        )
    if not rows:
        raise HTTPException(status_code=404, detail="Table not found")
    return [dict(r) for r in rows]


@router.post("/workbench/query", response_model=dict)
async def workbench_query(
    request: Request,
    sql: str = Body(..., embed=True),
    rls: tuple = Depends(get_user_conn),
):
    """
    Execute a SQL query against the datasets schema.
    Only SELECT statements are permitted. Every invocation (success or
    failure) is recorded in ``audit_log``.
    """
    sql_stripped = sql.strip().rstrip(";")
    rls_pool, owner = rls
    ip = request.client.host if request.client else None

    if not sql_stripped.upper().startswith("SELECT"):
        await log_query(
            user_email=owner, action="workbench_query",
            sql_text=sql_stripped[:10000], row_count=None, duration_ms=0,
            status="error", error="non-SELECT rejected", ip_addr=ip,
        )
        raise HTTPException(
            status_code=400,
            detail="Only SELECT statements are allowed in the workbench",
        )

    start = time.perf_counter()
    status_str = "ok"
    err: str | None = None
    row_count: int | None = None
    try:
        async with rls_conn(rls_pool, owner) as conn:
            rows = await conn.fetch(sql_stripped)

        if not rows:
            row_count = 0
            return {"columns": [], "data": [], "row_count": 0}

        columns = list(rows[0].keys())
        data = [dict(r) for r in rows]
        row_count = len(data)
        return {"columns": columns, "data": data, "row_count": row_count}
    except asyncpg.PostgresError as e:
        status_str = "error"
        err = str(e)[:500]
        raise HTTPException(status_code=400, detail=f"Query error: {e}")
    finally:
        await log_query(
            user_email=owner, action="workbench_query",
            sql_text=sql_stripped[:10000], row_count=row_count,
            duration_ms=int((time.perf_counter() - start) * 1000),
            status=status_str, error=err, ip_addr=ip,
        )


# ─── Saved queries ──────────────────────────────────────────────────────────


@router.post(
    "/workbench/queries",
    response_model=dict,
    dependencies=[Depends(get_current_user)],
)
async def save_query(
    name: str = Body(..., embed=True),
    sql: str = Body(..., embed=True),
    description: str = Body("", embed=True),
    client_id: str | None = Body(None, embed=True),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO saved_queries (client_id, name, description, sql)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, description, sql, created_at
            """,
            UUID(client_id) if client_id else None,
            name,
            description,
            sql,
        )
    return dict(row)


@router.get(
    "/workbench/queries",
    response_model=list,
    dependencies=[Depends(get_current_user)],
)
async def list_saved_queries(
    client_id: str | None = None,
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """If client_id is supplied, scope to that client; otherwise return every
    saved query for the current user (covers the legacy seed-UUID rows after
    the Phase 1 cutover)."""
    async with pool.acquire() as conn:
        if client_id:
            rows = await conn.fetch(
                """
                SELECT id, name, description, sql, created_at
                  FROM saved_queries
                 WHERE client_id = $1
                 ORDER BY created_at DESC
                """,
                UUID(client_id),
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, name, description, sql, created_at
                  FROM saved_queries
                 ORDER BY created_at DESC
                """
            )
    return [dict(r) for r in rows]


@router.delete(
    "/workbench/queries/{query_id}", dependencies=[Depends(get_current_user)]
)
async def delete_saved_query(
    query_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM saved_queries WHERE id = $1", query_id)
    return {"deleted": str(query_id)}
