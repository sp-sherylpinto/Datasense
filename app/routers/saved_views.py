"""Saved Views — named filtered slices over a dataset.

A View is metadata only: filter spec + sort + selected columns + audit-area
tag. Clients build the SQL from this spec at query time. The server's job
is CRUD + RLS, not query execution.
"""
import json
import logging
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from app.deps import get_user_conn, rls_conn
from app.db import get_db_pool

logger = logging.getLogger(__name__)
router = APIRouter()


def _decode_view_row(row: Any) -> dict:
    """Coerce JSONB columns from string to dict/list. asyncpg's per-pool
    codec doesn't always survive the RLS pool init path — be explicit."""
    d = dict(row)
    for key in ("filters", "sort", "columns"):
        v = d.get(key)
        if isinstance(v, str):
            try:
                d[key] = json.loads(v)
            except json.JSONDecodeError:
                pass
    if d.get("filters") is None:
        d["filters"] = []
    return d


# ─── Filter-spec validation ──────────────────────────────────────────────────
# Keep the operator vocabulary in one place so the SQL builder (frontend)
# and the API surface agree.

_VALID_OPS = {
    "contains", "not_contains",
    "equals", "not_equals",
    "regex",
    "gt", "gte", "lt", "lte",
    "between",
    "is_empty", "is_not_empty",
}

_OPS_NEED_VALUE = {
    "contains", "not_contains", "equals", "not_equals", "regex",
    "gt", "gte", "lt", "lte", "between",
}

_OPS_NEED_VALUE2 = {"between"}


def _validate_filters(filters: Any) -> list[dict]:
    """Validate the filter spec; raise 400 on anything malformed."""
    if filters is None:
        return []
    if not isinstance(filters, list):
        raise HTTPException(status_code=400, detail="filters must be a list")

    out: list[dict] = []
    for i, f in enumerate(filters):
        if not isinstance(f, dict):
            raise HTTPException(status_code=400, detail=f"filter #{i} is not an object")
        col = f.get("column")
        op = f.get("op")
        if not isinstance(col, str) or not col:
            raise HTTPException(status_code=400, detail=f"filter #{i} missing 'column'")
        if op not in _VALID_OPS:
            raise HTTPException(status_code=400, detail=f"filter #{i} has invalid op '{op}'")
        clean: dict = {"column": col, "op": op}
        if op in _OPS_NEED_VALUE:
            v = f.get("value")
            if v is None or v == "":
                raise HTTPException(
                    status_code=400, detail=f"filter #{i} ({op}) requires a value"
                )
            clean["value"] = str(v)
        if op in _OPS_NEED_VALUE2:
            v2 = f.get("value2")
            if v2 is None or v2 == "":
                raise HTTPException(
                    status_code=400, detail=f"filter #{i} ({op}) requires value2"
                )
            clean["value2"] = str(v2)
        out.append(clean)
    return out


def _validate_sort(sort: Any) -> dict | None:
    if sort is None:
        return None
    if not isinstance(sort, dict):
        raise HTTPException(status_code=400, detail="sort must be an object")
    col = sort.get("column")
    direction = sort.get("direction", "asc")
    if not isinstance(col, str) or not col:
        raise HTTPException(status_code=400, detail="sort.column missing")
    if direction not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="sort.direction must be 'asc' or 'desc'")
    return {"column": col, "direction": direction}


def _validate_columns(cols: Any) -> list[str] | None:
    if cols is None:
        return None
    if not isinstance(cols, list) or not all(isinstance(c, str) for c in cols):
        raise HTTPException(status_code=400, detail="columns must be a list of strings")
    return cols


def _validate_area_code(code: str | None) -> str | None:
    if code is None or code == "":
        return None
    if not isinstance(code, str) or ":" not in code or len(code) > 100:
        raise HTTPException(
            status_code=400,
            detail="audit_area_code must look like 'vertical:code' (e.g. 'general:F-PPE')",
        )
    return code


