# Data Analytics Tool — Feature Expansion Design

**Date:** 2026-03-23
**Status:** Approved for implementation
**Scope:** Balanced approach — new analysis types, dataset sharing, dashboard, AI copilot

---

## 1. Overview

This document specifies seven features to be added to the existing `data_analytics` in-house tool. The tool is used by an audit/CA firm (Varma & Varma) and runs on a FastAPI + Celery + PostgreSQL + React stack.

The features address three gaps:
- **More analysis types** — Journal Entry Testing, Financial Ratios, Aging Buckets
- **Collaboration** — Dataset sharing between Authentik users
- **Richer visuals** — Dashboard with pinned chart cards
- **AI assistance** — Local Ollama LLM for analysis explanation, SQL generation, and dataset classification

No new services are required except Ollama. All analysis types follow the existing Celery task pattern (Parquet output, `update_job_status` pattern). All UI additions follow the existing tab pattern in `App.tsx`.

---

## 2. Dataset Type Detection

### Purpose
Gate context-sensitive analysis tabs based on what kind of data is loaded. Prevents users from running irrelevant analyses and guides them to the right tool.

### Implementation

**New field:** `dataset_type TEXT DEFAULT 'general'` column added to the `datasets` table (see §9).

**Detection flow:** The upload handler (`POST /upload`) returns immediately after ingestion with `dataset_type: "general"` as the default. Classification is done in a **FastAPI `BackgroundTask`** so the upload response is never delayed. The background task calls `_classify_dataset(dataset_id, col_names, sample_values)`, which attempts the Ollama call (10s timeout) then falls back to heuristics, and issues `UPDATE datasets SET dataset_type = $1 WHERE id = $2`. The frontend polls `GET /datasets/{id}` or can receive the final type on next page load.

**`_classify_dataset` is a shared Python function** in `app/main.py` (not an HTTP endpoint called server-to-server). It accepts column names and a sample dict, queries Ollama via `httpx.AsyncClient`, and returns one of the four type strings.

**Ollama prompt:**
```
You are a data classification assistant. Given these column names and sample values from a dataset, classify the dataset as exactly one of: journal_entries, financial_statements, debtors_creditors, general.

Columns and samples:
{column_samples}

Respond with only the classification label, nothing else.
```

**Fallback heuristics** (if Ollama unavailable):

| Type | Column name signals |
|------|-------------------|
| `journal_entries` | date + (amount\|debit\|credit) + (account\|ledger\|narration\|voucher) |
| `financial_statements` | (period\|year\|quarter) + ≥4 numeric columns with financial keywords |
| `debtors_creditors` | (party\|name\|customer\|vendor) + (amount\|balance) + (due_date\|invoice_date) |
| `general` | anything else |

**User override:** `PATCH /datasets/{id}` with `{"dataset_type": "..."}` — new endpoint (see §9 API additions). Updates `dataset_type` in the DB. Uses `rls_conn` so only the owner can update their own dataset.

### UI Tab Gating

| Tab | Enabled for |
|-----|------------|
| JE Testing | `journal_entries` |
| Financial Ratios | `financial_statements` |
| Aging | `debtors_creditors` |
| Benford, Outliers, Timeseries, Clustering, Network | `journal_entries`, `debtors_creditors`, `general` |
| Profile | always |
| Dashboard, Workbench | always |

Disabled tabs show a tooltip: *"Load a [required dataset type] to use this analysis."*

---

## 3. Journal Entry Testing

### Purpose
Flag suspicious journal entries for auditor review. Surfaces common fraud and error patterns without requiring manual inspection of every entry.

### Worker Task: `run_je_test`

**Must be added to the `task_map` in `app/main.py`** alongside the existing tasks.

**Input parameters:**
- `file_path` — path to the uploaded file
- `job_id`
- `date_col` — column containing posting date
- `amount_col` — column containing amount
- `account_col` — column containing account/ledger name
- `preparer_col` — (optional) column containing user/preparer
- `narration_col` — (optional) column containing description/narration
- `large_amount_threshold` — (optional, default: 100000)

**Checks performed:**

