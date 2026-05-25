-- migrations/002_datasets.sql
-- Foundation for multi-client workspaces, persistent data storage, and workbench

-- ============================================================
-- CLIENTS
-- Each CA engagement belongs to a client. This is a soft filter
-- now; PostgreSQL RLS policies will enforce hard boundaries when
-- Authentik SSO is wired in — no schema changes needed then.
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
    id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name    VARCHAR(255) NOT NULL,
    code    VARCHAR(50)  UNIQUE,
    notes   TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Default client used during dev / single-user mode
INSERT INTO clients (id, name, code, notes)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default', 'default', 'Dev / testing workspace')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ENGAGEMENTS
-- A client can have many engagements (audits, tax reviews, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagements (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    period      VARCHAR(50),   -- e.g. "FY 2024-25"
    status      VARCHAR(30) DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Default engagement
INSERT INTO engagements (id, client_id, name, period)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Default Engagement',
    'Dev'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- DATASETS
-- Each uploaded file gets a row here AND its own PostgreSQL
-- table inside the "datasets" schema (table_name column).
-- This gives full SQL access with proper retention.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS datasets;

CREATE TABLE IF NOT EXISTS datasets (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id         UUID NOT NULL REFERENCES clients(id) DEFAULT '00000000-0000-0000-0000-000000000001',
    engagement_id     UUID REFERENCES engagements(id)       DEFAULT '00000000-0000-0000-0000-000000000002',
    original_filename TEXT NOT NULL,
    file_type         VARCHAR(20) NOT NULL,   -- csv | xlsx | pdf | xml
    table_name        TEXT UNIQUE,            -- e.g. "datasets.ds_abc123"  (NULL until ingested)
    file_path         TEXT,                   -- path to original file on disk
    row_count         INTEGER,
    columns           JSONB,                  -- [{"name": "...", "inferred_type": "..."}]
    ingest_warnings   JSONB,                  -- any parse warnings
    created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- JOBS — add dataset + client FK
-- ============================================================
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS client_id    UUID REFERENCES clients(id)    DEFAULT '00000000-0000-0000-0000-000000000001',
    ADD COLUMN IF NOT EXISTS dataset_id   UUID REFERENCES datasets(id);

-- ============================================================
-- WORKBENCH — saved SQL queries
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_queries (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id   UUID REFERENCES clients(id) DEFAULT '00000000-0000-0000-0000-000000000001',
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    sql         TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_saved_queries_updated_at
    BEFORE UPDATE ON saved_queries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
