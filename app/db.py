# app/db.py
import json
import asyncpg
from app.config import settings


async def _init_conn(conn: asyncpg.Connection) -> None:
    """Register JSON/JSONB codecs so columns are returned as Python objects."""
    await conn.set_type_codec("json",  encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


class Database:
    """PostgreSQL database connection pool."""

    def __init__(self):
        self.pool: asyncpg.Pool | None = None

    async def connect(self):
        """Initialize the connection pool."""
        if not self.pool:
            self.pool = await asyncpg.create_pool(settings.DATABASE_URL, init=_init_conn)

    async def disconnect(self):
        """Close the connection pool."""
        if self.pool:
            await self.pool.close()
            self.pool = None


db = Database()


async def get_db_pool() -> asyncpg.Pool:
    """Dependency for getting the database pool."""
    if not db.pool:
        await db.connect()
    return db.pool
