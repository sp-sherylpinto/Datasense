"""FastAPI application shell.

Concrete endpoints live in `app/routers/*.py`. This file wires those routers
into a single `FastAPI` instance, manages the lifecycle (DB pool open/close),
and serves the React SPA. Keep it slim — 1500-line god-modules made the
contract bugs of April 2026 hard to find.
"""
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.db import db
from app.deps import close_rls_pool
from app.logging_config import configure_logging, set_correlation_id
from app.routers import filters
from app.routers import (
    ai,
    audit,
    clients,
    dashboard,
    datasets,
    health,
    filters, 
    jobs,
    saved_views,
    uploads,
    workbench,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(os.getenv("LOG_LEVEL", "INFO"))
    await db.connect()
    yield
    await db.disconnect()
    await close_rls_pool()


app = FastAPI(title="Analytics API", lifespan=lifespan)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    """Inject X-Correlation-ID into request state and response headers.
    Propagates into logging context so every log line for this request
    carries the same ID."""
    cid = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())[:12]
    set_correlation_id(cid)
    request.state.correlation_id = cid
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = cid
    return response

# Order matters only for the SPA catch-all (mounted last)
app.include_router(health.router)
app.include_router(uploads.router)
app.include_router(datasets.router)
app.include_router(workbench.router)
app.include_router(clients.router)
app.include_router(jobs.router)
app.include_router(ai.router)
app.include_router(dashboard.router)
app.include_router(audit.router)
app.include_router(saved_views.router)
app.include_router(filters.router)


# ──────────────────────────────────────────────
# /core/* — passthrough to varma-core (read-only)
# Same Postgres instance, analytics_app inherits core_reader (Phase 0).
# Lives here so the SPA can populate engagement/partner/client pickers via
# same-origin requests instead of cross-origin to core.varma.ai.
# ──────────────────────────────────────────────

import asyncpg
from fastapi import Depends, Query
from app.db import get_db_pool
from app.deps import get_current_user
from uuid import UUID


@app.get("/core/engagements", response_model=list)
async def core_engagements(
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
    status: str | None = Query(default=None),
):
    """Reads core.v_engagements_full — joined view (engagement + client + lead-partner names)."""
    sql = """
        SELECT engagement_id, engagement_code, engagement_name, engagement_type,
               vertical::text AS vertical, framework::text AS framework,
               period_start, period_end, status,
               client_id, client_code, client_name, client_display_name,
               lead_partner_email, lead_partner_name
          FROM core.v_engagements_full
    """
    args: list = []
    if status:
        sql += " WHERE status::text = $1"
        args.append(status)
    sql += " ORDER BY period_end DESC, engagement_name"
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [dict(r) for r in rows]


@app.get("/core/engagements/{engagement_id}", response_model=dict)
async def core_engagement(
    engagement_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT engagement_id, engagement_code, engagement_name, engagement_type,
                   vertical::text AS vertical, framework::text AS framework,
                   period_start, period_end, status,
                   client_id, client_code, client_name, client_display_name,
                   lead_partner_email, lead_partner_name,
                   materiality_planning, materiality_performance
              FROM core.v_engagements_full
             WHERE engagement_id = $1
            """,
            engagement_id,
        )
    return dict(row) if row else {"error": "not found"}


@app.get("/core/partners", response_model=list)
async def core_partners(
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, email, display_name, icai_membership_no FROM core.v_partners ORDER BY display_name"
        )
    return [dict(r) for r in rows]


@app.get("/core/clients", response_model=list)
async def core_clients(
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, code, legal_name, display_name, entity_type,
                   gstin, pan, status
              FROM core.clients
             WHERE status = 'active'
             ORDER BY legal_name
            """
        )
    return [dict(r) for r in rows]


@app.get("/core/audit-areas", response_model=list)
async def core_audit_areas(
    pool: asyncpg.Pool = Depends(get_db_pool),
    user: str = Depends(get_current_user),
):
    """Firm audit-area enum, scoped per (vertical, category). Cached
    client-side; the SPA filters by the active engagement's vertical."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, vertical::text AS vertical, code, title, category, display_order
              FROM core.audit_areas
             WHERE active
             ORDER BY vertical, display_order
            """
        )
    return [dict(r) for r in rows]


# ──────────────────────────────────────────────
# Serve React SPA (must be last so explicit API routes win)
# ──────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")

if os.path.isdir(STATIC_DIR):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(STATIC_DIR, "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
