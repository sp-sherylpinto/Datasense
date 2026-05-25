"""Benford's Law analysis."""
import asyncio
import os
import traceback

import polars as pl

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


@celery_app.task(bind=True, name="worker.tasks.run_benford")
def run_benford(
    self, file_path: str, job_id: str, column: str, digit: int = 1, dataset_id: str | None = None
) -> bytes:
    """Run Benford's Law analysis on the leading digit distribution of a numeric column."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id, lazy=True)
        res = (
            df.select(
                [pl.col(column).cast(pl.String).str.slice(0, 1).alias("digit")]
            )
            .filter(
                pl.col("digit").is_in(["1", "2", "3", "4", "5", "6", "7", "8", "9"])
            )
            .group_by("digit")
            .len()
            .rename({"len": "count"})
            .collect()
        )

        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        res.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
        return None
    except Exception as e:
        asyncio.run(
            update_job_status(job_id, "failed", error_message=traceback.format_exc())
        )
        raise e
