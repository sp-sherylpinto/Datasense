"""Auth identity probe + DB liveness check."""
import asyncpg
from fastapi import APIRouter, Depends, Header

from app.db import get_db_pool
from app.deps import get_current_user

router = APIRouter()


@router.get("/auth/me")
async def auth_me(
    user: str = Depends(get_current_user),
    x_authentik_name: str | None = Header(default=None, alias="X-authentik-name"),
):
    """Return the currently authenticated user identity."""
    return {"email": user, "name": x_authentik_name or user}


@router.get("/health")
async def health_check(pool: asyncpg.Pool = Depends(get_db_pool)):
    try:
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
