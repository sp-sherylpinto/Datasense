-- Persist task params on the jobs row so the UI can display "what was this run on?"
-- across sessions (otherwise task_params lives only in the React state of the
-- session that enqueued it, and is lost after a page reload or when another
-- user views the job history).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS task_params JSONB;