# ─── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/views", response_model=list)
async def list_all_views(
    rls: tuple = Depends(get_user_conn),
):
    """All views saved by the current user across all datasets."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            """
            SELECT sv.id, sv.dataset_id, sv.name, sv.description,
                   sv.audit_area_code, sv.view_type, sv.filters,
                   sv.sort, sv.columns, sv.owner,
                   sv.created_at, sv.updated_at,
                   d.original_filename AS dataset_name
              FROM saved_views sv
              LEFT JOIN datasets d ON d.id = sv.dataset_id
             WHERE sv.owner = $1
             ORDER BY sv.updated_at DESC
            """,
            owner,
        )
    return [_decode_view_row(dict(r)) for r in rows]


@router.get("/datasets/{dataset_id}/views", response_model=list)
async def list_views(
    dataset_id: UUID,
    rls: tuple = Depends(get_user_conn),
):
    """All views visible to the current user for a given dataset.

    RLS does the filtering: own views + views by engagement-team members
    on the same dataset's engagement.
    """
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            """
            SELECT id, dataset_id, name, description, audit_area_code,
                   view_type, filters, sort, columns, owner,
                   created_at, updated_at
              FROM saved_views
             WHERE dataset_id = $1
             ORDER BY updated_at DESC
            """,
            dataset_id,
        )
    return [_decode_view_row(r) for r in rows]


@router.post("/datasets/{dataset_id}/views", response_model=dict, status_code=201)
async def create_view(
    dataset_id: UUID,
    name: str = Body(..., embed=True),
    description: str | None = Body(default=None, embed=True),
    audit_area_code: str | None = Body(default=None, embed=True),
    filters: Any = Body(default=None, embed=True),
    sort: Any = Body(default=None, embed=True),
    columns: Any = Body(default=None, embed=True),
    rls: tuple = Depends(get_user_conn),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    if not name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    if len(name) > 255:
        raise HTTPException(status_code=400, detail="name too long (max 255)")

    clean_filters = _validate_filters(filters)
    clean_sort = _validate_sort(sort)
    clean_cols = _validate_columns(columns)
    clean_area = _validate_area_code(audit_area_code)

    # Use admin pool (not RLS) to verify dataset exists —
    # merged datasets may not be visible through the restricted RLS role.
    async with pool.acquire() as admin_conn:
        ds = await admin_conn.fetchrow(
            "SELECT id FROM datasets WHERE id = $1", dataset_id
        )
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO saved_views
                    (dataset_id, name, description, audit_area_code,
                     filters, sort, columns, owner)
                VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
                RETURNING id, dataset_id, name, description, audit_area_code,
                          view_type, filters, sort, columns, owner,
                          created_at, updated_at
                """,
                dataset_id,
                name.strip(),
                description.strip() if description else None,
                clean_area,
                json.dumps(clean_filters),
                json.dumps(clean_sort) if clean_sort else None,
                json.dumps(clean_cols) if clean_cols is not None else None,
                owner,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            if "audit_area" in str(exc).lower():
                raise HTTPException(status_code=400, detail="Unknown audit_area_code")
            raise
        except Exception as exc:
            logger.error("Failed to insert saved_view: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to save view: {exc}")
    return _decode_view_row(row)


@router.get("/views/{view_id}", response_model=dict)
async def get_view(
    view_id: UUID,
    rls: tuple = Depends(get_user_conn),
):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        row = await conn.fetchrow(
            """
            SELECT id, dataset_id, name, description, audit_area_code,
                   view_type, filters, sort, columns, owner,
                   created_at, updated_at
              FROM saved_views
             WHERE id = $1
            """,
            view_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="View not found")
    return _decode_view_row(row)


