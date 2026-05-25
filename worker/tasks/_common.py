"""Shared helpers used by every Celery task module.

Lives outside any individual task family so that imports stay simple
and Celery only registers task functions (not helpers).
"""
import asyncio
import io
from uuid import UUID

import asyncpg
import polars as pl

from app.config import settings
from app.ingestion import _normalise_df, _safe_col


def _read_csv_normalised(file_path: str, *, lazy: bool = False):
    """Read a raw uploaded CSV and rename its columns to the safe identifiers
    the rest of the app uses. The upload pipeline auto-normalises column names
    (e.g. "Invoice Number" → "invoice_number") and the UI dropdowns + saved
    metadata all reflect the normalised form. Tasks that read the raw CSV
    must apply the same rename or `pl.col(<safe_name>)` will miss.
    """
    if lazy:
        ldf = pl.scan_csv(file_path)
        # Polars 1.x: `LazyFrame.columns` emits a perf warning; the recommended
        # API is `collect_schema().names()` which doesn't materialise rows.
        rename_map = {raw: _safe_col(raw) for raw in ldf.collect_schema().names()}
        return ldf.rename(rename_map)
    df = pl.read_csv(file_path, ignore_errors=True)
    df, _ = _normalise_df(df)
    return df


def _load_dataset_df(file_path: str, dataset_id: str | None = None, *, lazy: bool = False):
    """Load the dataset that the user thinks they're analysing.

    Once a file has been uploaded, the source-of-truth for its data is the
    `datasets.ds_<id>` Postgres table (post-normalisation, post-rename).
    The raw file on disk is only useful for re-parsing — the column names
    there can diverge from what the UI shows after a cleaning job, and for
    XLSX/PDF/XML the raw file isn't even readable as a CSV.

    So: when a `dataset_id` is supplied, read from Postgres. Fall back to
    the raw CSV only when no dataset_id is available (rare).
    """
    if not dataset_id:
        return _read_csv_normalised(file_path, lazy=lazy)

    async def _fetch_from_db():
        conn = await asyncpg.connect(settings.DATABASE_URL)
        try:
            row = await conn.fetchrow(
                "SELECT table_name FROM datasets WHERE id = $1",
                UUID(dataset_id),
            )
            if not row or not row["table_name"]:
                return None
            db_rows = await conn.fetch(f"SELECT * FROM {row['table_name']}")
            if not db_rows:
                col_rows = await conn.fetch(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'datasets'
                      AND table_name = $1
                    ORDER BY ordinal_position
                    """,
                    row["table_name"].split(".", 1)[1],
                )
                cols = [r["column_name"] for r in col_rows]
                return pl.DataFrame({c: [] for c in cols})

            # Cast every value through str so mixed Postgres types (Decimal,
            # datetime, NUMERIC, etc.) don't trip Polars' type inference.
            col_names = list(db_rows[0].keys())
            csv_lines = [",".join(f'"{c}"' for c in col_names)]
            for r in db_rows:
                vals = []
                for c in col_names:
                    v = r[c]
                    if v is None:
                        vals.append("")
                    else:
                        s = str(v).replace('"', '""')
                        vals.append(f'"{s}"')
                csv_lines.append(",".join(vals))
            csv_data = "\n".join(csv_lines)
            return pl.read_csv(
                io.StringIO(csv_data),
                infer_schema_length=10_000,
                ignore_errors=True,
            )
        finally:
            await conn.close()

    df = asyncio.run(_fetch_from_db())
    if df is None:
        return _read_csv_normalised(file_path, lazy=lazy)
    return df.lazy() if lazy else df


async def update_job_status(
    job_id: str,
    status: str,
    result_path: str | None = None,
    error_message: str | None = None,
):
    """Update the jobs table in PostgreSQL."""
    conn = await asyncpg.connect(settings.DATABASE_URL)
    try:
        await conn.execute(
            """
            UPDATE jobs
            SET status = $2, result_path = $3, error_message = $4
            WHERE id = $1
            """,
            UUID(job_id),
            status,
            result_path,
            error_message,
        )
    finally:
        await conn.close()