| Flag | Logic | Notes |
|------|-------|-------|
| `weekend_posting` | `date_col` falls on Saturday or Sunday | |
| `end_of_period` | `date_col` is in the last 3 days of any calendar month | |
| `round_number` | `abs(amount_col)` divisible by 1,000 and > 0 | |
| `large_amount` | `abs(amount_col)` > `large_amount_threshold` | |
| `rare_combo` | (preparer + account) combination appears < 2 times | If `preparer_col` is None, falls back to account-only rarity (account appearing < 2 times) |
| `duplicate_narration_diff_amount` | Same `narration_col` value with different `amount_col` values | Skipped entirely if `narration_col` is None |
| `same_day_reversal` | Same `account_col` + same `abs(amount_col)` + opposite sign on same `date_col` | **Guard: skip rows where `amount_col == 0`** to avoid spurious self-matches on zero-amount entries |

**Output:** One row per JE with all original columns plus:
- `flags` — comma-separated list of triggered flag names (empty string if none)
- `flag_count` — integer count of flags (risk score)
- `is_flagged` — boolean (`flag_count > 0`)

Result written as **Parquet** (`.parquet`) using `write_parquet()` — consistent with all other tasks. **Not CSV.**

### API
Uses existing `POST /jobs` — `run_je_test` must be added to the `task_map` dict in `app/main.py`.

### UI: JE Test Tab
- Column mapper: dropdowns to assign date, amount, account, preparer (optional), narration (optional) columns + large amount threshold input
- Run button → polls job status (existing polling pattern)
- Results: filterable table with `is_flagged=true` filter pre-selected, flag badges per row
- Summary bar at top: count of flagged entries per flag type (horizontal bar chart using recharts `BarChart`)
- "Explain findings" button → calls `POST /ai/explain/{job_id}` (see §6.2)

---

## 4. Financial Ratios

### Purpose
Compute standard financial ratios from a balance sheet / P&L dataset. Supports single-period scorecard and multi-period trend view.

### Worker Task: `run_ratios`

**Must be added to the `task_map` in `app/main.py`.**

**Input parameters:**
- `file_path`
- `job_id`
- `period_col` — (optional) column for period grouping
- Column mappings (all optional — unmapped ratios are skipped gracefully):
  - `revenue_col`, `cogs_col`, `gross_profit_col`
  - `net_income_col`, `ebit_col`, `interest_expense_col`
  - `current_assets_col`, `current_liabilities_col`, `inventory_col`
  - `total_assets_col`, `total_debt_col`, `equity_col`

**Ratios computed:**

| Category | Ratio | Formula | Columns required |
|----------|-------|---------|-----------------|
| Liquidity | Current Ratio | current_assets / current_liabilities | `current_assets_col`, `current_liabilities_col` |
| Liquidity | Quick Ratio | (current_assets − inventory) / current_liabilities | above + `inventory_col`; if `inventory_col` is None, Quick Ratio is approximated as Current Ratio and labelled as approximate |
| Profitability | Gross Margin % | gross_profit / revenue × 100 | `gross_profit_col`, `revenue_col` |
| Profitability | Net Margin % | net_income / revenue × 100 | `net_income_col`, `revenue_col` |
| Profitability | Return on Equity | net_income / equity × 100 | `net_income_col`, `equity_col` |
| Profitability | Return on Assets | net_income / total_assets × 100 | `net_income_col`, `total_assets_col` |
| Leverage | Debt-to-Equity | total_debt / equity | `total_debt_col`, `equity_col` |
| Leverage | Interest Coverage | ebit / interest_expense | `ebit_col`, `interest_expense_col` |
| Efficiency | Asset Turnover | revenue / total_assets | `revenue_col`, `total_assets_col` |

Division by zero → `null` (ratio skipped, not an error).

**Output:** One row per period (or one row if no `period_col`) with ratio names as columns. Written as **Parquet**.

### UI: Ratios Tab
- Column mapper for each line item
- Single-period view: scorecard grid (ratio name, value, common benchmark reference)
- Multi-period view: line chart per ratio category (recharts `LineChart` — already in codebase)
- "Explain findings" button → calls `POST /ai/explain/{job_id}`

---

## 5. Aging Buckets

### Purpose
Compute debtor/creditor aging — how long outstanding balances have been overdue — and surface concentration risk.

### Worker Task: `run_aging`

**Must be added to the `task_map` in `app/main.py`.**

**Input parameters:**
- `file_path`
- `job_id`
- `party_col` — debtor/creditor name
- `amount_col` — outstanding balance
- `due_date_col` — due date (or invoice date if no due date)
- `reference_date` — **required, passed by the frontend at job submission time** (ISO date string, e.g. `"2026-03-23"`). The frontend always sends today's date. Using worker execution time as default would introduce staleness risk for queued jobs — do not fall back to `datetime.date.today()` in the worker.
- `bucket_type` — `debtor | creditor`

