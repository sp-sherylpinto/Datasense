# Changelog — DataSense

All notable changes are documented here. Entries are derived from the
ISO 27001 Infrastructure Controls log.

## [2026.05] — May 2026

### Added
- Saved Views: persistent column visibility and ordering saved per user per
  dataset; shareable via `?import_view=<id>` URL parameter.
- "Send to VouchPaper" button in the Views dropdown — opens VouchPaper with
  the active saved view pre-loaded.
- Partner-facing showcase: 97-row synthetic Trial Balance dataset and demo
  engagement (`VV-DEMO-0001`) seeded; 5 pre-built Saved Views.
- Audit-area taxonomy added to datasets: A–Z area enum aligned with firm
  workpaper letters.

### Changed
- App renamed from "Data Sense Pro" to "DataSense".
- Positioning refined: DataSense is the Discovery tier; procedure execution
  lives in FraudGuard (not DataSense).
- Dataset merge no longer caps the combined output at 500,000 rows; all rows
  from every selected dataset are now stacked into the merged result.

### Added
- **Server-side merge**: `POST /datasets/merge` now uses Postgres `UNION ALL`
  by default (`strategy=union_all`), eliminating Python-memory OOM on large
  merges. Legacy `diagonal` strategy still available.
- **Dataset lineage**: merged datasets store a `lineage` JSONB record with
  parent IDs, strategy, and provenance metadata.
- **Job cancellation**: `POST /jobs/{id}/cancel` revokes the Celery task and
  marks the job cancelled.
- **Result TTL cleanup**: `POST /internal/cleanup` removes Parquet files older
  than their retention period (default 30 days). Intended for nightly systemd
  timer.
- **SSE job status**: `GET /jobs/{id}/events` replaces frontend polling with a
  single persistent EventSource connection.
- **PII detection on upload**: automatic regex scan for PAN, GSTIN, Aadhaar,
  phone, email, credit card, and bank-account patterns. Results stored in
  `datasets.pii_detected` / `pii_summary`.
- **Prompt versioning**: AI prompts now live in the `ai_prompts` table
  (migration 014). Active versions are cached in-process; every `ai_usage_log`
  row records the prompt version used.
- **Structured logging**: correlation IDs propagate across FastAPI requests,
  Celery tasks, and Postgres `application_name`.
- **Frontend Zustand refactor**: global state (dataset, job, engagement, app)
  moved from monolithic `App.tsx` into typed Zustand stores.

### Fixed
- Boolean column ingestion bug (True/False values not parsed correctly).
- Footer now pinned to the bottom of the viewport on all short-content pages (`flex flex-col` on root div, `flex-1` on `<main>`).
- Dataset merge now tolerates mismatched column dtypes across source datasets
  (e.g. one dataset has `open` as Boolean, another as Float64) by using
  `pl.concat(..., how="diagonal_relaxed")` so types are promoted to a common
  supertype instead of failing with `SchemaError`.

## [2026.04] — April 2026

### Added
- Full AI overhaul: Kimi-K2.5 replaces earlier model for analysis
  narratives.
- Polars upgrade 0.20 → 1.40; frontend refactored into 27 component files.
- Cross-app seam: datasets shared with FraudGuard for procedure execution.
- RLS-enforced dataset sharing: team members receive email on share grant.
- Export results and AI narratives to Excel.
