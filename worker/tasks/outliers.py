"""Outlier / anomaly detection — Z-score and Isolation-Forest+LOF ensemble."""
import asyncio
import os
import traceback

import polars as pl

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


@celery_app.task(bind=True, name="worker.tasks.run_outliers")
def run_outliers(
    self, file_path: str, job_id: str, column: str, method: str = "zscore", dataset_id: str | None = None
) -> bytes:
    """Z-score outliers on a single numeric column."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id)
        df = df.with_columns(
            pl.col(column)
            .cast(pl.String)
            .str.replace_all(r"[$£€₹,\s]", "")
            .str.replace_all(r"^\-+$", "0")
            .cast(pl.Float64, strict=False)
            .alias(column)
        )
        sub = df.select(column).drop_nulls()
        if len(sub) < 2:
            raise ValueError(f"Column '{column}' has fewer than 2 numeric values after parsing")

        mean = sub[column].mean()
        std = sub[column].std()
        if std == 0:
            raise ValueError(f"Column '{column}' has zero variance — cannot compute Z-scores")

        res = (
            df.with_columns(((pl.col(column) - mean) / std).alias("zscore"))
            .filter((pl.col("zscore").abs() > 3) & pl.col(column).is_not_null())
            .sort("zscore", descending=True, nulls_last=True)
        )

        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        res.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
        return None
    except Exception as e:
        asyncio.run(update_job_status(job_id, "failed", error_message=traceback.format_exc()))
        raise e


@celery_app.task(bind=True, name="worker.tasks.run_isolation_forest")
def run_isolation_forest(
    self,
    file_path: str,
    job_id: str,
    columns: list,
    contamination: float = 0.05,
    dataset_id: str | None = None,
) -> bytes:
    """Ensemble Anomaly Detection: Isolation Forest + LOF with very tolerant cleaning"""
    asyncio.run(update_job_status(job_id, "running"))
    
    try:
        import numpy as np
        from sklearn.ensemble import IsolationForest
        from sklearn.neighbors import LocalOutlierFactor
        from sklearn.preprocessing import StandardScaler

        print(f"[IsolationForest] Job {job_id} started. Columns: {columns}")

        df = _load_dataset_df(file_path, dataset_id)
        original_len = len(df)
        print(f"[IsolationForest] Loaded {original_len} rows")

        # Very tolerant cleaning
        num_cols = []
        for col in columns:
            if col not in df.columns:
                continue
            try:
                cleaned = (
                    pl.col(col)
                    .cast(pl.Utf8)
                    .str.replace_all(r"[$£€₹%,]", "")      # Remove currency symbols
                    .str.replace_all(r"[^\d.-]", "")       # Keep only numbers, dot, minus
                    .str.replace_all(r"^\.+|\.+$", "")     # Remove stray dots
                    .str.replace_all(r"^-+", "-")          # Fix multiple minuses
                    .str.replace_all(r"^0+$", "0")
                    .cast(pl.Float64, strict=False)
                )
                df = df.with_columns(cleaned.alias(col))
                
                valid_count = df.select(pl.col(col).is_not_null().sum()).item()
                print(f"[IsolationForest] Column '{col}': {valid_count}/{original_len} valid numbers")
                
                if valid_count > 0:
                    num_cols.append(col)
            except Exception as e:
                print(f"[IsolationForest] Failed on column {col}: {e}")

        if not num_cols:
            raise ValueError("Could not convert any selected column to numeric values. Please check your data.")

        # Prepare data for modeling
        sub = df.select(num_cols).drop_nulls()
        valid_rows = len(sub)
        print(f"[IsolationForest] Final valid rows for modeling: {valid_rows}")

        if valid_rows < 5:
            raise ValueError(
                f"Only {valid_rows} valid numeric rows found after cleaning. "
                f"Need at least 5 rows with actual numbers in the selected columns."
            )

        X = sub.to_numpy().astype(float)
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Isolation Forest
        iso = IsolationForest(contamination=contamination, random_state=42, n_estimators=100)
        iso_scores = iso.fit_predict(X_scaled)
        iso_raw = iso.score_samples(X_scaled)

        # Local Outlier Factor
        lof = LocalOutlierFactor(n_neighbors=min(20, len(X) - 1), contamination=contamination)
        lof_scores = lof.fit_predict(X_scaled)
        lof_raw = lof.negative_outlier_factor_

        # Combine scores
        def _norm(arr):
            mn, mx = arr.min(), arr.max()
            if mx == mn:
                return np.zeros_like(arr)
            return (arr - mn) / (mx - mn)

        ensemble = (_norm(-iso_raw) + _norm(-lof_raw)) / 2.0
        is_anomaly = ((iso_scores == -1) | (lof_scores == -1)).astype(int)

        reasons = ["Ensemble anomaly detection flagged this record"] * len(ensemble)

        # Build final result
        idx = pl.Series("__row_idx", list(range(len(df))))
        df_idx = df.with_columns(idx)

        sub_idx = df_idx.select(num_cols + ["__row_idx"]).drop_nulls()
        sub_idx = sub_idx.with_columns([
            pl.Series("anomaly_score", [round(float(v), 4) for v in ensemble]),
            pl.Series("is_anomaly", [bool(v) for v in is_anomaly]),
            pl.Series("anomaly_reason", reasons),
        ])

        result = df_idx.join(
            sub_idx.select(["__row_idx", "anomaly_score", "is_anomaly", "anomaly_reason"]),
            on="__row_idx", how="left"
        ).drop("__row_idx")

        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result.write_parquet(result_path)

        print(f"[IsolationForest] Success! Saved result with {len(result)} rows")
        asyncio.run(update_job_status(job_id, "completed", result_path))
        return None

    except Exception as e:
        error_msg = traceback.format_exc()
        print(f"[IsolationForest] ERROR: {error_msg}")
        asyncio.run(update_job_status(job_id, "failed", error_message=error_msg))
        raise e