**Aging buckets:**

| Bucket | Days overdue |
|--------|-------------|
| Current | Not yet due (days_overdue ≤ 0) |
| 1–90 days | 1–90 |
| 91–180 days | 91–180 |
| 181–365 days | 181–365 |
| 366–730 days | 366–730 |
| 731–1095 days | 731–1095 |
| 1096+ days | > 1095 |

**Output — single Parquet with a `result_type` discriminator column:**

The result file uses a `result_type TEXT` column (`'summary'` or `'detail'`) to distinguish the two logical result sets. Columns not applicable to a given result type are `null`.

- **Summary rows** (`result_type = 'summary'`): `result_type`, `bucket`, `total_amount`, `party_count`, `pct_of_total`. All other columns null.
- **Detail rows** (`result_type = 'detail'`): all original columns + `days_overdue` (integer), `bucket` (string), `result_type`. Summary-only columns null.

**UI queries use `WHERE result_type = 'summary'`** or `WHERE result_type = 'detail'` to retrieve the appropriate slice. This fits the existing DuckDB `/query` endpoint with `RESULT_TABLE` substitution.

### UI: Aging Tab
- Column mapper + bucket type selector + reference date picker
- Summary: stacked bar chart by bucket (recharts `BarChart`)
- Detail: filterable table with bucket filter
- Concentration panel: top 10 parties by overdue amount
- "Explain findings" button → calls `POST /ai/explain/{job_id}`

---

## 6. Ollama AI Integration

### Deployment

New service in `docker-compose.yml`:

```yaml
ollama:
  image: ollama/ollama:latest
  container_name: ollama
  volumes:
    - ollama_data:/root/.ollama
  restart: unless-stopped
  networks:
    - internal   # Use the same internal network name already defined in docker-compose.yml
                 # Do NOT add to the external `proxy` network — Ollama must not be reachable from Traefik
```

Model pulled on container first-start via an `entrypoint` wrapper or `docker-compose` post-start hook:
```bash
ollama pull qwen3.5:9b
```

Ollama is reachable at `http://ollama:11434` from FastAPI and Celery workers. Not exposed externally.

All AI calls use `httpx.AsyncClient` from FastAPI (sync `httpx.Client` from Celery workers where needed).

### 6.1 Dataset Classifier (internal function, not a public endpoint)

`_classify_dataset(col_names: list[str], samples: dict[str, list]) -> str`

Called directly within the `POST /upload` handler after ingestion. Not an HTTP endpoint. See §2 for full details.

### 6.2 Analysis Explainer (`POST /ai/explain/{job_id}`)

**Authorization:** Uses the `owner TEXT` column added to `jobs` (see §9). The `POST /jobs` handler must be updated to write `owner = <current_user>` into the INSERT. The explainer endpoint queries `jobs` using the **admin pool** (no RLS on `jobs`), then checks `job["owner"] == current_user` explicitly before proceeding. If the job is not owned by the requesting user, returns 403.

**Response pattern:** Uses `fastapi.responses.StreamingResponse` with `media_type="text/event-stream"` and `Content-Type: text/event-stream`. Each token from Ollama's streaming response is forwarded as an SSE event:

```
data: <token>\n\n
```

Frontend uses the browser `EventSource` API (or `fetch` with `ReadableStream`) to receive tokens and appends them into a collapsible "AI Insight" panel.

**Prompt construction:** Reads the job's Parquet summary (not raw rows). Task-specific prompts:

- **JE Test:** flag counts per type, total flagged vs total entries, top 3 flagged accounts
- **Ratios:** ratio values and period-over-period delta if multi-period
- **Aging:** bucket totals, top 5 overdue parties, % of total in 90+ days bucket
- **Other tasks:** column stats from the result (min, max, mean, null count)

Maximum ~10,000 tokens of context sent to the model. Response capped at 8000 tokens.

### 6.3 SQL Copilot (`POST /ai/sql-assist`)

**Request:**
```json
{ "prompt": "string", "tables": [{ "name": "datasets.ds_<hex>", "columns": ["col1", "col2"] }] }
```

**Response:**
```json
{ "sql": "SELECT ..." }
```

**Not streaming** — waits for the full SQL response (typically < 2s for a short query).

