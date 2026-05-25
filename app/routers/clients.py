"""Clients + engagements — passthrough to varma-core.

DataSense does not own these any more (Phase 1 cutover, Apr 2026). The
shared `core` schema in the same Postgres instance is authoritative; this
router stays at /clients and /clients/{id}/engagements purely so existing
SPA wiring keeps working until the SPA migrates to /core/* directly.

Reads only. Client / engagement creation lives in the varma-core admin SPA.
"""
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.db import get_db_pool
from app.deps import get_current_user

router = APIRouter()


@router.get(
    "/clients", response_model=list, dependencies=[Depends(get_current_user)]
)
async def list_clients(pool: asyncpg.Pool = Depends(get_db_pool)):
    """Reads core.clients via the core_reader role inherited by analytics_app."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id,
                   legal_name        AS name,
                   code,
                   notes,
                   created_at
              FROM core.clients
             WHERE status = 'active'
             ORDER BY legal_name
            """
        )
    return [dict(r) for r in rows]


@router.get(
    "/clients/{client_id}/engagements",
    response_model=list,
    dependencies=[Depends(get_current_user)],
)
async def list_engagements_for_client(
    client_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id,
                   name,
                   period_start,
                   period_end,
                   status,
                   created_at
              FROM core.engagements
             WHERE client_id = $1
             ORDER BY period_end DESC, created_at DESC
            """,
            client_id,
        )
    return [dict(r) for r in rows]
