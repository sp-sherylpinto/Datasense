# Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add Journal Entry Testing, Financial Ratios, Aging Buckets, Ollama AI copilot, dataset sharing, and a pinned-chart Dashboard to the existing analytics tool.

**Architecture:** All analysis features follow the established Celery task pattern (Polars → Parquet) with FastAPI endpoints and React tabs. A new `app/ai.py` module encapsulates all Ollama calls. Frontend new tabs are extracted into `src/tabs/` component files to keep `App.tsx` manageable.

**Tech Stack:** FastAPI, asyncpg, PostgreSQL RLS, Celery/Redis, Polars, DuckDB, React 18 + TypeScript, Recharts, Framer Motion, Ollama (`qwen3.5:9b`), httpx, pytest + pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-03-23-data-analytics-features-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `migrations/003_features.sql` | All new tables, columns, RLS policies |
| Modify | `docker-compose.yml` | Add Ollama service |
| Modify | `pyproject.toml` | Add `httpx` dependency |
| Modify | `app/config.py` | Add `OLLAMA_URL` setting |
| Create | `app/ai.py` | Ollama: classify, explain, sql_assist |
| Modify | `app/main.py` | New endpoints, task_map, upload BackgroundTask, PATCH dataset |
| Modify | `worker/tasks.py` | Three new Celery tasks: `run_je_test`, `run_ratios`, `run_aging` |
| Create | `tests/__init__.py` | Package marker |
| Create | `tests/conftest.py` | Shared fixtures |
| Create | `tests/test_je_test.py` | JE flag logic unit tests |
| Create | `tests/test_ratios.py` | Ratio computation unit tests |
| Create | `tests/test_aging.py` | Aging bucket unit tests |
| Create | `tests/test_classifier.py` | Heuristic classifier unit tests |
| Create | `src/tabs/JeTestTab.tsx` | Journal Entry Testing tab |
| Create | `src/tabs/RatiosTab.tsx` | Financial Ratios tab |
| Create | `src/tabs/AgingTab.tsx` | Aging Buckets tab |
| Create | `src/tabs/DashboardTab.tsx` | Pinned charts dashboard tab |
| Create | `src/components/AiInsightPanel.tsx` | SSE streaming AI explanation panel |
| Create | `src/components/ShareModal.tsx` | Dataset sharing modal |
| Modify | `src/App.tsx` | Register new tabs, add type gating, add SQL copilot to workbench |

---

## Task 1: Test Infrastructure + Dependencies

**Files:**
- Modify: `pyproject.toml`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [x] **Step 1: Add pytest dependencies to pyproject.toml**

Open `pyproject.toml` and add to `[tool.poetry.group.dev.dependencies]`:

```toml
pytest = "^8.0.0"
pytest-asyncio = "^0.23.0"
httpx = "^0.27.0"
```

Also add `httpx` to the main dependencies (needed by `app/ai.py` at runtime):

```toml
[tool.poetry.dependencies]
# ... existing deps ...
httpx = "^0.27.0"
```

- [x] **Step 2: Install dependencies**

```bash
cd /home/ubuntu/hosting/in-house-apps/data_analytics
docker compose exec api pip install httpx pytest pytest-asyncio
```

Or if running outside Docker:
```bash
poetry add httpx
poetry add --group dev pytest pytest-asyncio
```

- [x] **Step 3: Create tests/__init__.py**

```python
```
(empty file)

- [x] **Step 4: Create tests/conftest.py**

```python
# tests/conftest.py
import pytest
import polars as pl


@pytest.fixture
def sample_je_df():
    """A minimal journal entries DataFrame for testing."""
    return pl.DataFrame({
        "date":     ["2026-03-21", "2026-03-22", "2026-03-31", "2026-03-15"],
        "amount":   [5000.0, -5000.0, 100000.0, 1234.56],
        "account":  ["Sales", "Sales", "Cash", "Expenses"],
        "preparer": ["alice", "alice", "bob", "alice"],
        "narration":["Invoice #1", "Invoice #1", "Year end adj", "Travel"],
    })


@pytest.fixture
def sample_ratio_df():
    """Single-period financial statement data."""
    return pl.DataFrame({
        "period":              ["Q1 2026"],
        "revenue":             [1_000_000.0],
        "cogs":                [600_000.0],
        "gross_profit":        [400_000.0],
        "net_income":          [100_000.0],
        "current_assets":      [500_000.0],
        "current_liabilities": [250_000.0],
        "inventory":           [50_000.0],
        "total_assets":        [1_200_000.0],
        "total_debt":          [300_000.0],
        "equity":              [700_000.0],
        "ebit":                [150_000.0],
        "interest_expense":    [30_000.0],
    })


@pytest.fixture
def sample_aging_df():
    """Debtors listing with due dates."""
    return pl.DataFrame({
        "party":    ["Acme Ltd", "Beta Corp", "Gamma Inc", "Delta Co"],
        "amount":   [10000.0, 5000.0, 75000.0, 2000.0],
        "due_date": ["2026-02-01", "2025-12-01", "2025-06-01", "2026-03-20"],
    })
```

- [x] **Step 5: Verify pytest runs (no tests yet, just collection)**

```bash
docker compose exec api python -m pytest tests/ --collect-only
```

Expected: `no tests ran` (or `0 tests collected`) — no errors.

- [x] **Step 6: Commit**

```bash
git add pyproject.toml tests/__init__.py tests/conftest.py
git commit -m "chore: add pytest infrastructure and httpx dependency"
```

---

## Task 2: Database Migration

**Files:**
- Create: `migrations/003_features.sql`

> **Important:** Postgres only runs `docker-entrypoint-initdb.d` on a fresh volume. Apply this migration manually to any already-running instance with the command in Step 3.

- [x] **Step 1: Create migrations/003_features.sql**

```sql
-- migrations/003_features.sql
-- Feature expansion: dataset types, sharing, dashboard, AI job ownership

-- ── 1. Dataset type classification ─────────────────────────────────────────
-- NOTE: `owner TEXT` column on `datasets` already exists (added in migration 002 or pre-existing).
-- The `IF NOT EXISTS` guard prevents errors but the column is NOT new.
-- Only `dataset_type` is new.
ALTER TABLE datasets
    ADD COLUMN IF NOT EXISTS dataset_type TEXT NOT NULL DEFAULT 'general';

-- ── 2. Owner tracking on jobs (needed for AI explainer auth) ───────────────
-- POST /jobs handler must write owner = current_user into this column.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS owner TEXT;

-- ── 3. Dataset sharing ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dataset_shares (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    shared_with TEXT NOT NULL,   -- grantee Authentik email
    granted_by  TEXT NOT NULL,   -- owner Authentik email
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Only the grantor (owner) can see/manage their share rows
ALTER TABLE dataset_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS dataset_shares_owner ON dataset_shares
    USING (granted_by = current_setting('app.active_user', true));

-- ── 4. Update datasets RLS ─────────────────────────────────────────────────
-- USING: owners + shared users can SELECT
-- WITH CHECK: only owners can INSERT/UPDATE
-- Separate FOR DELETE policy: only owners can DELETE
DO $$
BEGIN
    -- Drop old policy if it exists (idempotent)
    DROP POLICY IF EXISTS datasets_owner ON datasets;
    DROP POLICY IF EXISTS datasets_owner_delete ON datasets;

    CREATE POLICY datasets_owner ON datasets
        USING (
            owner = current_setting('app.active_user', true)
            OR id IN (
                SELECT dataset_id FROM dataset_shares
                WHERE shared_with = current_setting('app.active_user', true)
            )
        )
        WITH CHECK (
            owner = current_setting('app.active_user', true)
        );

    CREATE POLICY datasets_owner_delete ON datasets
        FOR DELETE
        USING (owner = current_setting('app.active_user', true));
END
$$;

-- ── 5. Dashboard pinned charts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pinned_charts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner       TEXT NOT NULL,
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    chart_type  TEXT NOT NULL,   -- bar | line | area | scatter
    config_json JSONB,
    position    INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pinned_charts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS pinned_charts_owner ON pinned_charts
    USING (owner = current_setting('app.active_user', true));

-- ── 6. Grants for analytics_app role ──────────────────────────────────────
-- analytics_app is the RLS-respecting role used by the API
GRANT SELECT, INSERT, UPDATE, DELETE ON dataset_shares TO analytics_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pinned_charts  TO analytics_app;
GRANT SELECT, UPDATE ON datasets TO analytics_app;   -- UPDATE for dataset_type PATCH
```

