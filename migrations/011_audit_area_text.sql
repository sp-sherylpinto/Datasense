-- ──────────────────────────────────────────────────────────────────────
--  011 — audit_area_code becomes TEXT, FK against the new
--        core.audit_areas(id) shape.
--
--  Requires: varma-core migration 015 (which DROP-CASCADEs the previous
--  core.audit_areas table — the FK constraints on
--  public.datasets.audit_area_code and public.saved_views.audit_area_code
--  are auto-removed in that step. This migration retypes the columns
--  and re-adds the FKs against the new audit_areas(id) primary key.
--
--  All existing audit_area_code values are NULL on these tables (verified
--  pre-migration) so no data conversion is required.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.datasets
    ALTER COLUMN audit_area_code TYPE TEXT;

ALTER TABLE public.saved_views
    ALTER COLUMN audit_area_code TYPE TEXT;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'datasets_audit_area_fk'
    ) THEN
        ALTER TABLE public.datasets
            ADD CONSTRAINT datasets_audit_area_fk
            FOREIGN KEY (audit_area_code) REFERENCES core.audit_areas(id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'saved_views_audit_area_fk'
    ) THEN
        ALTER TABLE public.saved_views
            ADD CONSTRAINT saved_views_audit_area_fk
            FOREIGN KEY (audit_area_code) REFERENCES core.audit_areas(id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;
