-- ──────────────────────────────────────────────────────────────────────
--  008 — Extend RLS to share datasets and jobs with engagement teams
--
--  Requires: core.user_can_access_engagement() from varma-core
--  migration 007 (must be applied first).
--
--  datasets: if engagement_id is set, every engagement team member can
--            read the dataset (ownership for writes is unchanged).
--
--  jobs: no engagement_id column — inherit access via dataset_id.
--        If you can see the parent dataset (which now includes
--        engagement-team check), you can see its jobs.
-- ──────────────────────────────────────────────────────────────────────


-- ─── datasets ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS datasets_owner        ON datasets;
DROP POLICY IF EXISTS datasets_owner_delete ON datasets;

CREATE POLICY datasets_owner ON datasets
    USING (
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
        OR id IN (
            SELECT dataset_id FROM dataset_shares
            WHERE shared_with = current_setting('app.active_user', true)
        )
        OR (
            engagement_id IS NOT NULL
            AND core.user_can_access_engagement(
                current_setting('app.active_user', true),
                engagement_id
            )
        )
    )
    WITH CHECK (
        owner = current_setting('app.active_user', true)
    );

CREATE POLICY datasets_owner_delete ON datasets
    FOR DELETE
    USING (owner = current_setting('app.active_user', true));


-- ─── jobs ─────────────────────────────────────────────────────────────
-- jobs has no engagement_id; access is inherited from the parent dataset.
-- Since analytics_app has RLS on datasets, the subquery automatically
-- applies the datasets_owner policy (including the new engagement check).

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_owner        ON jobs;
DROP POLICY IF EXISTS jobs_owner_delete ON jobs;

CREATE POLICY jobs_owner ON jobs
    USING (
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
        OR (
            dataset_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM datasets WHERE id = jobs.dataset_id)
        )
    )
    WITH CHECK (
        owner = current_setting('app.active_user', true)
    );

CREATE POLICY jobs_owner_delete ON jobs
    FOR DELETE
    USING (owner = current_setting('app.active_user', true));
