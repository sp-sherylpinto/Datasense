"""K-Means clustering on two numeric columns."""
import asyncio
import os
import traceback

import polars as pl

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


@celery_app.task(bind=True, name="worker.tasks.run_clustering")
def run_clustering(
    self, file_path: str, job_id: str, x_col: str, y_col: str, k: int = 3, dataset_id: str | None = None
) -> bytes:
    """K-Means clustering. Result table has columns `x`, `y`, `cluster_id`."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        from sklearn.cluster import KMeans
        from sklearn.preprocessing import StandardScaler

        df = _load_dataset_df(file_path, dataset_id)

        for col in (x_col, y_col):
            df = df.with_columns(
                pl.col(col)
                .cast(pl.String)
                .str.replace_all(r"[$£€₹,\s]", "")
                .str.replace_all(r"^\-+$", "0")
                .cast(pl.Float64, strict=False)
                .alias(col)
            )

        sub = df.select([x_col, y_col]).drop_nulls()
        if len(sub) < max(k, 2):
            raise ValueError(
                f"Insufficient non-null rows ({len(sub)}) for k={k} clustering"
            )

        X = sub.to_numpy().astype(float)
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(X_scaled)

        res = sub.with_columns(pl.Series("cluster_id", labels)).rename(
            {x_col: "x", y_col: "y"}
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
