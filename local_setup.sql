-- ================================================================
-- LOCAL SETUP — Run this ONCE before the migrations
-- Creates the core schema stubs and analytics_app role
-- ================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create the core schema
CREATE SCHEMA IF NOT EXISTS core;

-- 3. core_user table (referenced by migration 015)
CREATE TABLE IF NOT EXISTS public.core_user (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email      TEXT UNIQUE NOT NULL,
    name       TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. core.audit_areas table (referenced by migrations 009, 010, 011)
CREATE TABLE IF NOT EXISTS core.audit_areas (
    id    TEXT PRIMARY KEY,
    code  TEXT UNIQUE,
    title TEXT NOT NULL
);

INSERT INTO core.audit_areas (id, code, title) VALUES
    ('general:A', 'A', 'Cash & Bank'),
    ('general:B', 'B', 'Trade Receivables'),
    ('general:C', 'C', 'Inventories'),
    ('general:D', 'D', 'Fixed Assets'),
    ('general:E', 'E', 'Investments'),
    ('general:F', 'F', 'Loans & Advances'),
    ('general:G', 'G', 'Other Assets'),
    ('general:H', 'H', 'Share Capital'),
    ('general:I', 'I', 'Borrowings'),
    ('general:J', 'J', 'Trade Payables'),
    ('general:K', 'K', 'Revenue'),
    ('general:L', 'L', 'Expenses')
ON CONFLICT (id) DO NOTHING;

-- 5. core.user_can_access_engagement() — always TRUE locally
CREATE OR REPLACE FUNCTION core.user_can_access_engagement(
    user_email TEXT,
    engagement_id UUID
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT TRUE;
$$;

-- 6. current_user_id() — returns fixed dev UUID locally
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT '00000000-0000-0000-0000-000000000099'::UUID;
$$;

-- 7. Create analytics_app role with password
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_app') THEN
        CREATE ROLE analytics_app WITH LOGIN PASSWORD 'analytics_app_rls';
    ELSE
        ALTER ROLE analytics_app WITH LOGIN PASSWORD 'analytics_app_rls';
    END IF;
END
$$;

-- 8. Grant schema access
GRANT USAGE ON SCHEMA public TO analytics_app;
GRANT USAGE ON SCHEMA core   TO analytics_app;
GRANT USAGE ON SCHEMA datasets TO analytics_app;  -- may not exist yet, handled later

-- 9. Grant on existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO analytics_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core   TO analytics_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO analytics_app;

-- 10. Make sure future tables are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO analytics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO analytics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA datasets
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO analytics_app;

-- 11. Superuser bypass so analytics_app can do everything locally
ALTER ROLE analytics_app SUPERUSER;