- [x] **Step 2: Apply to running database**

```bash
docker compose exec postgres psql \
  -U postgres -d analytics \
  -f /docker-entrypoint-initdb.d/003_features.sql
```

Expected output: series of `ALTER TABLE`, `CREATE TABLE`, `ALTER TABLE`, `DO`, `CREATE TABLE`, `GRANT` — no errors.

- [x] **Step 3: Verify columns exist**

```bash
docker compose exec postgres psql -U postgres -d analytics -c \
  "\d datasets" | grep -E "dataset_type|owner"
```

Expected: two rows showing `dataset_type text` and `owner text`.

- [x] **Step 4: Commit**

```bash
git add migrations/003_features.sql
git commit -m "feat: add migration for dataset_type, sharing, dashboard, job ownership"
```

---

## Task 3: Ollama Docker Service

**Files:**
- Modify: `docker-compose.yml`
- Modify: `app/config.py`

- [x] **Step 1: Add Ollama service to docker-compose.yml**

Add this block before the `volumes:` section at the bottom of `docker-compose.yml`:

```yaml
  # ── Ollama LLM (local AI) ─────────────────────────────────────────────────
  ollama:
    image: ollama/ollama:latest
    container_name: analytics_ollama
    volumes:
      - ollama_data:/root/.ollama
    restart: unless-stopped
    # Internal only — NOT added to proxy network
    # Reachable at http://ollama:11434 from api and worker containers
```

Also add `ollama_data:` under `volumes:`:

```yaml
volumes:
  postgres_data:
  data_storage:
  node_modules:
  ollama_data:
```

And add `ollama` to the `depends_on` of both `api` and `worker` services (optional but good practice):
```yaml
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      ollama:
        condition: service_started
```

- [x] **Step 2: Add OLLAMA_URL to app/config.py**

```python
OLLAMA_URL: str = Field("http://ollama:11434", env="OLLAMA_URL")
```

- [x] **Step 3: Start Ollama and pull the model**

```bash
docker compose up -d ollama
# Wait ~10s for container to be ready, then pull the model
docker compose exec ollama ollama pull qwen3.5:9b
```

Expected: progress bar showing download of ~6.6 GB. First run takes several minutes.

- [x] **Step 4: Verify model is available**

```bash
docker compose exec ollama ollama list
```

Expected: `qwen3.5:9b` listed with size ~6.6 GB.

- [x] **Step 5: Quick smoke test from api container**

```bash
docker compose exec api python -c "
import httpx, json
r = httpx.post('http://ollama:11434/api/generate',
    json={'model': 'qwen3.5:9b', 'prompt': 'Reply with OK only.', 'stream': False},
    timeout=60)
print(r.json()['response'])
"
```

Expected: `OK` (or similar short confirmation).

- [x] **Step 6: Commit**

```bash
git add docker-compose.yml app/config.py
git commit -m "feat: add Ollama service with qwen3.5:9b for local AI"
```

---

## Task 4: AI Module (app/ai.py)

**Files:**
- Create: `app/ai.py`
- Create: `tests/test_classifier.py`

- [x] **Step 1: Write failing tests for the heuristic classifier**

```python
# tests/test_classifier.py
import pytest
from app.ai import _classify_heuristic


def test_classify_journal_entries():
    cols = ["date", "amount", "account", "narration", "preparer"]
    assert _classify_heuristic(cols) == "journal_entries"


def test_classify_financial_statements():
    cols = ["period", "revenue", "cogs", "net_income", "total_assets", "equity"]
    assert _classify_heuristic(cols) == "financial_statements"


def test_classify_debtors_creditors():
    cols = ["party_name", "outstanding_amount", "due_date", "invoice_date"]
    assert _classify_heuristic(cols) == "debtors_creditors"


def test_classify_general_fallback():
    cols = ["product", "quantity", "price", "region"]
    assert _classify_heuristic(cols) == "general"


def test_classify_je_partial_match():
    # Has date + amount + ledger — enough for JE
    cols = ["voucher_date", "debit_amount", "ledger"]
    assert _classify_heuristic(cols) == "journal_entries"
```

- [x] **Step 2: Run tests — expect failure**

```bash
docker compose exec api python -m pytest tests/test_classifier.py -v
```

Expected: `ImportError: cannot import name '_classify_heuristic' from 'app.ai'` (module doesn't exist yet).

- [x] **Step 3: Create app/ai.py**

```python
# app/ai.py
"""
Ollama AI integration for:
  - Dataset type classification (_classify_heuristic + _classify_with_ollama)
  - Analysis explanation (explain_job — SSE streaming)
  - SQL copilot (sql_assist)
"""

from __future__ import annotations

import json
import re
from typing import AsyncIterator

import httpx
import polars as pl

from app.config import settings

# ─── Dataset Classifier ────────────────────────────────────────────────────


_JE_SIGNALS = {"date", "amount", "debit", "credit", "account", "ledger",
               "narration", "voucher", "entry", "posting"}
_FS_SIGNALS = {"period", "year", "quarter", "revenue", "cogs", "assets",
               "liabilities", "equity", "income", "profit", "ebit"}
_DC_SIGNALS = {"party", "name", "customer", "vendor", "supplier", "debtor",
               "creditor", "balance", "due_date", "invoice_date", "outstanding"}


def _classify_heuristic(col_names: list[str]) -> str:
    """Classify dataset type from column names using keyword matching."""
    lower = {c.lower().replace(" ", "_") for c in col_names}

    def _hits(signals: set[str]) -> int:
        return sum(1 for c in lower if any(s in c for s in signals))

    je_hits = _hits(_JE_SIGNALS)
    fs_hits = _hits(_FS_SIGNALS)
    dc_hits = _hits(_DC_SIGNALS)

    # Journal entries: need date-like + amount-like + account-like
    has_date   = any("date" in c or "voucher" in c for c in lower)
    has_amount = any("amount" in c or "debit" in c or "credit" in c for c in lower)
    has_acct   = any("account" in c or "ledger" in c or "narration" in c for c in lower)
    if has_date and has_amount and has_acct:
        return "journal_entries"

    # Financial statements: period + 4+ numeric financial keywords
    has_period = any("period" in c or "year" in c or "quarter" in c for c in lower)
    if has_period and fs_hits >= 4:
        return "financial_statements"

    # Debtors/creditors: party + amount + date
    has_party  = any("party" in c or "name" in c or "customer" in c
                     or "vendor" in c or "debtor" in c or "creditor" in c
                     for c in lower)
    has_due    = any("due" in c or "invoice" in c for c in lower)
    if has_party and has_amount and has_due:
        return "debtors_creditors"

    return "general"


async def classify_dataset(
    dataset_id: str,
    col_names: list[str],
    samples: dict[str, list],
    db_url: str,
) -> None:
    """
    Background task: classify dataset type and update the DB row.
    First tries Ollama; falls back to heuristic on error/timeout.
    """
    import asyncpg
    from uuid import UUID

    dataset_type = _classify_heuristic(col_names)  # fallback default

    sample_text = "\n".join(
        f"  {col}: {vals[:3]}" for col, vals in samples.items()
    )
    prompt = (
        "You are a data classification assistant. Given these column names "
        "and sample values from a dataset, classify the dataset as exactly "
        "one of: journal_entries, financial_statements, debtors_creditors, general.\n\n"
        f"Columns and samples:\n{sample_text}\n\n"
        "Respond with only the classification label, nothing else."
    )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.OLLAMA_URL}/api/generate",
                json={"model": "qwen3.5:9b", "prompt": prompt, "stream": False},
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "").strip().lower()
            valid = {"journal_entries", "financial_statements",
                     "debtors_creditors", "general"}
            if raw in valid:
                dataset_type = raw
    except Exception:
        pass  # keep heuristic result

    conn = await asyncpg.connect(db_url)
    try:
        await conn.execute(
            "UPDATE datasets SET dataset_type = $1 WHERE id = $2",
            dataset_type,
            UUID(dataset_id),
        )
    finally:
        await conn.close()


# ─── SQL Copilot ──────────────────────────────────────────────────────────


async def sql_assist(user_prompt: str, tables: list[dict]) -> str:
    """Generate a SELECT SQL query from a natural language prompt."""
    table_list = "\n".join(
        f"  {t['name']} ({', '.join(t['columns'])})" for t in tables
    )
    prompt = (
        "You are a PostgreSQL SQL assistant. Generate a single SELECT query.\n"
        "Available tables (always use fully schema-qualified names as given):\n"
        f"{table_list}\n\n"
        f"User request: {user_prompt}\n\n"
        "Rules:\n"
        "- Use the full table name exactly as listed above (e.g. datasets.ds_abc123)\n"
        "- Return only the SQL query, no explanation, no markdown fences\n"
        "- Only SELECT statements"
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.OLLAMA_URL}/api/generate",
            json={"model": "qwen3.5:9b", "prompt": prompt, "stream": False},
        )
        resp.raise_for_status()
        sql = resp.json().get("response", "").strip()
        # Strip any accidental markdown fences
        sql = re.sub(r"^```(?:sql)?\n?", "", sql, flags=re.IGNORECASE)
        sql = re.sub(r"\n?```$", "", sql)
        return sql.strip()


# ─── Analysis Explainer (SSE streaming) ──────────────────────────────────


def _build_explain_prompt(task_name: str, result_df: pl.DataFrame) -> str:
    """Build a task-specific prompt from the Parquet result summary."""
    base = (
        "You are an audit data analyst assistant. Explain the following "
        "analysis results in clear, plain English suitable for a CA firm. "
        "Be specific about numbers. Keep the response under 300 words.\n\n"
    )

    if task_name == "run_je_test":
        total = len(result_df)
        flagged = result_df.filter(pl.col("is_flagged") == True)
        flag_count = len(flagged)
        # Flag breakdown
        if "flags" in result_df.columns:
            all_flags: list[str] = []
            for row in flagged["flags"].to_list():
                if row:
                    all_flags.extend(row.split(","))
            from collections import Counter
            breakdown = Counter(f.strip() for f in all_flags)
            breakdown_txt = "\n".join(
                f"  - {k}: {v}" for k, v in breakdown.most_common(7)
            )
        else:
            breakdown_txt = "No breakdown available."

        return (
            base
            + f"Journal Entry Testing Results:\n"
            f"Total entries: {total}\n"
            f"Flagged entries: {flag_count} ({flag_count/max(total,1)*100:.1f}%)\n"
            f"Flag breakdown:\n{breakdown_txt}\n\n"
            "Explain what these findings mean for the audit, which flags are "
            "most significant, and what the auditor should follow up on."
        )

    if task_name == "run_ratios":
        rows = result_df.to_dicts()
        ratios_txt = "\n".join(
            f"  {k}: {v}" for row in rows for k, v in row.items()
            if v is not None and k != "period"
        )
        return base + f"Financial Ratios:\n{ratios_txt}\n\nExplain these ratios and flag any that look unusual or warrant further investigation."

    if task_name == "run_aging":
        summary = result_df.filter(pl.col("result_type") == "summary")
        rows_txt = "\n".join(
            f"  {r['bucket']}: ₹{r.get('total_amount', 0):,.0f} "
            f"({r.get('party_count', 0)} parties, {r.get('pct_of_total', 0):.1f}%)"
            for r in summary.to_dicts()
        )
        return base + f"Aging Buckets:\n{rows_txt}\n\nExplain the aging profile, highlight concentration risk, and suggest what the auditor should focus on."

    # Generic fallback
    stats = result_df.describe().to_dicts()
    stats_txt = json.dumps(stats[:10], indent=2)
    return base + f"Analysis results summary:\n{stats_txt}\n\nExplain the key findings."


async def explain_job(task_name: str, result_path: str) -> AsyncIterator[str]:
    """Stream an AI explanation of a completed job's Parquet result."""
    try:
        df = pl.read_parquet(result_path)
    except Exception as e:
        yield f"Error reading result: {e}"
        return

    prompt = _build_explain_prompt(task_name, df)

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{settings.OLLAMA_URL}/api/generate",
            json={"model": "qwen3.5:9b", "prompt": prompt, "stream": True},
        ) as resp:
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    token = chunk.get("response", "")
                    if token:
                        yield token
                    if chunk.get("done"):
                        break
                except json.JSONDecodeError:
                    continue