@router.patch("/views/{view_id}", response_model=dict)
async def update_view(
    view_id: UUID,
    request: Request,
    rls: tuple = Depends(get_user_conn),
):
    """PATCH semantics: a field is updated iff its key is present in the
    request body. `null` is a valid value (e.g. clear `columns` back to
    "show all"); FastAPI's default Body(default=None) can't distinguish
    that from "absent", so we read the raw JSON body."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    sets: list[str] = []
    args: list = []

    if "name" in body:
        name = body["name"]
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(status_code=400, detail="name cannot be empty")
        if len(name) > 255:
            raise HTTPException(status_code=400, detail="name too long (max 255)")
        args.append(name.strip())
        sets.append(f"name = ${len(args)}")
    if "description" in body:
        d = body["description"]
        args.append(d.strip() if isinstance(d, str) and d.strip() else None)
        sets.append(f"description = ${len(args)}")
    if "audit_area_code" in body:
        args.append(_validate_area_code(body["audit_area_code"]))
        sets.append(f"audit_area_code = ${len(args)}")
    if "filters" in body:
        args.append(json.dumps(_validate_filters(body["filters"])))
        sets.append(f"filters = ${len(args)}::jsonb")
    if "sort" in body:
        sort_val = _validate_sort(body["sort"])
        args.append(json.dumps(sort_val) if sort_val else None)
        sets.append(f"sort = ${len(args)}::jsonb")
    if "columns" in body:
        cols_val = _validate_columns(body["columns"])
        args.append(json.dumps(cols_val) if cols_val is not None else None)
        sets.append(f"columns = ${len(args)}::jsonb")

    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")

    args.append(view_id)
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        try:
            row = await conn.fetchrow(
                f"UPDATE saved_views SET {', '.join(sets)} "
                f"WHERE id = ${len(args)} "
                "RETURNING id, dataset_id, name, description, audit_area_code, "
                "view_type, filters, sort, columns, owner, created_at, updated_at",
                *args,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            if "audit_area" in str(exc).lower():
                raise HTTPException(status_code=400, detail="Unknown audit_area_code")
            raise
    if not row:
        raise HTTPException(
            status_code=404, detail="View not found or not owned by you"
        )
    return _decode_view_row(row)


@router.delete("/views/{view_id}", status_code=204)
async def delete_view(
    view_id: UUID,
    rls: tuple = Depends(get_user_conn),
):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        result = await conn.execute(
            "DELETE FROM saved_views WHERE id = $1", view_id
        )
    if result == "DELETE 0":
        raise HTTPException(
            status_code=404, detail="View not found or not owned by you"
        )


# ─── Sample-rows: cross-app handoff to VouchPaper ────────────────────
#
# Returns N rows from the underlying dataset, with the view's filters /
# sort / column projection applied. Used by VouchPaper's "Pull sample
# from DataSense" import path so a workpaper can be seeded from a
# saved-view selection. Always LIMIT-bounded; never returns the whole
# dataset.

import re as _re

_SAFE_COL_RE = _re.compile(r"^[A-Za-z_][A-Za-z0-9_ ]*$")


def _safe_col(col: str) -> str:
    if not _SAFE_COL_RE.match(col or ""):
        raise HTTPException(status_code=400, detail=f"Invalid column name: {col!r}")
    return f'"{col}"'


def _build_filter_sql(filters: list[dict], start_idx: int) -> tuple[str, list]:
    """Translate the validated filter spec into a parameterised SQL WHERE.

    Returns (where_clause_or_empty_string, params_list). Param indices
    start at $start_idx so they slot after any preceding placeholders.
    """
    clauses: list[str] = []
    params: list = []
    idx = start_idx
    for f in filters or []:
        col = _safe_col(f["column"])
        op = f["op"]
        if op == "contains":
            clauses.append(f"{col}::text ILIKE ${idx}"); params.append(f"%{f['value']}%"); idx += 1
        elif op == "not_contains":
            clauses.append(f"{col}::text NOT ILIKE ${idx}"); params.append(f"%{f['value']}%"); idx += 1
        elif op == "equals":
            clauses.append(f"{col}::text = ${idx}"); params.append(str(f["value"])); idx += 1
        elif op == "not_equals":
            clauses.append(f"{col}::text <> ${idx}"); params.append(str(f["value"])); idx += 1
        elif op == "regex":
            clauses.append(f"{col}::text ~ ${idx}"); params.append(str(f["value"])); idx += 1
        elif op in ("gt", "gte", "lt", "lte"):
            sql_op = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            clauses.append(f"({col})::numeric {sql_op} ${idx}::numeric")
            params.append(str(f["value"])); idx += 1
        elif op == "between":
            clauses.append(f"({col})::numeric BETWEEN ${idx}::numeric AND ${idx+1}::numeric")
            params.append(str(f["value"])); params.append(str(f["value2"])); idx += 2
        elif op == "is_empty":
            clauses.append(f"({col} IS NULL OR {col}::text = '')")
        elif op == "is_not_empty":
            clauses.append(f"({col} IS NOT NULL AND {col}::text <> '')")
    return (" AND ".join(clauses), params)


@router.get("/views/{view_id}/sample-rows", response_model=dict)
async def view_sample_rows(
    view_id: UUID,
    n: int = 25,
    rls: tuple = Depends(get_user_conn),
):
    """Return the first N rows that match the view's filter / sort / column
    projection. N is clamped to [1, 500]."""
    n = max(1, min(int(n), 500))

    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        view = await conn.fetchrow(
            """
            SELECT v.id, v.dataset_id, v.name, v.audit_area_code,
                   v.filters, v.sort, v.columns,
                   d.table_name
              FROM saved_views v
              JOIN datasets d ON d.id = v.dataset_id
             WHERE v.id = $1
            """,
            view_id,
        )
        if not view:
            raise HTTPException(status_code=404, detail="View not found")

        v = _decode_view_row(view)
        table_name = view["table_name"]
        if not table_name:
            raise HTTPException(status_code=400, detail="View's dataset has no backing table")

        # Allow datasets.ds_<32hex> only; the schema-qualified table name
        # comes straight from the datasets row, but defence in depth.
        if not _re.match(r"^datasets\.ds_[a-f0-9]{32}$", table_name):
            raise HTTPException(status_code=400, detail=f"Invalid table_name: {table_name}")

        cols = v.get("columns") or []
        if cols and isinstance(cols, list):
            select_cols = ", ".join(_safe_col(c) for c in cols)
        else:
            select_cols = "*"

        where_sql, where_params = _build_filter_sql(v.get("filters") or [], start_idx=1)

        order_sql = ""
        sort = v.get("sort")
        if isinstance(sort, dict) and sort.get("column"):
            direction = "DESC" if str(sort.get("direction", "asc")).lower() == "desc" else "ASC"
            order_sql = f' ORDER BY {_safe_col(sort["column"])} {direction}'

        sql = f'SELECT {select_cols} FROM {table_name}'
        if where_sql:
            sql += f' WHERE {where_sql}'
        sql += order_sql
        sql += f' LIMIT {n}'

        try:
            rows = await conn.fetch(sql, *where_params)
        except asyncpg.PostgresError as e:
            raise HTTPException(status_code=400, detail=f"Sample query failed: {e}")

    return {
        "view_id":         str(view["id"]),
        "view_name":       view["name"],
        "dataset_id":      str(view["dataset_id"]),
        "audit_area_code": view["audit_area_code"],
        "row_count":       len(rows),
        "columns":         list(rows[0].keys()) if rows else (cols if isinstance(cols, list) else []),
        "rows":            [dict(r) for r in rows],
    }
