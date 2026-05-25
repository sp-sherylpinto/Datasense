"""Source → target relationship counting for the network graph."""
import asyncio
import os
import traceback

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


@celery_app.task(bind=True, name="worker.tasks.run_network")
def run_network(
    self, file_path: str, job_id: str, src_col: str, tgt_col: str, dataset_id: str | None = None
) -> bytes:
    """Group by (src, tgt) and count occurrences. The frontend converts each
    row into an edge with `value = count`."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id, lazy=True)
        # Polars 1.x: GroupBy.count() removed → use .len() then rename so the
        # frontend (which already reads `count`) doesn't have to know.
        res = (
            df.group_by([src_col, tgt_col])
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
