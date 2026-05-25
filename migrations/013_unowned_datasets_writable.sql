-- ──────────────────────────────────────────────────────────────────────
--  013 — `owner IS NULL` becomes the "shared / showcase" sentinel
--
--  Migration 008's USING clause on `datasets_owner` already treated
--  `owner IS NULL` as readable by all authenticated users. Migration 012
--  extended writes to engagement-team members but kept owner-set
--  datasets restricted to the owner. This migration completes the mirror:
--  unowned datasets (owner IS NULL) are also writable by any authenticated
--  user. Same on saved_views — `owner IS NULL` means "shared, anyone on
--  the engagement can edit".
--
--  Use case: the partner showcase (project_datasense_showcase memory)
--  is an unowned dataset+views that any partner should be able to
--  retag, tweak, and re-run, regardless of which firm email they
--  signed in with. Verified pre-migration: zero existing rows have
--  owner IS NULL on either table, so this only affects future
--  intentionally-unowned data.
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
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
        OR (
            engagement_id IS NOT NULL
            AND core.user_can_access_engagement(
                current_setting('app.active_user', true),
                engagement_id
            )
        )
    );


DROP POLICY IF EXISTS saved_views_read   ON public.saved_views;
DROP POLICY IF EXISTS saved_views_update ON public.saved_views;
DROP POLICY IF EXISTS saved_views_insert ON public.saved_views;
DROP POLICY IF EXISTS saved_views_delete ON public.saved_views;

CREATE POLICY saved_views_read ON public.saved_views FOR SELECT
    USING (
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
        OR dataset_id IN (
            SELECT id FROM public.datasets
            WHERE engagement_id IS NOT NULL
              AND core.user_can_access_engagement(
                  current_setting('app.active_user', true),
                  engagement_id
              )
        )
    );

CREATE POLICY saved_views_update ON public.saved_views FOR UPDATE
    USING (
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
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
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
        OR dataset_id IN (
            SELECT id FROM public.datasets
            WHERE engagement_id IS NOT NULL
              AND core.user_can_access_engagement(
                  current_setting('app.active_user', true),
                  engagement_id
              )
        )
    );

-- INSERTs require the owner to be set to the current user (consistent with
-- 012; an authenticated user can save THEIR OWN view, not an unowned one).
CREATE POLICY saved_views_insert ON public.saved_views FOR INSERT
    WITH CHECK (owner = current_setting('app.active_user', true));

-- DELETEs: owner-only OR unowned (showcase-style views can be removed by
-- anyone authenticated; non-NULL-owned views still owner-only).
CREATE POLICY saved_views_delete ON public.saved_views FOR DELETE
    USING (
        owner IS NULL
        OR owner = current_setting('app.active_user', true)
    );


-- saved_views.owner was NOT NULL (migration 010); relax to allow the
-- unowned-showcase pattern. The new RLS INSERT policy still requires
-- owner = current user, so future user-created views always have an
-- owner — only seed scripts can write NULL.
ALTER TABLE public.saved_views
    ALTER COLUMN owner DROP NOT NULL;

-- Retag the showcase dataset + saved views as unowned so the new policy
-- takes effect immediately for them.
UPDATE public.datasets
   SET owner = NULL
 WHERE id = '33333333-3333-3333-3333-333333333333';

UPDATE public.saved_views
   SET owner = NULL
 WHERE dataset_id = '33333333-3333-3333-3333-333333333333';
