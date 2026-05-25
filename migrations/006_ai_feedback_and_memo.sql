-- Phase 4: AI overhaul. Adds:
--   1. ai_feedback — per-response 👍/👎 + free-text comment, joined to
--      ai_usage_log (which has the per-call token / model / endpoint detail).
--   2. datasets.summary_memo — short LLM-authored characterisation of the
--      dataset, cached so subsequent AI calls can prepend it as context
--      instead of re-discovering everything from sample rows.

CREATE TABLE IF NOT EXISTS ai_feedback (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usage_id    UUID NOT NULL REFERENCES ai_usage_log(id) ON DELETE CASCADE,
    user_email  TEXT NOT NULL,
    rating      SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_feedback_usage_idx ON ai_feedback(usage_id);
CREATE INDEX IF NOT EXISTS ai_feedback_user_idx  ON ai_feedback(user_email, created_at DESC);

ALTER TABLE datasets ADD COLUMN IF NOT EXISTS summary_memo TEXT;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS summary_memo_generated_at TIMESTAMPTZ;
