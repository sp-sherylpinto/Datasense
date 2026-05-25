-- ──────────────────────────────────────────────────────────────────────
--  009 — Tag datasets to audit area (firm A–Z standard)
--
--  Requires: core.audit_areas from varma-core migration 014.
--
--  Adds an optional audit_area_code on public.datasets so DataSense (and
--  any downstream tool) can filter / group / route datasets by audit
--  area. NULL means "not yet tagged" — the auditor can set it from the
--  dataset detail UI after upload, since shape detection + tagging live
--  in different ticks of the workflow.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.datasets
    ADD COLUMN IF NOT EXISTS audit_area_code CHAR(1);

-- FK to the cross-app enum. ON DELETE SET NULL so retiring an audit
-- area never silently drops dataset rows; ON UPDATE CASCADE so a
-- typo-fix on the area code propagates.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'datasets_audit_area_fk'
    ) THEN
        ALTER TABLE public.datasets
            ADD CONSTRAINT datasets_audit_area_fk
            FOREIGN KEY (audit_area_code)
            REFERENCES core.audit_areas (code)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS datasets_audit_area_idx
    ON public.datasets (audit_area_code) WHERE audit_area_code IS NOT NULL;
