"""Journal Entry (JE) testing task.

Flags suspicious journal entries using common audit red flags:
- Weekend postings
- End-of-period entries (last day of month)
- Round-number amounts
- Same-day reversals (matching +/- amounts on same date/account)
- Large amounts above a configurable threshold
"""
import asyncio
import os
import traceback

import polars as pl

from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status
from app.config import settings


def _check_je_flags(
    df: pl.DataFrame,
    *,
    date_col: str,
    amount_col: str,
    account_col: str | None = None,
    preparer_col: str | None = None,
    narration_col: str | None = None,
    large_amount_threshold: float = 100_000,
) -> pl.DataFrame:
    """Return *df* with two extra columns: ``flags`` (pipe-separated string)
    and ``is_flagged`` (bool).

    Rules applied (each adds a token to ``flags``):
    - ``weekend_posting``   — date falls on Saturday or Sunday
    - ``end_of_period``     — date is the last calendar day of its month
    - ``round_number``      — |amount| is a multiple of 1 000 and > 0
    - ``large_amount``      — |amount| >= large_amount_threshold
    - ``same_day_reversal`` — another row with the same date, account, and
                              exact negated amount exists (amount != 0)
    """
    df = df.with_columns(pl.col(date_col).cast(pl.Date).alias("_date"))

    # --- weekend_posting ---
    df = df.with_columns(
        pl.col("_date").dt.weekday().alias("_weekday")
    )
    # Polars weekday: Mon=1 … Sun=7
    df = df.with_columns(
        (pl.col("_weekday") >= 6).alias("_flag_weekend")
    )

    # --- end_of_period ---
    df = df.with_columns(
        (
            pl.col("_date")
            == pl.col("_date").dt.month_end()
        ).alias("_flag_eop")
    )

    # --- round_number ---
    df = df.with_columns(
        (
            (pl.col(amount_col).abs() > 0)
            & ((pl.col(amount_col).abs() % 1_000) == 0)
        ).alias("_flag_round")
    )

    # --- large_amount ---
    df = df.with_columns(
        (pl.col(amount_col).abs() >= large_amount_threshold).alias("_flag_large")
    )

    # --- same_day_reversal ---
    # A row is a reversal if another row shares the same date (and account if
    # provided) and has the exact negated amount, and amount != 0.
    if account_col:
        reversal_keys = ["_date", account_col]
    else:
        reversal_keys = ["_date"]

    df = df.with_columns(
        pl.col(amount_col).alias("_neg_amount") * -1
    )

    reversal_df = (
        df.select([*reversal_keys, pl.col(amount_col).alias("_match_amount")])
        .with_columns(pl.lit(True).alias("_has_match"))
    )

    df = df.join(
        reversal_df.unique(subset=[*reversal_keys, "_match_amount"]),
        left_on=[*reversal_keys, "_neg_amount"],
        right_on=[*reversal_keys, "_match_amount"],
        how="left",
    )
    df = df.with_columns(
        (
            pl.col("_has_match").fill_null(False)
            & (pl.col(amount_col) != 0)
        ).alias("_flag_reversal")
    )

    # --- assemble flags string ---
    def _flag_expr(col: str, token: str) -> pl.Expr:
        return pl.when(pl.col(col)).then(pl.lit(token)).otherwise(pl.lit(""))

    df = df.with_columns(
        pl.concat_str(
            [
                _flag_expr("_flag_weekend", "weekend_posting"),
                _flag_expr("_flag_eop", "end_of_period"),
                _flag_expr("_flag_round", "round_number"),
                _flag_expr("_flag_large", "large_amount"),
                _flag_expr("_flag_reversal", "same_day_reversal"),
            ],
            separator="|",
        ).alias("_flags_raw")
    )

    # Clean up leading/trailing/double pipes
    df = df.with_columns(
        pl.col("_flags_raw")
        .str.replace_all(r"\|{2,}", "|")
        .str.strip_chars("|")
        .alias("flags")
    )

    df = df.with_columns(
        (pl.col("flags").str.len_chars() > 0).alias("is_flagged")
    )

    # Drop temporary columns
    tmp_cols = [
        "_date", "_weekday", "_neg_amount", "_has_match", "_flags_raw",
        "_flag_weekend", "_flag_eop", "_flag_round", "_flag_large", "_flag_reversal",
    ]
    return df.drop([c for c in tmp_cols if c in df.columns])


@celery_app.task(bind=True, name="worker.tasks.run_je_test")
def run_je_test(
    self,
    file_path: str,
    job_id: str,
    date_col: str,
    amount_col: str,
    account_col: str | None = None,
    preparer_col: str | None = None,
    narration_col: str | None = None,
    large_amount_threshold: float = 100_000,
    dataset_id: str | None = None,
) -> None:
    """Celery task: run JE flag analysis and save results as Parquet."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id)
        result = _check_je_flags(
            df,
            date_col=date_col,
            amount_col=amount_col,
            account_col=account_col,
            preparer_col=preparer_col,
            narration_col=narration_col,
            large_amount_threshold=large_amount_threshold,
        )
        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
    except Exception:
        asyncio.run(
            update_job_status(job_id, "failed", error_message=traceback.format_exc())
        )
        raise