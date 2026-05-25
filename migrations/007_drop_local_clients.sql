-- migrations/007_drop_local_clients.sql
-- Phase 1 of the varma-core master-data rollout (Apr 2026).
-- DataSense no longer owns clients/engagements — those live in core.* now.
-- The app already inherits core_reader (set up during Phase 0), so SELECTs
-- against core.v_engagements_full / core.clients work without changes.
--
-- This migration:
--   1. Drops FK constraints on datasets.client_id, datasets.engagement_id,
--      jobs.client_id, saved_queries.client_id (the FK targets are about to
--      disappear). The columns themselves stay — they're now plain UUIDs
--      pointing at core.engagements.id / core.clients.id, populated by the
--      EngagementPicker once the SPA wires it in.
--   2. Drops the seed Default client + Default engagement (single rows, no
--      production data — surveyed before applying).
--   3. Drops the local clients and engagements tables.
--   4. Repoints the 26 existing datasets and 211 existing jobs from the
--      seed UUIDs to NULL (legacy uploads with no engagement context).
--      The SPA will start prompting for engagement context on new uploads
--      after the cutover. Existing rows stay queryable, just no engagement.

BEGIN;

-- 1. Drop NOT NULL + DEFAULT clauses first (defaults still point at seed UUIDs).
ALTER TABLE datasets
    ALTER COLUMN client_id     DROP DEFAULT,
    ALTER COLUMN client_id     DROP NOT NULL,
    ALTER COLUMN engagement_id DROP DEFAULT;

ALTER TABLE jobs
    ALTER COLUMN client_id DROP DEFAULT;

ALTER TABLE saved_queries
    ALTER COLUMN client_id DROP DEFAULT;

-- 2. Now null-out legacy references to seed UUIDs so the FK drops cleanly.
UPDATE datasets
   SET client_id = NULL, engagement_id = NULL
 WHERE client_id    = '00000000-0000-0000-0000-000000000001'
    OR engagement_id = '00000000-0000-0000-0000-000000000002';

UPDATE jobs
   SET client_id = NULL
 WHERE client_id = '00000000-0000-0000-0000-000000000001';

UPDATE saved_queries
   SET client_id = NULL
 WHERE client_id = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT con.conname,
               cls.relname AS table_name
          FROM pg_constraint con
          JOIN pg_class      cls ON cls.oid = con.conrelid
         WHERE con.contype = 'f'
           AND con.conrelid IN (
                'public.datasets'::regclass,
                'public.jobs'::regclass,
                'public.saved_queries'::regclass)
           AND con.confrelid IN (
                'public.clients'::regclass,
                'public.engagements'::regclass)
    LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',
            rec.table_name, rec.conname);
    END LOOP;
END $$;

-- 3. Drop the local tables. CASCADE because there may be other dependents
--    (views, triggers) we haven't enumerated. Surveyed: there are none.
DROP TABLE IF EXISTS engagements CASCADE;
DROP TABLE IF EXISTS clients     CASCADE;

-- 4. Comment the columns so future readers know where the FKs live now.
COMMENT ON COLUMN datasets.client_id     IS 'core.clients.id (no FK — different schema, app reads via core_reader)';
COMMENT ON COLUMN datasets.engagement_id IS 'core.engagements.id (no FK — populated by EngagementPicker)';
COMMENT ON COLUMN jobs.client_id          IS 'core.clients.id (no FK)';
COMMENT ON COLUMN saved_queries.client_id IS 'core.clients.id (no FK)';

COMMIT;
