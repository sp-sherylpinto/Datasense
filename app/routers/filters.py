"""Filter template management — asyncpg only, no SQLAlchemy."""
from __future__ import annotations

import json
import logging
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.db import get_db_pool
from app.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["filters"])

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS filter_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner         TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    dataset_type  TEXT NOT NULL DEFAULT 'general',
    filters       JSONB NOT NULL DEFAULT '[]',
    sort_by       TEXT,
    sort_order    TEXT DEFAULT 'asc',
    view_columns  JSONB,
    filter_count  INT NOT NULL DEFAULT 0,
    usage_count   INT NOT NULL DEFAULT 0,
    last_used     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_table_ensured = False

async def ensure_table(pool: asyncpg.Pool) -> None:
    global _table_ensured
    if _table_ensured:
        return
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLE_SQL)
    _table_ensured = True

def _to_dict(row: asyncpg.Record) -> dict:
    d = dict(row)
    return {
        "id":          str(d["id"]),
        "name":        d["name"],
        "description": d.get("description"),
        "filters":     d.get("filters") or [],
        "sortBy":      d.get("sort_by"),
        "sortOrder":   d.get("sort_order"),
        "viewColumns": d.get("view_columns"),
        "datasetType": d.get("dataset_type"),
        "filterCount": d.get("filter_count", 0),
        "usageCount":  d.get("usage_count", 0),
        "lastUsed":    d["last_used"].isoformat() if d.get("last_used") else None,
        "createdAt":   d["created_at"].isoformat() if d.get("created_at") else None,
    }

@router.get("/filter-templates", response_model=list)
async def list_filters(
    dataset_type: str | None = Query(default=None),
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    await ensure_table(pool)
    async with pool.acquire() as conn:
        if dataset_type:
            rows = await conn.fetch(
                "SELECT * FROM filter_templates WHERE owner = $1 AND dataset_type = $2 ORDER BY last_used DESC NULLS LAST, created_at DESC",
                user, dataset_type,
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM filter_templates WHERE owner = $1 ORDER BY last_used DESC NULLS LAST, created_at DESC",
                user,
            )
    return [_to_dict(r) for r in rows]

@router.post("/filter-templates", response_model=dict, status_code=201)
async def create_filter(
    data: dict = Body(...),
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    await ensure_table(pool)
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    filters     = data.get("filters", [])
    sort_by     = data.get("sort_by") or data.get("sortBy")
    sort_order  = data.get("sort_order") or data.get("sortOrder") or "asc"
    view_cols   = data.get("view_columns") or data.get("viewColumns")
    ds_type     = data.get("dataset_type") or data.get("datasetType") or "general"
    description = data.get("description")
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT id FROM filter_templates WHERE owner = $1 AND name = $2", user, name,
        )
        if existing:
            raise HTTPException(status_code=400, detail="A filter with this name already exists")
        row = await conn.fetchrow(
            """INSERT INTO filter_templates
               (owner, name, description, dataset_type, filters, sort_by, sort_order, view_columns, filter_count)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9) RETURNING *""",
            user, name, description, ds_type,
            json.dumps(filters), sort_by, sort_order,
            json.dumps(view_cols) if view_cols is not None else None,
            len(filters) if isinstance(filters, list) else 0,
        )
    return _to_dict(row)

@router.delete("/filter-templates/{filter_id}", status_code=204)
async def delete_filter(
    filter_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    await ensure_table(pool)
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM filter_templates WHERE id = $1 AND owner = $2", filter_id, user,
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Filter not found")

@router.post("/filter-templates/{filter_id}/duplicate", response_model=dict, status_code=201)
async def duplicate_filter(
    filter_id: UUID,
    data: dict = Body(default={}),
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    await ensure_table(pool)
    async with pool.acquire() as conn:
        original = await conn.fetchrow(
            "SELECT * FROM filter_templates WHERE id = $1 AND owner = $2", filter_id, user,
        )
        if not original:
            raise HTTPException(status_code=404, detail="Filter not found")
        new_name = (data.get("newName") or f"{original['name']} (copy)").strip()
        row = await conn.fetchrow(
            """INSERT INTO filter_templates
               (owner, name, description, dataset_type, filters, sort_by, sort_order, view_columns, filter_count)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *""",
            user, new_name, original["description"], original["dataset_type"],
            original["filters"], original["sort_by"], original["sort_order"],
            original["view_columns"], original["filter_count"],
        )
    return _to_dict(row)

@router.get("/filter-suggestions", response_model=list)
async def filter_suggestions(
    dataset_id: str | None = Query(default=None),
    limit: int = Query(default=10),
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    await ensure_table(pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM filter_templates WHERE owner = $1 ORDER BY usage_count DESC, last_used DESC NULLS LAST LIMIT $2",
            user, limit,
        )
    return [_to_dict(r) for r in rows]
