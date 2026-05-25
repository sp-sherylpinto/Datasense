-- migrations/004_audit.sql
-- Audit trail for workbench SQL queries and AI usage accounting.
-- These tables are owner-bypass: analytics_app writes to them via the
-- app role, but only service-level reads return rows (RLS denies by
-- default for analytics_app unless the actor is listed in audit_admins).

-- ── 1. Workbench audit trail ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email   TEXT NOT NULL,
    action       TEXT NOT NULL,         -- workbench_query, ai_sql_assist, ...
    sql_text     TEXT,                  -- raw SQL for workbench; NULL for AI-only
    row_count    INTEGER,
    duration_ms  INTEGER,
    status       TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error        TEXT,
    ip_addr      INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_created_idx
    ON audit_log (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_created_idx
    ON audit_log (action, created_at DESC);

-- ── 2. AI usage accounting ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_log (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email        TEXT NOT NULL,
    endpoint          TEXT NOT NULL,     -- sql_assist | dataview_query | explain_job | explain_query_result | classify_dataset
    provider          TEXT NOT NULL,     -- azure | ollama
    model             TEXT,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    duration_ms       INTEGER,
    status            TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_log_user_created_idx
    ON ai_usage_log (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_created_idx
    ON ai_usage_log (created_at DESC);

-- ── 3. Daily AI usage rollup view ─────────────────────────────────────────
CREATE OR REPLACE VIEW ai_usage_daily AS
SELECT
    (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
    user_email,
    endpoint,
    provider,
    model,
    COUNT(*)                                   AS calls,
    SUM(CASE WHEN status = 'ok'    THEN 1 ELSE 0 END) AS ok_calls,
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_calls,
    COALESCE(SUM(prompt_tokens), 0)            AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0)        AS completion_tokens,
    COALESCE(SUM(total_tokens), 0)             AS total_tokens,
    COALESCE(SUM(duration_ms), 0)              AS total_duration_ms
FROM ai_usage_log
GROUP BY 1, 2, 3, 4, 5;

-- ── 4. Grants for analytics_app role ──────────────────────────────────────
-- App writes via INSERT; reads go through the superuser pool (admin endpoints),
-- so analytics_app only needs INSERT.
GRANT INSERT ON audit_log    TO analytics_app;
GRANT INSERT ON ai_usage_log TO analytics_app;