```

- [x] **Step 4: Run classifier tests — expect pass**

```bash
docker compose exec api python -m pytest tests/test_classifier.py -v
```

Expected: `5 passed`.

- [x] **Step 5: Commit**

```bash
git add app/ai.py tests/test_classifier.py
git commit -m "feat: add app/ai.py with Ollama classifier, SQL copilot, and explainer"
```

---

## Task 5: Dataset Classifier Integration + New Endpoints

**Files:**
- Modify: `app/main.py` (upload handler, PATCH /datasets/{id}, POST /ai/explain/{job_id}, POST /ai/sql-assist)

- [x] **Step 1: Add BackgroundTask to upload handler**

> **Important:** The `datasets` INSERT in `upload_file` already writes `owner` (10th parameter). Do **not** add it again — only add the `BackgroundTasks` parameter and the `background_tasks.add_task(...)` call.

In `app/main.py`, add `BackgroundTasks` import and update the function signature:

```python
from fastapi import BackgroundTasks   # add to existing fastapi imports

@app.post("/upload", response_model=dict)
async def upload_file(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks,   # NO default — FastAPI injects this per-request
    client_id: str = "00000000-0000-0000-0000-000000000001",
    engagement_id: str = "00000000-0000-0000-0000-000000000002",
    user: str = Depends(get_current_user),
    rls: tuple = Depends(get_user_conn),
):
```

After the `INSERT INTO datasets` block (after `dataset_id = await conn.fetchval(...)`) and before the `return`, add:

```python
        # Classify dataset type in background — does not block upload response
        samples = {
            col["name"]: [str(r.get(col["name"], "")) for r in preview[:5]]
            for col in meta["columns"]
        }
        background_tasks.add_task(
            classify_dataset,
            str(dataset_id),
            [c["name"] for c in meta["columns"]],
            samples,
            settings.DATABASE_URL,
        )
