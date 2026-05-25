"""Dashboard / pinned-charts CRUD."""
import json
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException

from app.db import get_db_pool
from app.deps import get_user_conn, rls_conn

router = APIRouter()


@router.get("/dashboard/pins", response_model=list)
async def list_pins(rls: tuple = Depends(get_user_conn)):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            """
            SELECT id, job_id, title, chart_type, config_json, position, created_at
            FROM pinned_charts
            ORDER BY position ASC, created_at ASC
            """
        )
    return [dict(r) for r in rows]


@router.post("/dashboard/pins", response_model=dict)
async def create_pin(
    job_id: str = Body(..., embed=True),
    title: str = Body(..., embed=True),
    chart_type: str = Body(..., embed=True),
    config_json: dict = Body({}, embed=True),
    rls: tuple = Depends(get_user_conn),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    valid_chart_types = {"bar", "line", "area", "scatter"}
    if chart_type not in valid_chart_types:
        raise HTTPException(
            status_code=400,
            detail=f"chart_type must be one of {valid_chart_types}",
        )

    rls_pool, owner = rls
    async with pool.acquire() as conn:
        job = await conn.fetchrow(
            "SELECT owner FROM jobs WHERE id = $1", UUID(job_id)
        )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["owner"] != owner:
        raise HTTPException(
            status_code=403, detail="You can only pin your own jobs"
        )

    async with rls_conn(rls_pool, owner) as conn:
        max_pos = (
            await conn.fetchval(
                "SELECT COALESCE(MAX(position), -1) FROM pinned_charts"
            )
            or -1
        )
        row = await conn.fetchrow(
            """
            INSERT INTO pinned_charts (owner, job_id, title, chart_type, config_json, position)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, job_id, title, chart_type, config_json, position, created_at
            """,
            owner,
            UUID(job_id),
            title,
            chart_type,
            json.dumps(config_json),
            max_pos + 1,
        )
    return dict(row)


@router.patch("/dashboard/pins/{pin_id}", response_model=dict)
async def update_pin(
    pin_id: UUID,
    title: str | None = Body(None, embed=True),
    position: int | None = Body(None, embed=True),
    rls: tuple = Depends(get_user_conn),
):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        row = await conn.fetchrow(
            "SELECT id, owner, job_id, title, chart_type, config_json, position FROM pinned_charts WHERE id = $1",
            pin_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Pin not found")
        if row["owner"] != owner:
            raise HTTPException(
                status_code=403, detail="Only the pin owner can update it"
            )
        if title is not None:
            await conn.execute(
                "UPDATE pinned_charts SET title = $1 WHERE id = $2",
                title, pin_id,
            )
        if position is not None:
            await conn.execute(
                "UPDATE pinned_charts SET position = $1 WHERE id = $2",
                position, pin_id,
            )
        row = await conn.fetchrow(
            "SELECT id, job_id, title, chart_type, config_json, position FROM pinned_charts WHERE id = $1",
            pin_id,
        )
    return dict(row)


@router.delete("/dashboard/pins/{pin_id}")
async def delete_pin(pin_id: UUID, rls: tuple = Depends(get_user_conn)):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        pin = await conn.fetchrow(
            "SELECT owner FROM pinned_charts WHERE id = $1", pin_id
        )
        if not pin:
            raise HTTPException(status_code=404, detail="Pin not found")
        if pin["owner"] != owner:
            raise HTTPException(
                status_code=403, detail="Only the pin owner can delete it"
            )
        await conn.execute("DELETE FROM pinned_charts WHERE id = $1", pin_id)
    return {"deleted": str(pin_id)}
