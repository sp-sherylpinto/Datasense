"""ai_usage — record AI token consumption to the shared ai_usage.events table.

Designed as a thin helper that any in-house app can copy/import. Failures to
record never bubble up — telemetry must not break user-facing analysis.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Pricing map (USD per 1M tokens; input / output) ──────────────────────────
# Sourced from Azure OpenAI / Kimi deployment console, May 2026.
#
# Deployment SKUs in Azure:
#   - Global Deployment   — Global SKU, served from any Microsoft region
#   - Data Zone           — EU or US only (regional residency premium pricing)
#   - Regional Deployment — Local region (up to 27 regions, includes India)
#
# Varma & Varma operates from India and uses **Global SKU** for all deployments
# — Data Zone pricing is NOT applicable. Data Zone entries are intentionally
# omitted so a future India regional deployment never silently picks up EU/US
# rates. If a deployment is ever moved to Data Zone, add the entries back.
#
# Update both AuditGuard (`api/ai_usage.py`) and the per-app copies under
# `in-house-apps/<app>/app/ai_usage.py` together when rates change.
# Unknown models default to (0, 0) and are still recorded so we can spot them.
_PRICING_USD_PER_M: dict[str, tuple[float, float]] = {
    # ── GPT-5.2 family (Global SKU — Standard / chat-latest / Codex priced identically)
    "gpt-5.2":               (1.75, 14.00),
    "gpt-5.2-global":        (1.75, 14.00),
    "gpt-5.2-chat":          (1.75, 14.00),
    "gpt-5.2-chat-latest":   (1.75, 14.00),
    "gpt-5.2-codex":         (1.75, 14.00),

    # ── GPT-5.4 series (Global SKU)
    "gpt-5.4":               (2.50, 15.00),    # < 272k context
    "gpt-5.4-272k":          (5.00, 22.50),    # > 272k context
    "gpt-5.4-large":         (5.00, 22.50),    # alias
    "gpt-5.4-pro":           (30.00, 180.00),  # Pro < 272k
    "gpt-5.4-pro-272k":      (60.00, 270.00),  # Pro > 272k
    "gpt-5.4-mini":          (0.75, 4.50),
    "gpt-5.4-nano":          (0.20, 1.25),

    # ── Kimi (Global SKU only; Data Zone variant intentionally not listed)
    "kimi-k2-thinking":      (0.60, 2.50),
    "kimi-k2.5-thinking":    (0.60, 3.00),
    "kimi-k2.5":             (0.60, 3.00),
    "kimi-k2":               (0.60, 2.50),

    # ── Older OpenAI SKUs (legacy / fallback — unlikely to be hit)
    "gpt-4o":                (2.50, 10.00),
    "gpt-4o-mini":           (0.15, 0.60),
    "gpt-4-turbo":           (10.00, 30.00),
    "gpt-4":                 (30.00, 60.00),
    "gpt-35-turbo":          (0.50, 1.50),
    "o1":                    (15.00, 60.00),
    "o1-mini":               (3.00, 12.00),
    "o3-mini":               (1.10, 4.40),
}


def _normalise(model: str) -> str:
    """Strip Azure deployment prefix and date suffixes for pricing lookup."""
    name = (model or "").strip().lower()
    # Strip Azure deployment prefix (e.g. "openai/gpt-4o" → "gpt-4o")
    if "/" in name:
        name = name.rsplit("/", 1)[-1]
    return name


def compute_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    name = _normalise(model)
    in_per_m, out_per_m = _PRICING_USD_PER_M.get(name, (0.0, 0.0))
    if in_per_m == 0 and out_per_m == 0:
        # Longest-prefix match (e.g. "gpt-5.2-chat-data-zone" wins over "gpt-5.2-chat")
        best_key = ""
        for known in _PRICING_USD_PER_M:
            if name.startswith(known) and len(known) > len(best_key):
                best_key = known
        if best_key:
            in_per_m, out_per_m = _PRICING_USD_PER_M[best_key]
    return round(
        (prompt_tokens * in_per_m + completion_tokens * out_per_m) / 1_000_000,
        6,
    )


# ── Per-app model override (from core.app_ai_config) ────────────────────────
# Read at most once per _MODEL_TTL_SEC to keep DB load tiny. Falls back to the
# `default` argument on any error or when no row exists.
_MODEL_TTL_SEC = 60
_model_cache: dict[str, tuple[float, str]] = {}


async def get_app_model(pool: Any, app_slug: str, default: str) -> str:
    """Return the configured deployment name for `app_slug`. Cached 60s.
    Never raises — returns `default` on any failure."""
    import time as _time
    now = _time.time()
    cached = _model_cache.get(app_slug)
    if cached and (now - cached[0]) < _MODEL_TTL_SEC:
        return cached[1]
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchval(
                "SELECT model_name FROM core.app_ai_config WHERE app_slug = $1",
                app_slug,
            )
        chosen = row or default
    except Exception as e:
        logger.warning("ai_usage.get_app_model failed for %s: %s", app_slug, e)
        chosen = default
    _model_cache[app_slug] = (now, chosen)
    return chosen


async def record_usage(
    pool: Any,
    *,
    app: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    user_email: Optional[str] = None,
    engagement_id: Optional[str] = None,
    operation: Optional[str] = None,
    duration_ms: Optional[int] = None,
    status: str = "success",
    error_message: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Insert one usage event. Never raises — logs at WARNING on failure."""
    try:
        cost = compute_cost_usd(model, prompt_tokens, completion_tokens)
        # Use json.dumps for JSONB metadata to keep this driver-agnostic.
        import json as _json
        meta_json = _json.dumps(metadata) if metadata else None
        eng_uuid = engagement_id if engagement_id else None
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ai_usage.events
                  (app, user_email, engagement_id, model, operation,
                   prompt_tokens, completion_tokens, cost_usd,
                   duration_ms, status, error_message, metadata)
                VALUES
                  ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
                """,
                app, user_email, eng_uuid, _normalise(model), operation,
                int(prompt_tokens or 0), int(completion_tokens or 0), cost,
                duration_ms, status, error_message, meta_json,
            )
    except Exception as e:
        logger.warning("ai_usage.record_usage failed: %s", e)
