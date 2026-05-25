-- ──────────────────────────────────────────────────────────────────────
--  012 — Engagement-team members can UPDATE dataset + view metadata
--
--  Migration 008 extended READ access on datasets and saved_views to
--  every engagement team member (mirrored via core.user_can_access_engagement,
--  which has an admin bypass). But the WITH CHECK clauses kept UPDATEs
--  owner-only — so a manager / partner / admin on the engagement could
--  see a dataset but couldn't tag it to an audit area, change its
--  dataset_type, or update saved-view metadata.
--
--  This migration relaxes WITH CHECK to mirror USING for UPDATEs while
--  keeping DELETE owner-only (DELETEs still go through the separate
--  *_owner_delete policies, which are unchanged).
--
--  Triggered by: showcase TB owned by `showcase@varma.ai` couldn't be
--  tagged by Nishanth (admin) from the SPA — PATCH returned 404 because
--  the WITH CHECK rejected the update silently. Engagement-team metadata
--  edits are a low-privilege operation that should follow the same
--  permission model as reads.
-- ──────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS datasets_owner ON public.datasets;

CREATE POLICY datasets_owner ON public.datasets
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
        OR (
            engagement_id IS NOT NULL
            AND core.user_can_access_engagement(
                current_setting('app.active_user', true),
                engagement_id
            )
        )
    );


-- saved_views: same logic — engagement-team members can update views
-- attached to a dataset on their engagement (e.g. retag the audit_area
-- on a colleague's saved view that's been miscategorised).
-- Owner-only DELETE is preserved by leaving saved_views_write FOR ALL
-- in place but separating UPDATE from DELETE via FOR DELETE clause.

DROP POLICY IF EXISTS saved_views_write ON public.saved_views;

CREATE POLICY saved_views_update ON public.saved_views FOR UPDATE
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
    )
    WITH CHECK (
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

-- INSERTs still require owner = current user (you can save a view of
-- your own; engagement-team members can save their own copies).
CREATE POLICY saved_views_insert ON public.saved_views FOR INSERT
    WITH CHECK (owner = current_setting('app.active_user', true));

-- DELETEs are owner-only (don't let teammates delete each other's saved
-- views — accidental loss is too costly).
CREATE POLICY saved_views_delete ON public.saved_views FOR DELETE
    USING (owner = current_setting('app.active_user', true));
