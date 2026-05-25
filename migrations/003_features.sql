-- migrations/003_features.sql
-- Feature expansion: dataset types, sharing, dashboard, AI job ownership

-- ── 1. Dataset type classification ─────────────────────────────────────────
ALTER TABLE datasets
    ADD COLUMN IF NOT EXISTS dataset_type TEXT NOT NULL DEFAULT 'general';

-- ── 2. Owner column on datasets (needed for RLS) ───────────────────────────
ALTER TABLE datasets
    ADD COLUMN IF NOT EXISTS owner TEXT;

-- ── 3. Owner tracking on jobs (needed for AI explainer auth) ───────────────
-- POST /jobs handler must write owner = current_user into this column.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS owner TEXT;

-- ── 4. Dataset sharing ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dataset_shares (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    shared_with TEXT NOT NULL,   -- grantee Authentik email
    granted_by  TEXT NOT NULL,   -- owner Authentik email
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (dataset_id, shared_with)
);

-- Owner can manage shares; grantee can read shares directed at them.
-- WITH CHECK: only owner can insert/update share rows.
ALTER TABLE dataset_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dataset_shares_owner ON dataset_shares;
CREATE POLICY dataset_shares_owner ON dataset_shares
    USING (
        granted_by  = current_setting('app.active_user', true)
        OR shared_with = current_setting('app.active_user', true)
    )
    WITH CHECK (
        granted_by = current_setting('app.active_user', true)
    );

-- ── 5. Update datasets RLS ─────────────────────────────────────────────────
-- Enable RLS (idempotent — safe to run on both fresh and existing databases)
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;

-- Drop pre-existing policies so we can replace them cleanly
DROP POLICY IF EXISTS datasets_owner_policy ON datasets;
DROP POLICY IF EXISTS datasets_owner        ON datasets;
DROP POLICY IF EXISTS datasets_owner_delete ON datasets;

-- USING: owner (or NULL-owner rows for backward compat) + shared users can SELECT
-- WITH CHECK: only owners can INSERT/UPDATE
CREATE POLICY datasets_owner ON datasets
    USING (
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
        OR id IN (
            SELECT dataset_id FROM dataset_shares
            WHERE shared_with = current_setting('app.active_user', true)
        )
    )
    WITH CHECK (
        owner = current_setting('app.active_user', true)
    );

-- Separate FOR DELETE policy: only owners can DELETE (WITH CHECK does not cover DELETE)
CREATE POLICY datasets_owner_delete ON datasets
    FOR DELETE
    USING (owner = current_setting('app.active_user', true));

-- ── 6. Dashboard pinned charts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pinned_charts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner       TEXT NOT NULL,
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    chart_type  TEXT NOT NULL CHECK (chart_type IN ('bar', 'line', 'area', 'scatter')),
    config_json JSONB,
    position    INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pinned_charts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pinned_charts_owner ON pinned_charts;
CREATE POLICY pinned_charts_owner ON pinned_charts
    USING (owner = current_setting('app.active_user', true))
    WITH CHECK (owner = current_setting('app.active_user', true));

-- ── 7. analytics_app role + grants ────────────────────────────────────────
-- analytics_app is the RLS-respecting role used by the API.
-- If the role already exists (e.g. created at DB init time), this is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_app') THEN
        CREATE ROLE analytics_app;
    END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON dataset_shares TO analytics_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pinned_charts  TO analytics_app;
GRANT SELECT, UPDATE ON datasets TO analytics_app;   -- UPDATE for dataset_type PATCH
