"""Time-series aggregation + simple forecasting."""
import asyncio
import datetime
import os
import traceback

import polars as pl

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


@celery_app.task(bind=True, name="worker.tasks.run_timeseries")
def run_timeseries(
    self, file_path: str, job_id: str, date_col: str, val_col: str, dataset_id: str | None = None
) -> bytes:
    """Sum `val_col` by `date_col`, sorted ascending."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id, lazy=True)
        res = (
            df.group_by(date_col)
            .agg(pl.col(val_col).sum())
            .sort(date_col)
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


@celery_app.task(bind=True, name="worker.tasks.run_forecast")
def run_forecast(
    self,
    file_path: str,
    job_id: str,
    date_col: str,
    val_col: str,
    periods: int = 30,
    dataset_id: str | None = None,
) -> bytes:
    """Run time series forecasting using simple linear trend + exponential smoothing."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id)

        ts_df = df.group_by(date_col).agg(pl.col(val_col).sum()).sort(date_col)
        values = ts_df[val_col].to_list()
        dates = ts_df[date_col].to_list()

        if len(values) < 2:
            raise ValueError("Insufficient data for forecasting (need at least 2 points)")

        x = list(range(len(values)))
        y = values
        n = len(x)
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(xi * yi for xi, yi in zip(x, y))
        sum_x2 = sum(xi**2 for xi in x)

        denominator = n * sum_x2 - sum_x**2
        if denominator == 0:
            slope, intercept = 0, sum_y / n
        else:
            slope = (n * sum_xy - sum_x * sum_y) / denominator
            intercept = (sum_y - slope * sum_x) / n

        # Simple Exponential Smoothing for the residual level
        alpha = 0.3
        residuals = [yi - (slope * xi + intercept) for xi, yi in zip(x, y)]
        level = residuals[0]
        for r in residuals:
            level = alpha * r + (1 - alpha) * level

        forecast_results = []

        last_date = dates[-1]
        if isinstance(last_date, str):
            try:
                if "T" in last_date:
                    last_dt = datetime.datetime.fromisoformat(last_date.replace("Z", ""))
                else:
                    last_dt = datetime.datetime.strptime(last_date, "%Y-%m-%d")
            except Exception:
                last_dt = datetime.datetime.now()
        elif isinstance(last_date, (datetime.date, datetime.datetime)):
            last_dt = last_date
        else:
            last_dt = datetime.datetime.now()

        for i in range(1, periods + 1):
            next_dt = last_dt + datetime.timedelta(days=i)
            val = (slope * (n + i - 1) + intercept) + level
            forecast_results.append(
                {
                    date_col: next_dt.strftime("%Y-%m-%d")
                    if isinstance(last_date, str) and "-" in last_date
                    else next_dt.isoformat(),
                    val_col: float(max(0, val)),
                    "type": "forecast",
                }
            )

        historical = ts_df.with_columns(pl.lit("historical").alias("type")).to_dicts()
        combined = historical + forecast_results
        res = pl.from_dicts(combined)

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
