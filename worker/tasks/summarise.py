"""CSV summarisation."""
import asyncio
import os
import traceback

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


@celery_app.task(bind=True, name="worker.tasks.summarise_csv")
def summarise_csv(self, file_path: str, job_id: str, dataset_id: str | None = None) -> bytes:
    """Summarise a CSV file and save as Parquet."""
    asyncio.run(update_job_status(job_id, "running"))

    try:
        df = _load_dataset_df(file_path, dataset_id, lazy=True)
        summary_df = df.describe().collect()

        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        summary_df.write_parquet(result_path, compression="zstd")

        asyncio.run(update_job_status(job_id, "completed", result_path))
        return None
    except Exception as e:
        asyncio.run(
            update_job_status(job_id, "failed", error_message=traceback.format_exc())
        )
        raise e
