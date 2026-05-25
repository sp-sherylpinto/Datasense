"""Accounts-receivable / payable aging analysis task.

Buckets outstanding balances by how many days overdue they are and
produces both a detailed row-level result and a summary by bucket.
"""
import asyncio
import os
import traceback
from datetime import date, datetime

import polars as pl

from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status
from app.config import settings

# Aging buckets: (label, min_days_overdue, max_days_overdue_inclusive)
_BUCKETS: list[tuple[str, int, int | None]] = [
    ("Current",       None, 0),     # not yet overdue
    ("1–90 days",     1,    90),
    ("91–180 days",   91,   180),
    ("181–365 days",  181,  365),
    ("Over 365 days", 366,  None),
]


def _assign_bucket(days_overdue: int | None) -> str:
    if days_overdue is None or days_overdue <= 0:
        return "Current"
    for label, lo, hi in _BUCKETS[1:]:   # skip "Current" entry
        if hi is None or days_overdue <= hi:
            return label
    return "Over 365 days"


def _compute_aging(
    df: pl.DataFrame,
    *,
    party_col: str,
    amount_col: str,
    due_date_col: str,
    reference_date: str | date | None = None,
) -> list[dict]:
    """Return a list of dicts with ``result_type`` = ``"detail"`` or ``"summary"``.

    Parameters
    ----------
    df              : input DataFrame
    party_col       : column name for the counterparty (customer / vendor)
    amount_col      : column name for the outstanding amount
    due_date_col    : column name for the due / invoice date
    reference_date  : the "as-at" date for the aging calculation;
                      defaults to today when not supplied
    """
    if reference_date is None:
        ref = date.today()
    elif isinstance(reference_date, str):
        ref = datetime.strptime(reference_date, "%Y-%m-%d").date()
    else:
        ref = reference_date

    df = df.with_columns(
        pl.col(due_date_col).cast(pl.Date).alias("_due_date"),
        pl.col(amount_col).cast(pl.Float64).alias("_amount"),
    )

    # days_overdue: positive = overdue, 0 or negative = not yet due
    ref_pl = pl.lit(ref)
    df = df.with_columns(
        ((ref_pl - pl.col("_due_date")).dt.total_days()).cast(pl.Int64).alias("_days_overdue")
    )

    # Assign buckets
    bucket_series = [
        _assign_bucket(d) for d in df["_days_overdue"].to_list()
    ]
    df = df.with_columns(pl.Series("bucket", bucket_series))

    # Build detail rows
    detail_rows: list[dict] = []
    for row in df.iter_rows(named=True):
        detail_rows.append({
            "result_type": "detail",
            "party": row[party_col],
            "amount": row["_amount"],
            "due_date": str(row["_due_date"]),
            "days_overdue": max(int(row["_days_overdue"]), 0),
            "bucket": row["bucket"],
        })

    # Build summary rows (one per bucket that has at least one entry)
    total_amount = df["_amount"].sum() or 0.0
    summary_rows: list[dict] = []
    for label, _, _ in _BUCKETS:
        subset = df.filter(pl.col("bucket") == label)
        if subset.is_empty():
            continue
        bucket_amount = subset["_amount"].sum() or 0.0
        pct = (bucket_amount / total_amount * 100) if total_amount else 0.0
        summary_rows.append({
            "result_type": "summary",
            "party": None,
            "amount": bucket_amount,
            "due_date": None,
            "days_overdue": None,
            "bucket": label,
            "count": len(subset),
            "pct_of_total": round(pct, 4),
        })

    return detail_rows + summary_rows


@celery_app.task(bind=True, name="worker.tasks.run_aging")
def run_aging(
    self,
    file_path: str,
    job_id: str,
    party_col: str,
    amount_col: str,
    due_date_col: str,
    reference_date: str | None = None,
    dataset_id: str | None = None,
) -> None:
    """Celery task: run aging analysis and save results as Parquet."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id)
        rows = _compute_aging(
            df,
            party_col=party_col,
            amount_col=amount_col,
            due_date_col=due_date_col,
            reference_date=reference_date,
        )
        result = pl.DataFrame(rows)
        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
    except Exception:
        asyncio.run(
            update_job_status(job_id, "failed", error_message=traceback.format_exc())
        )
        raise