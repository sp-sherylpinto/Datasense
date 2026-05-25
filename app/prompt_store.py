"""Prompt versioning store.

Prompts live in the `ai_prompts` table (migration 014). Each prompt has a
name + version. Exactly one version per name should be `is_active = TRUE`.

Callers fetch the active prompt by name and render it with Jinja2-style
`{{variable}}` substitution via the standard `str.format(...)` method.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import asyncpg

from app.config import settings
from app.db import get_db_pool

log = logging.getLogger(__name__)

# In-memory cache: name -> {version, system_prompt, user_prompt_template, schema}
# Invalidated on every process restart (simple and correct for container deploys).
_cache: dict[str, dict[str, Any]] = {}


async def _db_fetch(name: str) -> dict[str, Any] | None:
    pool = await get_db_pool().__anext__() if False else _default_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT version, system_prompt, user_prompt_template, schema_json "
            "FROM ai_prompts WHERE name = $1 AND is_active = TRUE",
            name,
        )
    if not row:
        return None
    return {
        "version": row["version"],
        "system_prompt": row["system_prompt"],
        "user_prompt_template": row["user_prompt_template"] or "",
        "schema_json": row["schema_json"],
    }


def _default_pool() -> asyncpg.Pool | None:
    """Best-effort access to the existing pool singleton without circular import."""
    from app.db import db
    return db._pool if hasattr(db, "_pool") else None


async def get_prompt(name: str) -> dict[str, Any] | None:
    """Return the active prompt for *name*, or None if not found."""
    if name in _cache:
        return _cache[name]
    row = await _db_fetch(name)
    if row:
        _cache[name] = row
    return row


def render_prompt(
    prompt: dict[str, Any],
    **kwargs: Any,
) -> tuple[str, str | None, dict | None]:
    """Render a prompt dict into (system_prompt, user_prompt, schema_json).

    The user_prompt_template uses ``{{key}}`` style placeholders.
    Missing keys are left as-is (no KeyError) so partial rendering is safe.
    """
    system = prompt.get("system_prompt", "")
    template = prompt.get("user_prompt_template", "")
    schema = prompt.get("schema_json")
    if isinstance(schema, str):
        try:
            schema = json.loads(schema)
        except json.JSONDecodeError:
            schema = None

    user = template
    for key, val in kwargs.items():
        user = user.replace(f"{{{{{key}}}}}", str(val) if val is not None else "")

    # Strip empty mustache blocks like {{#flag}}...{{/flag}}
    import re
    user = re.sub(r"\{\{#[^}]+\}\}\s*\{\{/[^}]+\}\}", "", user)
    user = re.sub(r"\{\{[^}/]+\}\}", "", user)  # remove any remaining bare tags

    return system, user or None, schema


async def list_prompts() -> list[dict[str, Any]]:
    """Admin utility: list all active prompts."""
    pool = _default_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT name, version, system_prompt, is_active, created_at "
            "FROM ai_prompts WHERE is_active = TRUE ORDER BY name"
        )
    return [dict(r) for r in rows]