**Prompt template:**
```
You are a PostgreSQL SQL assistant. Generate a single SELECT query.
Available tables (always prefix table names with their schema):
{table_list_with_full_schema_qualified_names}

User request: {user_prompt}

Rules:
- Always use the full schema-qualified table name (e.g. datasets.ds_abc123)
- Return only the SQL query, no explanation, no markdown fences
- Only SELECT statements
```

Frontend: natural language input above the SQL editor + "Generate SQL" button. Response replaces editor content (editor's built-in undo stack preserves prior content).

---

## 7. Dataset Sharing

### Purpose
Allow dataset owners to grant read access to other Authentik users.

### Schema

```sql
CREATE TABLE dataset_shares (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    shared_with TEXT NOT NULL,
    granted_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Row-level security on dataset_shares
ALTER TABLE dataset_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY dataset_shares_owner ON dataset_shares
    USING (granted_by = current_setting('app.active_user', true));
```

### RLS Policy Update on `datasets`

```sql
-- Drop and recreate the datasets RLS policy to add the OR clause
DROP POLICY IF EXISTS datasets_owner ON datasets;
CREATE POLICY datasets_owner ON datasets
    USING (
        owner = current_setting('app.active_user', true)
        OR id IN (
            SELECT dataset_id FROM dataset_shares
            WHERE shared_with = current_setting('app.active_user', true)
        )
    );
```

Shared users get read access only. The `WITH CHECK` clause on the `datasets_owner` policy restricts all writes (UPDATE/DELETE) to the owner. The `GET /datasets/{id}/shares` endpoint returns the share list only to the owner (the `dataset_shares_owner` policy gates reads by `granted_by`). Shared users will not see the share list — they see only the dataset itself. A "shared with you" indicator in the UI is derived from comparing `dataset.owner != current_user.email`.

### API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/datasets/{id}/shares` | rls_conn (owner sees their dataset) | List current shares |
| POST | `/datasets/{id}/shares` | rls_conn + explicit owner check | Add a share (owner only) |
| DELETE | `/datasets/{id}/shares/{share_id}` | rls_conn | Remove a share (owner only via RLS policy) |

`POST /datasets/{id}/shares` **must explicitly verify ownership** before inserting: fetch `SELECT owner FROM datasets WHERE id = $1` (via `rls_conn` — a shared user can see the row, so follow up with `if row["owner"] != current_user: raise 403`). Do not rely solely on the `dataset_shares` RLS policy, which would incorrectly allow a shared user to create shares by setting `granted_by` to themselves.

### UI

In the Data View tab, a "Share" button (lock icon) on each dataset the current user owns. Opens a modal: email input + "Grant Access" button. Existing shares listed with revoke (×) button. No permission levels in v1.

---

## 8. Dashboard

### Purpose
Let users pin completed analysis results as chart cards to a personal dashboard.

### Schema

```sql
CREATE TABLE pinned_charts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner       TEXT NOT NULL,
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    chart_type  TEXT NOT NULL,  -- bar | line | area | scatter
    config_json JSONB,
    position    INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS on pinned_charts
ALTER TABLE pinned_charts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pinned_charts_owner ON pinned_charts
    USING (owner = current_setting('app.active_user', true));
```

### API

All dashboard endpoints use `rls_conn` to enforce per-user isolation via the RLS policy above.

`POST /dashboard/pins` must verify that the referenced `job_id` belongs to the requesting user before inserting: `SELECT owner FROM jobs WHERE id = $1` (admin pool), then assert `job["owner"] == current_user`. Returns 403 if the job is not owned by the requester.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard/pins` | List current user's pinned charts |
| POST | `/dashboard/pins` | Pin a chart (validates job ownership first) |
| PATCH | `/dashboard/pins/{id}` | Update title or position |
| DELETE | `/dashboard/pins/{id}` | Unpin |

### UI: Dashboard Tab

- 2-column responsive grid of chart cards
- Each card: title (editable inline), mini recharts chart rendered from the job's Parquet summary, "View full analysis" link
- **"View full analysis" navigation:** encoded as a URL query string `?tab=<tab_id>&job_id=<job_id>`. The React app reads these on mount and navigates to the correct tab with the job pre-loaded. Tab components already receive a `selectedJobId` prop pattern — extend it to accept URL param initialisation.
- "Pin to Dashboard" button on every completed analysis result — opens a small modal for title + chart type
- Drag-to-reorder via `framer-motion/Reorder` (already in codebase) — saves new positions via PATCH
- Empty state: *"No pinned charts yet. Run an analysis and pin the result."*

---

## 9. Database Migrations & API Additions

### New SQL (run in order)

```sql
-- 1. Dataset type detection
ALTER TABLE datasets ADD COLUMN dataset_type TEXT NOT NULL DEFAULT 'general';

-- 2. Owner tracking on jobs (needed for AI explainer auth and dashboard pin validation)
--    The POST /jobs handler must also be updated to include owner in the INSERT:
--    INSERT INTO jobs (status, task_name, client_id, dataset_id, owner) VALUES (...)
ALTER TABLE jobs ADD COLUMN owner TEXT;

-- 3. Dataset sharing
CREATE TABLE dataset_shares (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    shared_with TEXT NOT NULL,
    granted_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE dataset_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY dataset_shares_owner ON dataset_shares
    USING (granted_by = current_setting('app.active_user', true));

-- 4. Update datasets RLS policy to include shares
-- USING allows reads (SELECT) for both owners and shared users
-- WITH CHECK restricts INSERT/UPDATE to owners only
-- A separate FOR DELETE policy restricts DELETE to owners only
-- (WITH CHECK does not apply to DELETE in PostgreSQL)
DROP POLICY IF EXISTS datasets_owner ON datasets;
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

-- Separate DELETE policy — owner only (WITH CHECK does not apply to DELETE)
DROP POLICY IF EXISTS datasets_owner_delete ON datasets;
CREATE POLICY datasets_owner_delete ON datasets
    FOR DELETE
    USING (owner = current_setting('app.active_user', true));

-- 5. Dashboard pins
CREATE TABLE pinned_charts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner       TEXT NOT NULL,
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    chart_type  TEXT NOT NULL,
    config_json JSONB,
    position    INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE pinned_charts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pinned_charts_owner ON pinned_charts
    USING (owner = current_setting('app.active_user', true));
```

### New API Endpoints

| Method | Endpoint | Notes |
|--------|----------|-------|
| PATCH | `/datasets/{id}` | Update `dataset_type`; uses `rls_conn` |
| GET | `/datasets/{id}/shares` | List shares; uses `rls_conn` |
| POST | `/datasets/{id}/shares` | Add share; uses `rls_conn` |
| DELETE | `/datasets/{id}/shares/{share_id}` | Remove share; uses `rls_conn` |
| POST | `/ai/explain/{job_id}` | SSE streaming; verifies `jobs.owner` |
| POST | `/ai/sql-assist` | Synchronous; returns `{ "sql": "..." }` |
| GET | `/dashboard/pins` | Uses `rls_conn` |
| POST | `/dashboard/pins` | Uses `rls_conn` |
| PATCH | `/dashboard/pins/{id}` | Uses `rls_conn` |
| DELETE | `/dashboard/pins/{id}` | Uses `rls_conn` |

### `task_map` in `app/main.py`

Add the three new tasks to the existing `task_map` dict (lines 554–565):

```python
from worker.tasks import (
    ...,          # existing imports
    run_je_test,
    run_ratios,
    run_aging,
)

task_map = {
    ...,          # existing entries
    "run_je_test": run_je_test,
    "run_ratios":  run_ratios,
    "run_aging":   run_aging,
}
```

---

## 10. Out of Scope (v1)

- Dashboard sharing between users
- Ollama chat over raw dataset rows (only summaries sent to the model)
- Image/scanned PDF analysis via Ollama multimodal capability
- Inventory days / debtor days ratios (overlap with Aging — deferred)
- Role-based share permissions (read-only vs edit)
- Job deletion endpoint (cascade from `pinned_charts` is safe but dormant until then)

---

## 11. Implementation Order

1. **Database migrations** (§9) — all schema changes first
2. **Ollama Docker service** + model pull (`qwen3.5:9b`) (§6)
3. **Dataset type detection** — `_classify_dataset` function + heuristic fallback + `PATCH /datasets/{id}` + upload handler integration (§2, §6.1)
4. **Journal Entry Testing** worker + task_map registration + UI tab (§3)
5. **Financial Ratios** worker + task_map registration + UI tab (§4)
6. **Aging Buckets** worker + task_map registration + UI tab (§5)
7. **SQL Copilot** endpoint + workbench UI (§6.3)
8. **Analysis Explainer** endpoint + SSE frontend integration (§6.2)
9. **Dataset Sharing** endpoints + Data View UI (§7)
10. **Dashboard** endpoints + Dashboard tab (§8)
