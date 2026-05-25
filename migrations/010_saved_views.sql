-- ──────────────────────────────────────────────────────────────────────
--  010 — Saved Views (named filtered slices over a dataset)
--
--  Move 2a of the in-house audit-suite architecture. A View is a named,
--  persisted slice of a dataset = (filters + sort + selected columns +
--  view_type), scoped to a dataset and optionally tagged to an audit
--  area. Auditors save a slice during planning, come back to it later,
--  share it with the engagement team. View_type stub is 'table' only
--  for now; pivot / groupby / chart slot in via a later CHECK extension.
--
--  Filters are stored as a JSON array of {column, op, value, value2?}
--  and the client builds the SQL from this spec at query time. No raw
--  SQL is stored on the View — the server-side surface is "list / get /
--  create / update / delete metadata", not "execute".
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.saved_views (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id      UUID         NOT NULL
        REFERENCES public.datasets(id) ON DELETE CASCADE,
    name            TEXT         NOT NULL,
    description     TEXT,
    audit_area_code CHAR(1)
        REFERENCES core.audit_areas(code) ON UPDATE CASCADE ON DELETE SET NULL,
    view_type       TEXT         NOT NULL DEFAULT 'table'
        CHECK (view_type IN ('table')),
    filters         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    sort            JSONB,
    columns         JSONB,
    owner           TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_views_dataset_idx
    ON public.saved_views (dataset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS saved_views_owner_idx
    ON public.saved_views (owner);

CREATE INDEX IF NOT EXISTS saved_views_audit_area_idx
    ON public.saved_views (audit_area_code) WHERE audit_area_code IS NOT NULL;

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

-- Read: owner can see own views; engagement-team members can see views
-- on datasets that belong to their engagement (mirrors datasets RLS).
DROP POLICY IF EXISTS saved_views_read ON public.saved_views;
CREATE POLICY saved_views_read ON public.saved_views FOR SELECT
USING (
    owner = current_setting('app.active_user', true)
    OR dataset_id IN (
        SELECT id FROM public.datasets
        WHERE engagement_id IS NOT NULL
          AND core.user_can_access_engagement(
              current_setting('app.active_user', true),
              engagement_id
          )
    )
);

-- Write: only owner. Engagement-team members can read but not edit
-- someone else's view. They can save their own copy if they want one.
DROP POLICY IF EXISTS saved_views_write ON public.saved_views;
CREATE POLICY saved_views_write ON public.saved_views FOR ALL
USING (owner = current_setting('app.active_user', true))
WITH CHECK (owner = current_setting('app.active_user', true));

-- Reuse the existing trigger function from migration 001.
DROP TRIGGER IF EXISTS saved_views_updated_at ON public.saved_views;
CREATE TRIGGER saved_views_updated_at
    BEFORE UPDATE ON public.saved_views
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
