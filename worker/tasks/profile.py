"""Data Quality Profile — completeness, uniqueness, regulatory pattern detection."""
import asyncio
import os
import re as _re
import traceback

import polars as pl

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


PATTERNS = {
    "PAN":   r"^[A-Z]{5}[0-9]{4}[A-Z]$",
    "GSTIN": r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$",
    "IFSC":  r"^[A-Z]{4}0[A-Z0-9]{6}$",
    "email": r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$",
    "phone": r"^(\+91[\-\s]?)?[6-9]\d{9}$",
}


@celery_app.task(bind=True, name="worker.tasks.run_profile")
def run_profile(self, file_path: str, job_id: str, dataset_id: str | None = None) -> bytes:
    """Per-column profile: completeness, uniqueness, type-mix, top values, pattern detection."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id)
        total_rows = len(df)
        profile_rows: list[dict] = []

        for col in df.columns:
            series = df[col]
            null_count = series.null_count()
            filled_count = total_rows - null_count
            unique_count = series.n_unique()

            completeness = round(filled_count / total_rows * 100, 2) if total_rows else 0
            uniqueness = round(unique_count / total_rows * 100, 2) if total_rows else 0

            mean_val = std_val = min_val = max_val = None
            numeric_pct = 0.0
            dtype = series.dtype
            is_numeric = dtype in (
                pl.Int8, pl.Int16, pl.Int32, pl.Int64,
                pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
                pl.Float32, pl.Float64,
            )
            if is_numeric:
                non_null = series.drop_nulls()
                if len(non_null):
                    mean_val = float(non_null.mean())
                    std_val = float(non_null.std()) if len(non_null) > 1 else 0.0
                    min_val = float(non_null.min())
                    max_val = float(non_null.max())
                numeric_pct = 100.0
            else:
                cast_ok = series.cast(pl.Float64, strict=False).drop_nulls()
                numeric_pct = round(len(cast_ok) / total_rows * 100, 2) if total_rows else 0

            detected_pattern = None
            pattern_match_pct = 0.0
            if not is_numeric and filled_count > 0:
                str_series = series.drop_nulls().cast(pl.String)
                sample = str_series.head(min(500, len(str_series))).to_list()
                for pat_name, pat_regex in PATTERNS.items():
                    matched = sum(
                        1 for v in sample if _re.match(pat_regex, str(v).strip())
                    )
                    pct = matched / len(sample) * 100
                    if pct >= 70:
                        detected_pattern = pat_name
                        pattern_match_pct = round(pct, 2)
                        break

            top_vals = series.value_counts(sort=True).head(5).to_dicts()
            top_values_str = "; ".join(
                f"{v.get(col, v.get('value', ''))} ({v.get('count', 0)})"
                for v in top_vals
            )

            quality_score = completeness
            if numeric_pct > 0 and not is_numeric:
                quality_score -= (100 - numeric_pct) * 0.3
            quality_score = max(0.0, min(100.0, round(quality_score, 1)))

            profile_rows.append({
                "column": col,
                "dtype": str(dtype),
                "total_rows": total_rows,
                "null_count": null_count,
                "filled_count": filled_count,
                "completeness_pct": completeness,
                "unique_count": unique_count,
                "uniqueness_pct": uniqueness,
                "numeric_pct": numeric_pct,
                "mean": mean_val,
                "std": std_val,
                "min": min_val,
                "max": max_val,
                "detected_pattern": detected_pattern,
                "pattern_match_pct": pattern_match_pct,
                "top_values": top_values_str,
                "quality_score": quality_score,
            })

        result_df = pl.from_dicts(profile_rows)
        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result_df.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
        return None
    except Exception as e:
        asyncio.run(
            update_job_status(job_id, "failed", error_message=traceback.format_exc())
        )
        raise e
