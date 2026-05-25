"""Shared FastAPI dependencies + helpers used across routers.

Lives outside any individual router so each one stays small and focused.
"""
import re
from contextlib import asynccontextmanager

import asyncpg
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import APIKeyHeader

from app.config import settings


api_key_header = APIKeyHeader(name="X-API-Token", auto_error=False)


def _validate_table_name(name: str) -> str:
    """Validate that a table name matches the expected datasets.ds_<hex32> pattern."""
    if not re.fullmatch(r"datasets\.ds_[0-9a-f]{32}", name):
        raise HTTPException(status_code=400, detail="Invalid table name")
    return name


_rls_pool: asyncpg.Pool | None = None


async def get_rls_pool() -> asyncpg.Pool:
    """Connection pool using the analytics_app role (respects RLS)."""
    global _rls_pool
    if _rls_pool is None:
        rls_url = re.sub(
            r"postgresql://[^@]+@",
            f"postgresql://{settings.APP_DB_USER}:{settings.APP_DB_PASSWORD}@",
            settings.DATABASE_URL,
        )
        from app.db import _init_conn

        _rls_pool = await asyncpg.create_pool(
            rls_url, min_size=2, max_size=10, init=_init_conn
        )
    return _rls_pool


async def close_rls_pool() -> None:
    """Close the RLS pool — call on app shutdown."""
    global _rls_pool
    if _rls_pool:
        await _rls_pool.close()
        _rls_pool = None


async def get_current_user(
    x_authentik_email: str | None = Header(default=None, alias="X-authentik-email"),
    x_authentik_username: str | None = Header(default=None, alias="X-authentik-username"),
    x_api_token: str | None = Depends(api_key_header),
) -> str:
    """
    Identity resolution (in priority order):
    1. Authentik ForwardAuth injects X-authentik-email — use it.
    2. Valid API token — returns 'api' (programmatic / dev access).
    3. Neither present — 401.
    """
    if x_authentik_email:
        return x_authentik_email.lower().strip()
    if x_api_token and x_api_token.strip() == settings.auth_token:
        return "api"
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
    )


async def get_user_conn(
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_rls_pool),
) -> tuple[asyncpg.Pool, str]:
    """Return (rls_pool, user_email) — caller wraps ops in conn.transaction() + SET LOCAL."""
    return pool, user


@asynccontextmanager
async def rls_conn(rls_pool: asyncpg.Pool, owner: str):
    """Acquire a connection, start a transaction, and set the RLS identity.

    SET LOCAL only takes effect within a transaction block. Without this
    wrapper every conn.execute() runs in its own implicit auto-committed
    transaction, so the GUC reverts before subsequent statements run.
    """
    async with rls_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('app.active_user', $1, true)", owner
            )
            yield conn


async def verify_token(
    token: str | None = Depends(api_key_header),
    email: str | None = Header(default=None, alias="X-authentik-email"),
) -> str:
    """Backwards-compat alias kept so existing endpoints that use verify_token still work."""
    if email:
        return email.lower().strip()
    if token and token.strip() == settings.auth_token:
        return token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
    )