```

Add the import at the top of `main.py`:
```python
from app.ai import classify_dataset, sql_assist, explain_job
```

- [x] **Step 2: Add PATCH /datasets/{id} endpoint**

```python
@app.patch("/datasets/{dataset_id}", response_model=dict)
async def update_dataset(
    dataset_id: UUID,
    dataset_type: str = Body(..., embed=True),
    rls: tuple = Depends(get_user_conn),
):
    """Allow the owner to override the auto-detected dataset type."""
    valid_types = {"journal_entries", "financial_statements",
                   "debtors_creditors", "general"}
    if dataset_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid dataset_type. Must be one of: {valid_types}")
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        row = await conn.fetchrow(
            "UPDATE datasets SET dataset_type = $1 WHERE id = $2 RETURNING id, dataset_type",
            dataset_type, dataset_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found or not owned by you")
    return dict(row)
```

- [x] **Step 3: Add POST /ai/explain/{job_id} (SSE streaming)**

```python
from fastapi.responses import StreamingResponse

@app.post("/ai/explain/{job_id}")
async def ai_explain(
    job_id: UUID,
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Stream a plain-English explanation of a completed job's results."""
    async with pool.acquire() as conn:
        job = await conn.fetchrow(
            "SELECT task_name, result_path, owner FROM jobs WHERE id = $1", job_id
        )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Jobs created before the owner column migration have owner=NULL — treat as unowned
    if not job["owner"] or job["owner"] != user:
        raise HTTPException(status_code=403, detail="Not your job")
    if not job["result_path"]:
        raise HTTPException(status_code=400, detail="Job has no result yet")

    # Path traversal guard
    import os
    results_dir = os.path.join(os.path.realpath(settings.DATA_DIR), "results")
    if not os.path.realpath(job["result_path"]).startswith(results_dir):
        raise HTTPException(status_code=403, detail="Access denied")

    async def event_stream():
        async for token in explain_job(job["task_name"], job["result_path"]):
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [x] **Step 4: Add POST /ai/sql-assist**

```python
@app.post("/ai/sql-assist", response_model=dict)
async def ai_sql_assist(
    prompt: str = Body(..., embed=True),
    tables: list[dict] = Body(..., embed=True),
    user: str = Depends(get_current_user),
):
    """Generate a SELECT SQL query from a natural language prompt."""
    try:
        sql = await sql_assist(prompt, tables)
        return {"sql": sql}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")
```

- [x] **Step 5: Update jobs INSERT to write owner**

Find the `create_job` function in `main.py` and update the INSERT:

```python
    async with pool.acquire() as conn:
        job_id = await conn.fetchval(
            """
            INSERT INTO jobs (status, task_name, client_id, dataset_id, owner)
            VALUES ('pending', $1, $2, $3, $4)
            RETURNING id
            """,
            task_name,
            UUID(client_id),
            UUID(dataset_id) if dataset_id else None,
            user,  # owner from get_current_user
        )
```

Also update `create_job` to accept `user: str = Depends(get_current_user)` (replace the existing `dependencies=[Depends(get_current_user)]` pattern with an explicit parameter so `user` is accessible).

- [x] **Step 6: Restart API and smoke-test upload**

```bash
docker compose restart api
# Upload a test file and verify dataset_type is set
curl -X POST http://localhost:8000/upload \
  -H "X-API-Token: dev-token" \
  -F "file=@/path/to/sample.csv"
# Response should include dataset_type (initially "general", updated by background task)
```

- [x] **Step 7: Commit**

```bash
git add app/main.py
git commit -m "feat: integrate dataset classifier, add PATCH /datasets, AI endpoints"
```

---

## Task 6: Journal Entry Testing Worker

**Files:**
- Modify: `worker/tasks.py`
- Create: `tests/test_je_test.py`

- [x] **Step 1: Write failing tests**

```python
# tests/test_je_test.py
import pytest
import polars as pl
from worker.tasks import _check_je_flags


def test_weekend_posting_flagged():
    # 2026-03-21 is a Saturday
    df = pl.DataFrame({
        "date": ["2026-03-21"], "amount": [1000.0],
        "account": ["Cash"], "preparer": ["alice"], "narration": ["test"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    assert result["flags"][0] == "weekend_posting"
    assert result["is_flagged"][0] == True


def test_end_of_period_flagged():
    # 2026-03-31 is last day of March
    df = pl.DataFrame({
        "date": ["2026-03-31"], "amount": [500.0],
        "account": ["Sales"], "preparer": ["bob"], "narration": ["adj"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",  # column name, not value
        narration_col="narration", large_amount_threshold=100000,
    )
    assert "end_of_period" in result["flags"][0]


def test_round_number_flagged():
    df = pl.DataFrame({
        "date": ["2026-03-10"], "amount": [50000.0],
        "account": ["Cash"], "preparer": ["alice"], "narration": ["transfer"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    assert "round_number" in result["flags"][0]


def test_same_day_reversal_flagged():
    df = pl.DataFrame({
        "date": ["2026-03-10", "2026-03-10"],
        "amount": [5000.0, -5000.0],
        "account": ["Sales", "Sales"],
        "preparer": ["alice", "alice"],
        "narration": ["Invoice", "Reversal"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    flags_list = [r for r in result["flags"].to_list() if "same_day_reversal" in r]
    assert len(flags_list) == 2  # both the entry and its reversal are flagged


def test_zero_amount_not_flagged_as_reversal():
    df = pl.DataFrame({
        "date": ["2026-03-10", "2026-03-10"],
        "amount": [0.0, 0.0],
        "account": ["Cash", "Cash"],
        "preparer": ["alice", "alice"],
        "narration": ["memo", "memo"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    for flags in result["flags"].to_list():
        assert "same_day_reversal" not in (flags or "")


def test_no_flags_for_normal_entry():
    df = pl.DataFrame({
        "date": ["2026-03-10"], "amount": [1234.56],
        "account": ["Expenses"], "preparer": ["alice"], "narration": ["routine"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    assert result["flags"][0] == ""
    assert result["is_flagged"][0] == False
```

- [x] **Step 2: Run tests — expect import failure**

```bash
docker compose exec api python -m pytest tests/test_je_test.py -v
```

Expected: `ImportError: cannot import name '_check_je_flags' from 'worker.tasks'`

- [x] **Step 3: Implement _check_je_flags and run_je_test in worker/tasks.py**

Add to `worker/tasks.py`:

```python
# ─── Journal Entry Testing ──────────────────────────────────────────────────

def _check_je_flags(
    df: pl.DataFrame,
    date_col: str,
    amount_col: str,
    account_col: str,
    preparer_col: str | None = None,
    narration_col: str | None = None,
    large_amount_threshold: float = 100_000,
) -> pl.DataFrame:
    """Pure computation: add flags, flag_count, is_flagged columns to df."""
    import datetime

    df = df.with_columns(
        pl.col(date_col).cast(pl.String).str.to_date(strict=False).alias("__date_parsed"),
        pl.col(amount_col).cast(pl.Float64, strict=False).alias("__amount_f"),
    )

    n = len(df)
    flags_list: list[list[str]] = [[] for _ in range(n)]

    dates = df["__date_parsed"].to_list()
    amounts = df["__amount_f"].to_list()
    accounts = df[account_col].cast(pl.String).to_list()
    preparers = df[preparer_col].cast(pl.String).to_list() if preparer_col else [None] * n
    narrations = df[narration_col].cast(pl.String).to_list() if narration_col else [None] * n

    # Weekend posting
    for i, d in enumerate(dates):
        if d and d.weekday() >= 5:
            flags_list[i].append("weekend_posting")

    # End of period (last 3 days of any month)
    import calendar
    for i, d in enumerate(dates):
        if d:
            last_day = calendar.monthrange(d.year, d.month)[1]
            if d.day >= last_day - 2:
                flags_list[i].append("end_of_period")

    # Round number (divisible by 1000, non-zero)
    for i, amt in enumerate(amounts):
        if amt is not None and amt != 0 and abs(amt) % 1000 == 0:
            flags_list[i].append("round_number")

    # Large amount
    for i, amt in enumerate(amounts):
        if amt is not None and abs(amt) > large_amount_threshold:
            flags_list[i].append("large_amount")

    # Rare combo (preparer + account appearing < 2 times)
    from collections import Counter
    combo_key = [
        f"{p}||{a}" if p else a
        for p, a in zip(preparers, accounts)
    ]
    combo_counts = Counter(combo_key)
    for i, key in enumerate(combo_key):
        if combo_counts[key] < 2:
            flags_list[i].append("rare_combo")

    # Duplicate narration + different amount
    if narration_col:
        from collections import defaultdict
        nar_amounts: dict[str, set] = defaultdict(set)
        for nar, amt in zip(narrations, amounts):
            if nar and amt is not None:
                nar_amounts[nar].add(round(float(amt), 2))
        for i, nar in enumerate(narrations):
            if nar and len(nar_amounts.get(nar, set())) > 1:
                flags_list[i].append("duplicate_narration_diff_amount")

    # Same-day reversal (same account + abs(amount) + opposite sign, amount != 0)
    reversal_keys: dict[str, list[int]] = {}
    for i, (d, amt, acct) in enumerate(zip(dates, amounts, accounts)):
        if d and amt and amt != 0:
            key = f"{d}||{acct}||{abs(amt):.2f}"
            reversal_keys.setdefault(key, []).append(i)

    # Group by key; flag if we see both positive and negative
    for key, idxs in reversal_keys.items():
        if len(idxs) < 2:
            continue
        signs = {1 if (amounts[i] or 0) > 0 else -1 for i in idxs}
        if len(signs) == 2:  # both + and - present
            for i in idxs:
                flags_list[i].append("same_day_reversal")

    flags_strs = [",".join(f) for f in flags_list]
    flag_counts = [len(f) for f in flags_list]
    is_flagged = [c > 0 for c in flag_counts]

    return df.drop(["__date_parsed", "__amount_f"]).with_columns([
        pl.Series("flags",      flags_strs),
        pl.Series("flag_count", flag_counts),
        pl.Series("is_flagged", is_flagged),
    ])


@celery_app.task(bind=True, name="worker.tasks.run_je_test")
def run_je_test(
    self,
    file_path: str,
    job_id: str,
    date_col: str,
    amount_col: str,
    account_col: str,
    preparer_col: str | None = None,
    narration_col: str | None = None,
    large_amount_threshold: float = 100_000,
    **kwargs,
) -> None:
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = pl.read_csv(file_path, ignore_errors=True)
        result = _check_je_flags(
            df, date_col=date_col, amount_col=amount_col,
            account_col=account_col, preparer_col=preparer_col,
            narration_col=narration_col,
            large_amount_threshold=large_amount_threshold,
        )
        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
    except Exception as e:
        asyncio.run(update_job_status(job_id, "failed", error_message=traceback.format_exc()))
        raise e
```

- [x] **Step 4: Register run_je_test in task_map in main.py**

> **Only add `run_je_test` here.** Add `run_ratios` and `run_aging` in Tasks 7 and 8 respectively — importing them before they exist causes an `ImportError` that crashes the API.

In the `create_job` function, update imports and `task_map`:

```python
from worker.tasks import (
    summarise_csv, run_benford, run_outliers,
    run_timeseries, run_clustering, run_network,
    run_cleaning, run_forecast, run_profile,
    run_isolation_forest,
    run_je_test,   # new in this task
)

task_map = {
    # ... existing entries ...
    "run_je_test": run_je_test,
}
```

- [x] **Step 5: Run tests — expect pass**

```bash
docker compose exec api python -m pytest tests/test_je_test.py -v
```

Expected: `6 passed`.

- [x] **Step 6: Restart worker and smoke-test via API**

```bash
docker compose restart worker
curl -X POST "http://localhost:8000/jobs?task_name=run_je_test&file_path=/data/uploads/test.csv" \
  -H "X-API-Token: dev-token" \
  -H "Content-Type: application/json" \
  -d '{"date_col":"date","amount_col":"amount","account_col":"account"}'
```

- [x] **Step 7: Commit**

```bash
git add worker/tasks.py app/main.py tests/test_je_test.py
git commit -m "feat: add JE Testing Celery task with 7 flag checks"
```

---

## Task 7: Financial Ratios Worker

**Files:**
- Modify: `worker/tasks.py`
- Create: `tests/test_ratios.py`

- [x] **Step 1: Write failing tests**

```python
# tests/test_ratios.py
import pytest
import polars as pl
from worker.tasks import _compute_ratios


def test_current_ratio(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df,
        period_col="period",
        current_assets_col="current_assets",
        current_liabilities_col="current_liabilities",
    )
    assert abs(result[0]["current_ratio"] - 2.0) < 0.01


def test_quick_ratio_with_inventory(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df,
        period_col="period",
        current_assets_col="current_assets",
        current_liabilities_col="current_liabilities",
        inventory_col="inventory",
    )
    # (500000 - 50000) / 250000 = 1.8
    assert abs(result[0]["quick_ratio"] - 1.8) < 0.01


def test_gross_margin(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df, period_col="period",
        revenue_col="revenue", gross_profit_col="gross_profit",
    )
    assert abs(result[0]["gross_margin_pct"] - 40.0) < 0.01


def test_debt_to_equity(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df, period_col="period",
        total_debt_col="total_debt", equity_col="equity",
    )
    # 300000 / 700000 ≈ 0.4286
    assert abs(result[0]["debt_to_equity"] - 300_000/700_000) < 0.001


def test_missing_columns_skipped(sample_ratio_df):
    # Only provide current ratio cols — others should be None not error
    result = _compute_ratios(
        sample_ratio_df, period_col="period",
        current_assets_col="current_assets",
        current_liabilities_col="current_liabilities",
    )
    assert result[0]["gross_margin_pct"] is None
    assert result[0]["current_ratio"] is not None


def test_division_by_zero_returns_null(sample_ratio_df):
    df = sample_ratio_df.with_columns(pl.lit(0.0).alias("equity"))
    result = _compute_ratios(
        df, period_col="period",
        net_income_col="net_income", equity_col="equity",
    )
    assert result[0]["return_on_equity"] is None
```

- [x] **Step 2: Run — expect import error**

```bash
docker compose exec api python -m pytest tests/test_ratios.py -v
```

- [x] **Step 3: Implement _compute_ratios and run_ratios**

```python
# ─── Financial Ratios ───────────────────────────────────────────────────────

def _compute_ratios(
    df: pl.DataFrame,
    period_col: str | None = None,
    revenue_col: str | None = None,
    cogs_col: str | None = None,
    gross_profit_col: str | None = None,
    net_income_col: str | None = None,
    ebit_col: str | None = None,
    interest_expense_col: str | None = None,
    current_assets_col: str | None = None,
    current_liabilities_col: str | None = None,
    inventory_col: str | None = None,
    total_assets_col: str | None = None,
    total_debt_col: str | None = None,
    equity_col: str | None = None,
) -> list[dict]:
    """Compute financial ratios per period row. Returns list of dicts."""

    def _safe_div(a: float | None, b: float | None) -> float | None:
        if a is None or b is None or b == 0:
            return None
        return round(a / b, 4)

    def _col(df: pl.DataFrame, name: str | None) -> pl.Series | None:
        if name and name in df.columns:
            return df[name].cast(pl.Float64, strict=False)
        return None

    # Group by period if period_col given; otherwise treat all rows as one group
    groups: list[pl.DataFrame]
    if period_col and period_col in df.columns:
        groups = [df.filter(pl.col(period_col) == v)
                  for v in df[period_col].unique().sort()]
    else:
        groups = [df]

    results: list[dict] = []
    for grp in groups:
        # Aggregate each column to a single value (sum for income stmt, last for balance sheet)
        def _val(col_name: str | None) -> float | None:
            s = _col(grp, col_name)
            if s is None:
                return None
            v = s.drop_nulls().sum()
            return float(v) if v is not None else None

        rev   = _val(revenue_col)
        gp    = _val(gross_profit_col)
        ni    = _val(net_income_col)
        ebit  = _val(ebit_col)
        intx  = _val(interest_expense_col)
        ca    = _val(current_assets_col)
        cl    = _val(current_liabilities_col)
        inv   = _val(inventory_col)
        ta    = _val(total_assets_col)
        debt  = _val(total_debt_col)
        eq    = _val(equity_col)

        period_label = grp[period_col][0] if period_col and period_col in grp.columns else "All"

        row: dict = {
            "period": str(period_label),
            "current_ratio":      _safe_div(ca, cl),
            "quick_ratio":        _safe_div((ca - inv) if ca and inv else ca, cl),
            "gross_margin_pct":   _safe_div(gp, rev) and round(_safe_div(gp, rev) * 100, 2),
            "net_margin_pct":     _safe_div(ni, rev) and round(_safe_div(ni, rev) * 100, 2),
            "return_on_equity":   _safe_div(ni, eq) and round(_safe_div(ni, eq) * 100, 2),
            "return_on_assets":   _safe_div(ni, ta) and round(_safe_div(ni, ta) * 100, 2),
            "debt_to_equity":     _safe_div(debt, eq),
            "interest_coverage":  _safe_div(ebit, intx),
            "asset_turnover":     _safe_div(rev, ta),
        }
        results.append(row)

    return results


@celery_app.task(bind=True, name="worker.tasks.run_ratios")
def run_ratios(self, file_path: str, job_id: str, **kwargs) -> None:
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = pl.read_csv(file_path, ignore_errors=True)
        rows = _compute_ratios(df, **{k: v for k, v in kwargs.items()
                                       if k != "dataset_id"})
        result_df = pl.from_dicts(rows)
        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result_df.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
    except Exception as e:
        asyncio.run(update_job_status(job_id, "failed", error_message=traceback.format_exc()))
        raise e
```

- [x] **Step 4: Register run_ratios in task_map in main.py**

Add to the import and `task_map` in `create_job`:
```python
from worker.tasks import (..., run_je_test, run_ratios)   # add run_ratios
task_map = { ..., "run_ratios": run_ratios }
```

- [x] **Step 5: Run tests — expect pass**

```bash
docker compose exec api python -m pytest tests/test_ratios.py -v
```

Expected: `6 passed`.

- [x] **Step 6: Commit**

```bash
git add worker/tasks.py app/main.py tests/test_ratios.py
git commit -m "feat: add Financial Ratios Celery task with 9 ratio computations"
```

---

## Task 8: Aging Buckets Worker

**Files:**
- Modify: `worker/tasks.py`
- Create: `tests/test_aging.py`

- [x] **Step 1: Write failing tests**

```python
# tests/test_aging.py
import pytest
import polars as pl
from worker.tasks import _compute_aging


def test_current_bucket(sample_aging_df):
    # due_date 2026-03-20, reference 2026-03-23 → 3 days overdue → 1-90 bucket
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    detail = [r for r in result if r["result_type"] == "detail"]
    delta = [r for r in detail if r["party"] == "Delta Co"][0]
    assert delta["bucket"] == "1–90 days"
    assert delta["days_overdue"] == 3


def test_current_not_overdue(sample_aging_df):
    # due_date 2026-03-20 when reference is 2026-03-19 → current
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-19",
    )
    detail = [r for r in result if r["result_type"] == "detail"]
    delta = [r for r in detail if r["party"] == "Delta Co"][0]
    assert delta["bucket"] == "Current"


def test_long_overdue_bucket(sample_aging_df):
    # Gamma due 2025-06-01, reference 2026-03-23 → 295 days → 181–365 bucket
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    detail = [r for r in result if r["result_type"] == "detail"]
    gamma = [r for r in detail if r["party"] == "Gamma Inc"][0]
    assert gamma["bucket"] == "181–365 days"


def test_summary_rows_present(sample_aging_df):
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    summary = [r for r in result if r["result_type"] == "summary"]
    assert len(summary) > 0
    buckets = {r["bucket"] for r in summary}
    assert "Current" in buckets or any("days" in b for b in buckets)


def test_pct_sums_to_100(sample_aging_df):
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    summary = [r for r in result if r["result_type"] == "summary"]
    total_pct = sum(r["pct_of_total"] for r in summary)
    assert abs(total_pct - 100.0) < 0.1
```

- [x] **Step 2: Run — expect import error**

```bash
docker compose exec api python -m pytest tests/test_aging.py -v
```

- [x] **Step 3: Implement _compute_aging and run_aging**

```python
# ─── Aging Buckets ─────────────────────────────────────────────────────────

_AGING_BUCKETS = [
    ("Current",        lambda d: d <= 0),
    ("1–90 days",      lambda d: 1 <= d <= 90),
    ("91–180 days",    lambda d: 91 <= d <= 180),
    ("181–365 days",   lambda d: 181 <= d <= 365),
    ("366–730 days",   lambda d: 366 <= d <= 730),
    ("731–1095 days",  lambda d: 731 <= d <= 1095),
    ("1096+ days",     lambda d: d > 1095),
]


def _assign_bucket(days: int) -> str:
    for label, pred in _AGING_BUCKETS:
        if pred(days):
            return label
    return "1096+ days"


def _compute_aging(
    df: pl.DataFrame,
    party_col: str,
    amount_col: str,
    due_date_col: str,
    reference_date: str,
) -> list[dict]:
    """Returns list of dicts mixing summary and detail rows (result_type discriminator)."""
    import datetime

    ref = datetime.date.fromisoformat(reference_date)

    parties  = df[party_col].cast(pl.String).to_list()
    amounts  = df[amount_col].cast(pl.Float64, strict=False).to_list()
    due_dates_raw = df[due_date_col].cast(pl.String).to_list()

    detail_rows: list[dict] = []
    for i in range(len(df)):
        original = {c: df[c][i] for c in df.columns}
        try:
            due = datetime.date.fromisoformat(str(due_dates_raw[i]).split("T")[0])
            days_overdue = (ref - due).days
        except Exception:
            days_overdue = 0
        bucket = _assign_bucket(days_overdue)
        detail_rows.append({
            **original,
            "days_overdue": days_overdue,
            "bucket": bucket,
            "result_type": "detail",
            # summary-only columns are absent here (null in concat)
            "total_amount": None,
            "party_count": None,
            "pct_of_total": None,
        })

    # Build summary
    from collections import defaultdict
    bucket_totals: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0})
    for r in detail_rows:
        b = r["bucket"]
        amt = r[amount_col]
        if amt is not None:
            bucket_totals[b]["total"] += float(amt)
            bucket_totals[b]["count"] += 1

    grand_total = sum(v["total"] for v in bucket_totals.values()) or 1.0
    bucket_order = [label for label, _ in _AGING_BUCKETS]

    summary_rows: list[dict] = []
    for label in bucket_order:
        if label not in bucket_totals:
            continue
        v = bucket_totals[label]
        summary_rows.append({
            "bucket":        label,
            "total_amount":  round(v["total"], 2),
            "party_count":   v["count"],
            "pct_of_total":  round(v["total"] / grand_total * 100, 2),
            "result_type":   "summary",
            # detail-only columns are absent (null in concat)
            party_col:       None,
            amount_col:      None,
            due_date_col:    None,
            "days_overdue":  None,
        })

    return summary_rows + detail_rows


@celery_app.task(bind=True, name="worker.tasks.run_aging")
def run_aging(
    self,
    file_path: str,
    job_id: str,
    party_col: str,
    amount_col: str,
    due_date_col: str,
    reference_date: str,
    bucket_type: str = "debtor",
    **kwargs,
) -> None:
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = pl.read_csv(file_path, ignore_errors=True)
        rows = _compute_aging(df, party_col=party_col, amount_col=amount_col,
                              due_date_col=due_date_col, reference_date=reference_date)
        result_df = pl.from_dicts(rows, infer_schema_length=len(rows))
        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result_df.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
    except Exception as e:
        asyncio.run(update_job_status(job_id, "failed", error_message=traceback.format_exc()))
        raise e
```

- [x] **Step 4: Register run_aging in task_map in main.py**

Add to the import and `task_map` in `create_job`:
```python
from worker.tasks import (..., run_ratios, run_aging)   # add run_aging
task_map = { ..., "run_aging": run_aging }
```

- [x] **Step 5: Run tests — expect pass**

```bash
docker compose exec api python -m pytest tests/test_aging.py -v
```

Expected: `5 passed`.

- [x] **Step 6: Restart worker**

```bash
docker compose restart worker
```

- [x] **Step 7: Commit**

```bash
git add worker/tasks.py app/main.py tests/test_aging.py
git commit -m "feat: add Aging Buckets Celery task with 7 configurable buckets"
```

---

## Task 9: Dataset Sharing Endpoints

**Files:**
- Modify: `app/main.py`

- [x] **Step 1: Add sharing endpoints after the existing dataset endpoints**

```python
# ──────────────────────────────────────────────
# Dataset Sharing
# ──────────────────────────────────────────────

@app.get("/datasets/{dataset_id}/shares", response_model=list)
async def list_shares(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
    """List shares for a dataset. Only the owner can see their share list."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            "SELECT id, shared_with, granted_by, created_at FROM dataset_shares WHERE dataset_id = $1",
            dataset_id,
        )
    return [dict(r) for r in rows]


@app.post("/datasets/{dataset_id}/shares", response_model=dict)
async def create_share(
    dataset_id: UUID,
    shared_with: str = Body(..., embed=True),
    rls: tuple = Depends(get_user_conn),
):
    """Grant read access to another user. Only the dataset owner may call this."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        # Verify the calling user is the owner (not just a shared user)
        dataset_row = await conn.fetchrow(
            "SELECT owner FROM datasets WHERE id = $1", dataset_id
        )
        if not dataset_row:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset_row["owner"] != owner:
            raise HTTPException(status_code=403, detail="Only the dataset owner can share it")

        # Prevent duplicate shares
        existing = await conn.fetchval(
            "SELECT id FROM dataset_shares WHERE dataset_id = $1 AND shared_with = $2",
            dataset_id, shared_with,
        )
        if existing:
            raise HTTPException(status_code=409, detail="Already shared with this user")

        row = await conn.fetchrow(
            """
            INSERT INTO dataset_shares (dataset_id, shared_with, granted_by)
            VALUES ($1, $2, $3)
            RETURNING id, dataset_id, shared_with, granted_by, created_at
            """,
            dataset_id, shared_with, owner,
        )
    return dict(row)


@app.delete("/datasets/{dataset_id}/shares/{share_id}")
async def delete_share(
    dataset_id: UUID,
    share_id: UUID,
    rls: tuple = Depends(get_user_conn),
):
    """Revoke a share. Only the dataset owner may call this."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        dataset_row = await conn.fetchrow(
            "SELECT owner FROM datasets WHERE id = $1", dataset_id
        )
        if not dataset_row or dataset_row["owner"] != owner:
            raise HTTPException(status_code=403, detail="Only the dataset owner can revoke shares")
        await conn.execute(
            "DELETE FROM dataset_shares WHERE id = $1 AND dataset_id = $2",
            share_id, dataset_id,
        )
    return {"deleted": str(share_id)}
```

- [x] **Step 2: Restart API and smoke-test**

```bash
docker compose restart api
# Share a dataset (replace UUIDs with real ones)
curl -X POST http://localhost:8000/datasets/<dataset_id>/shares \
  -H "X-API-Token: dev-token" \
  -H "Content-Type: application/json" \
  -d '{"shared_with": "colleague@example.com"}'
```

Expected: `{"id": "...", "shared_with": "colleague@example.com", ...}`

- [x] **Step 3: Commit**

```bash
git add app/main.py
git commit -m "feat: add dataset sharing endpoints (RLS-enforced, owner-only)"
```

---

## Task 10: Dashboard Endpoints

**Files:**
- Modify: `app/main.py`

- [x] **Step 1: Add dashboard endpoints**

```python
# ──────────────────────────────────────────────
# Dashboard — Pinned Charts
# ──────────────────────────────────────────────

@app.get("/dashboard/pins", response_model=list)
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


@app.post("/dashboard/pins", response_model=dict)
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
        raise HTTPException(status_code=400, detail=f"chart_type must be one of {valid_chart_types}")

    rls_pool, owner = rls
    # Verify job ownership
    async with pool.acquire() as conn:
        job = await conn.fetchrow("SELECT owner FROM jobs WHERE id = $1", UUID(job_id))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["owner"] != owner:
        raise HTTPException(status_code=403, detail="You can only pin your own jobs")

    async with rls_conn(rls_pool, owner) as conn:
        # Place at end
        max_pos = await conn.fetchval("SELECT COALESCE(MAX(position), -1) FROM pinned_charts") or -1
        row = await conn.fetchrow(
            """
            INSERT INTO pinned_charts (owner, job_id, title, chart_type, config_json, position)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, job_id, title, chart_type, config_json, position, created_at
            """,
            owner, UUID(job_id), title, chart_type,
            json.dumps(config_json), max_pos + 1,
        )
    return dict(row)


@app.patch("/dashboard/pins/{pin_id}", response_model=dict)
async def update_pin(
    pin_id: UUID,
    title: str | None = Body(None, embed=True),
    position: int | None = Body(None, embed=True),
    rls: tuple = Depends(get_user_conn),
):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        if title is not None:
            await conn.execute("UPDATE pinned_charts SET title = $1 WHERE id = $2", title, pin_id)
        if position is not None:
            await conn.execute("UPDATE pinned_charts SET position = $1 WHERE id = $2", position, pin_id)
        row = await conn.fetchrow(
            "SELECT id, job_id, title, chart_type, config_json, position FROM pinned_charts WHERE id = $1",
            pin_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Pin not found")
    return dict(row)


@app.delete("/dashboard/pins/{pin_id}")
async def delete_pin(pin_id: UUID, rls: tuple = Depends(get_user_conn)):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        await conn.execute("DELETE FROM pinned_charts WHERE id = $1", pin_id)
    return {"deleted": str(pin_id)}
```

- [x] **Step 2: Restart and smoke-test**

```bash
docker compose restart api
curl http://localhost:8000/dashboard/pins -H "X-API-Token: dev-token"
```

Expected: `[]` (empty list).

- [x] **Step 3: Commit**

```bash
git add app/main.py
git commit -m "feat: add dashboard pin endpoints (RLS-enforced, job ownership validated)"
```

---

## Task 11: Frontend — New Analysis Tabs

**Files:**
- Create: `src/tabs/JeTestTab.tsx`
- Create: `src/tabs/RatiosTab.tsx`
- Create: `src/tabs/AgingTab.tsx`
- Create: `src/components/AiInsightPanel.tsx`
- Modify: `src/App.tsx`

> These tabs follow the established pattern in `App.tsx`. Study the existing `OutliersTab` or `TimeseriesTab` section in `App.tsx` for the exact pattern: column-mapper state → submit job → poll → render recharts.

- [x] **Step 1: Create AiInsightPanel component**

```tsx
// src/components/AiInsightPanel.tsx
import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  jobId: string;
}

export const AiInsightPanel: React.FC<Props> = ({ jobId }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const explain = async () => {
    setOpen(true);
    setLoading(true);
    setText('');
    try {
      const resp = await fetch(`/ai/explain/${jobId}`, {
        method: 'POST',
        headers: { 'X-API-Token': (import.meta.env.VITE_API_AUTH_TOKEN || 'dev-token').trim() },
      });
      if (!resp.ok || !resp.body) { setText('AI service unavailable.'); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const token = line.slice(6);
            if (token === '[DONE]') break;
            setText(prev => prev + token);
          }
        }
      }
    } catch (e) {
      setText('Error connecting to AI service.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 border border-border rounded-xl overflow-hidden">
      <button
        onClick={open ? () => setOpen(false) : explain}
        className="w-full flex items-center gap-2 px-4 py-3 bg-surf hover:bg-sub/30 transition-colors text-sm font-medium text-tx"
      >
        <Sparkles size={14} className="text-acc" />
        AI Insight
        {open ? <ChevronUp size={14} className="ml-auto text-tx3" /> : <ChevronDown size={14} className="ml-auto text-tx3" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 bg-surf text-sm text-tx2 leading-relaxed whitespace-pre-wrap">
          {loading && !text ? (
            <span className="text-tx3 animate-pulse">Analysing...</span>
          ) : text || <span className="text-tx3">No content yet.</span>}
        </div>
      )}
    </div>
  );
};
```

- [x] **Step 2: Create JeTestTab.tsx**

```tsx
// src/tabs/JeTestTab.tsx
// Pattern: column mapper → POST /jobs (run_je_test) → poll → render flagged table + bar chart
// Follow existing tab pattern from App.tsx (e.g. the run_outliers tab section).
// Key state: dateCol, amountCol, accountCol, preparerCol (optional), narrationCol (optional),
//            largeAmountThreshold (default 100000), activeJobId, jobStatus, resultData.
// On submit: POST to /jobs?task_name=run_je_test with params in body.
// On complete: GET /query with "SELECT * FROM RESULT_TABLE WHERE is_flagged = true LIMIT 500".
// Summary bar chart: count flags from results, render BarChart from recharts.
// Show <AiInsightPanel jobId={activeJobId} /> when job completes.
// Column mapper renders dropdowns populated from props.columns (existing pattern).
```

> Write the full component following the pattern established by the existing analysis tab sections in `App.tsx`. The above comment describes the required state, API calls, and UI elements. Refer to the existing `run_outliers` UI section in `App.tsx` lines ~800–1000 for exact implementation pattern.

- [x] **Step 3: Create RatiosTab.tsx**

```tsx
// src/tabs/RatiosTab.tsx
// Mapper for: period (optional), revenue, cogs, gross_profit, net_income, ebit,
//             interest_expense, current_assets, current_liabilities, inventory,
//             total_assets, total_debt, equity — all dropdowns, all optional except one pair.
// On complete: GET /query "SELECT * FROM RESULT_TABLE".
// Single period: scorecard grid (ratio name + value).
// Multi-period: LineChart (recharts) with one line per ratio, period on X axis.
// Show <AiInsightPanel /> on completion.
```

- [x] **Step 4: Create AgingTab.tsx**

```tsx
// src/tabs/AgingTab.tsx
// Mapper: party_col, amount_col, due_date_col (all required), reference_date (date picker, default today).
// bucket_type radio: Debtor | Creditor.
// On complete:
//   Summary query: "SELECT * FROM RESULT_TABLE WHERE result_type = 'summary'"
//   → BarChart with bucket on X axis, total_amount on Y.
//   Detail query: "SELECT * FROM RESULT_TABLE WHERE result_type = 'detail' LIMIT 500"
//   → filterable table.
//   Top 10 by amount: sorted detail rows.
// Show <AiInsightPanel /> on completion.
```

- [x] **Step 5: Register tabs and add type gating in App.tsx**

In `App.tsx`, update the `TabType` union and `ANALYSIS_TABS` array:

```typescript
type TabType = 'upload' | 'dataview' | 'benford' | 'outliers' | 'timeseries'
             | 'clustering' | 'network' | 'workbench' | 'profile'
             | 'je_test' | 'ratios' | 'aging' | 'dashboard'; // new

// Add to ANALYSIS_TABS:
{ id: 'je_test', label: 'JE Testing', icon: FileText },
{ id: 'ratios',  label: 'Ratios',     icon: BarChart3 },
{ id: 'aging',   label: 'Aging',      icon: Clock },
```

Add tab gating logic — near where `activeFile` is used to render tab content:

```typescript
const DATASET_TYPE_GATES: Partial<Record<TabType, string[]>> = {
  je_test: ['journal_entries'],
  ratios:  ['financial_statements'],
  aging:   ['debtors_creditors'],
};

// In the tab rendering, disable gated tabs if dataset_type doesn't match:
const isTabEnabled = (tabId: TabType): boolean => {
  const gate = DATASET_TYPE_GATES[tabId];
  if (!gate) return true;
  return gate.includes(activeFile?.dataset_type ?? 'general');
};
```

Add dataset_type display + override dropdown in the DataView tab. Add type override to FileMetadata interface:
```typescript
interface FileMetadata {
  // ... existing fields ...
  dataset_type?: string;
}
```

Render the three new tab components in the main content area switch/conditional.

- [x] **Step 6: Add SQL Copilot to Workbench tab**

In the existing workbench section of `App.tsx`, add above the CodeEditor:

```tsx
{/* SQL Copilot */}
<div className="flex gap-2 mb-2">
  <input
    type="text"
    placeholder="Describe what you want in plain English..."
    value={sqlPrompt}
    onChange={e => setSqlPrompt(e.target.value)}
    className="flex-1 px-3 py-2 text-sm bg-sub border border-border rounded-lg text-tx placeholder-tx3"
  />
  <button
    onClick={async () => {
      const tables = workbenchTables.map(t => ({
        name: t.table_name,
        columns: (t.columns as any[]).map((c: any) => c.name),
      }));
      const resp = await api.post('/ai/sql-assist', { prompt: sqlPrompt, tables });
      setSql(resp.data.sql);
    }}
    className="px-3 py-2 text-sm bg-acc text-white rounded-lg hover:bg-acc/90"
  >
    Generate SQL
  </button>
</div>
```

Add state: `const [sqlPrompt, setSqlPrompt] = useState('');`

- [x] **Step 7: Rebuild frontend**

```bash
docker compose exec frontend npm run build
# Or if using hot-reload dev server, just save the files
```

- [x] **Step 8: Commit**

```bash
git add src/tabs/ src/components/ src/App.tsx
git commit -m "feat: add JE Test, Ratios, Aging tabs with type gating, AI panel, SQL copilot"
```

---

## Task 12: Frontend — Dashboard Tab + Share Modal

**Files:**
- Create: `src/tabs/DashboardTab.tsx`
- Create: `src/components/ShareModal.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: Create ShareModal.tsx**

```tsx
// src/components/ShareModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Lock, Trash2 } from 'lucide-react';
import axios from 'axios';

const api = axios.create({
  baseURL: '/',
  headers: { 'X-API-Token': (import.meta.env.VITE_API_AUTH_TOKEN || 'dev-token').trim() },
});

interface Share { id: string; shared_with: string; created_at: string; }

interface Props {
  datasetId: string;
  datasetName: string;
  currentUser: string;
  onClose: () => void;
}

export const ShareModal: React.FC<Props> = ({ datasetId, datasetName, currentUser, onClose }) => {
  const [email, setEmail] = useState('');
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const resp = await api.get(`/datasets/${datasetId}/shares`);
    setShares(resp.data);
  };

  useEffect(() => { load(); }, [datasetId]);

  const grant = async () => {
    if (!email.trim()) return;
    setLoading(true); setError('');
    try {
      await api.post(`/datasets/${datasetId}/shares`, { shared_with: email.trim() });
      setEmail('');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to share');
    } finally { setLoading(false); }
  };

  const revoke = async (shareId: string) => {
    await api.delete(`/datasets/${datasetId}/shares/${shareId}`);
    await load();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-surf border border-border rounded-2xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-acc" />
            <h2 className="text-sm font-semibold text-tx">Share — {datasetName}</h2>
          </div>
          <button onClick={onClose}><X size={16} className="text-tx3" /></button>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="email"
            placeholder="colleague@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && grant()}
            className="flex-1 px-3 py-2 text-sm bg-sub border border-border rounded-lg text-tx"
          />
          <button
            onClick={grant}
            disabled={loading}
            className="px-3 py-2 text-sm bg-acc text-white rounded-lg disabled:opacity-50"
          >
            {loading ? '...' : 'Grant'}
          </button>
        </div>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        {shares.length > 0 && (
          <ul className="space-y-2">
            {shares.map(s => (
              <li key={s.id} className="flex items-center justify-between text-xs text-tx2 bg-sub rounded-lg px-3 py-2">
                <span>{s.shared_with}</span>
                <button onClick={() => revoke(s.id)}>
                  <Trash2 size={13} className="text-tx3 hover:text-red-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {shares.length === 0 && (
          <p className="text-xs text-tx3 text-center py-2">Not shared with anyone yet.</p>
        )}
      </div>
    </div>
  );
};
```

- [x] **Step 2: Create DashboardTab.tsx**

```tsx
// src/tabs/DashboardTab.tsx
// State: pins (from GET /dashboard/pins), each pin has job_id, title, chart_type, config_json.
// On mount: load pins.
// Render: 2-column grid using CSS grid.
// Each card:
//   - Title (editable inline on click — PATCH /dashboard/pins/{id})
//   - Mini recharts chart (BarChart/LineChart/AreaChart/ScatterChart based on chart_type)
//     → fetch chart data via POST /query with "SELECT * FROM RESULT_TABLE LIMIT 100"
//   - "View full" link → navigate to source tab (?tab=<task_name_tab>&job_id=<id>)
//   - Delete button → DELETE /dashboard/pins/{id}
// Drag-to-reorder: wrap list in <Reorder.Group> from framer-motion (already imported in App.tsx).
//   On reorder: PATCH each pin's new position.
// Empty state message if no pins.
// "Pin to Dashboard" button: rendered in each analysis result section in App.tsx.
//   Opens a small inline modal: title input + chart_type select → POST /dashboard/pins.

// NOTE: DashboardTab receives no file/dataset prop — it is always available.
```

> Write the full component following the above description. The `Reorder` component from `framer-motion` is already imported in `App.tsx` — import it similarly here.

- [x] **Step 3: Add ShareModal and DashboardTab to App.tsx**

In `App.tsx`:
1. Import `ShareModal` and `DashboardTab`
2. Add state: `const [shareDataset, setShareDataset] = useState<FileMetadata | null>(null);`
3. In the dataset list (DataView tab), add a share icon button per row for datasets owned by `currentUser`. On click: `setShareDataset(dataset)`.
4. Conditionally render `<ShareModal>` when `shareDataset` is set.
5. Add `dashboard` to the main navigation tabs (always visible, not in the analysis dropdown).
6. Render `<DashboardTab />` when `activeTab === 'dashboard'`.
7. In each analysis result section, add a "Pin to Dashboard" button that posts to `/dashboard/pins`.

- [x] **Step 4: Handle URL-param tab navigation**

In `App.tsx`'s `useEffect` on mount:

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab') as TabType | null;
  const jobParam = params.get('job_id');
  if (tabParam) setActiveTab(tabParam);
  if (jobParam) setPreloadJobId(jobParam);  // new state, passed to relevant tabs
}, []);
```

Add `preloadJobId` state and pass it to the relevant tab components so they can auto-load a previous result.

- [x] **Step 5: Rebuild and smoke-test**

```bash
docker compose exec frontend npm run build
# or just save with hot-reload
```

Navigate to the app, upload a file, run an analysis, pin it, check the Dashboard tab.

- [x] **Step 6: Commit**

```bash
git add src/tabs/DashboardTab.tsx src/components/ShareModal.tsx src/App.tsx
git commit -m "feat: add Dashboard tab with pinned charts, ShareModal, URL-param navigation"
```

---

## Task 13: Run Full Test Suite + Final Smoke Test

- [x] **Step 1: Run all tests**

```bash
docker compose exec api python -m pytest tests/ -v
```

Expected: all tests pass. Fix any failures before proceeding.

- [x] **Step 2: Verify all new endpoints are reachable**

```bash
# Check API docs (FastAPI auto-docs)
curl http://localhost:8000/openapi.json | python3 -m json.tool | grep '"operationId"'
```

Verify you see `run_je_test`, `run_ratios`, `run_aging` in the task_map by submitting a test job.

- [x] **Step 3: End-to-end smoke test**

1. Upload a journal entries CSV → verify `dataset_type` updates to `journal_entries` after a few seconds (background task)
2. Navigate to JE Test tab → run analysis → verify results table with flag badges
3. Click "Explain findings" → verify AI insight panel streams text
4. Pin the result → navigate to Dashboard → verify chart card appears
5. Share the dataset with a test email → verify share appears in list

- [x] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete feature expansion — JE Testing, Ratios, Aging, AI copilot, sharing, dashboard"
```

---

## Quick Reference

### Running tests
```bash
docker compose exec api python -m pytest tests/ -v
```

### Applying migration to running DB
```bash
docker compose exec postgres psql -U postgres -d analytics -f /docker-entrypoint-initdb.d/003_features.sql
```

### Restarting services after backend changes
```bash
docker compose restart api worker
```

### Checking Ollama model
```bash
docker compose exec ollama ollama list
```

### Key environment variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_URL` | `http://ollama:11434` | Ollama service URL |
| `DATABASE_URL` | set in .env | Primary DB connection |
| `APP_DB_USER` | `analytics_app` | RLS-respecting DB role |
