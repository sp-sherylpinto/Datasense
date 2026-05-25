"""Type-mapping, column rename + reorder, and Postgres table replacement."""
import asyncio
import io
import json as _json
import os
import traceback
import datetime as _dt
from uuid import UUID

import asyncpg
import polars as pl

from app.config import settings
from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status


async def _replace_dataset_table(dataset_id: str, df: pl.DataFrame) -> None:
    """Drop and recreate the datasets.ds_<id> table with the cleaned DataFrame."""
    from app.ingestion import _normalise_df, _pg_type, _infer_type  # noqa: F401

    conn = await asyncpg.connect(settings.DATABASE_URL)
    try:
        row = await conn.fetchrow(
            "SELECT table_name FROM datasets WHERE id = $1", UUID(dataset_id)
        )
        if not row or not row["table_name"]:
            return
        table_name = row["table_name"]

        df, col_meta = _normalise_df(df)

        col_defs = ", ".join(
            f'"{m["name"]}" {_pg_type(m["inferred_type"])}' for m in col_meta
        )
        await conn.execute(f"DROP TABLE IF EXISTS {table_name}")
        await conn.execute(f"CREATE TABLE {table_name} ({col_defs})")

        col_names = [m["name"] for m in col_meta]
        rows = []
        for record_dict in df.to_dicts():
            record = []
            for m in col_meta:
                val = record_dict.get(m["name"])
                inferred = m["inferred_type"]
                if val is None:
                    record.append(None)
                elif inferred == "boolean":
                    record.append(bool(val))
                elif inferred in ("number", "integer", "float", "currency"):
                    # All numeric / currency columns land in DOUBLE PRECISION.
                    # By the time cleaning runs, polars has already coerced
                    # currency strings (`₹1,234.56`) to floats, so a single
                    # float() cast is all that's needed.
                    try:
                        record.append(float(val))
                    except Exception:
                        record.append(None)
                elif inferred in ("date", "datetime"):
                    if isinstance(val, (_dt.date, _dt.datetime)):
                        record.append(val)
                    else:
                        record.append(None)
                else:
                    record.append(str(val) if val is not None else None)
            rows.append(tuple(record))

        await conn.copy_records_to_table(
            table_name.split(".")[-1],
            records=rows,
            columns=col_names,
            schema_name="datasets",
        )

        await conn.execute(
            "UPDATE datasets SET columns = $1, row_count = $2 WHERE id = $3",
            _json.dumps(col_meta),
            len(df),
            UUID(dataset_id),
        )
    finally:
        await conn.close()


@celery_app.task(bind=True, name="worker.tasks.run_cleaning")
def run_cleaning(
    self,
    file_path: str,
    job_id: str,
    mapping: dict,
    column_order: list = None,
    renames: dict = None,
    dataset_id: str = None,
) -> bytes:
    """Apply type mapping, column rename + reorder, then replace the Postgres table."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        if dataset_id:
            async def _fetch_from_db():
                conn = await asyncpg.connect(settings.DATABASE_URL)
                try:
                    row = await conn.fetchrow(
                        "SELECT table_name FROM datasets WHERE id = $1",
                        UUID(dataset_id),
                    )
                    if row and row["table_name"]:
                        db_rows = await conn.fetch(
                            f"SELECT * FROM {row['table_name']}"
                        )
                        if not db_rows:
                            return None
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
                            infer_schema_length=0,
                            ignore_errors=True,
                        )
                    return None
                finally:
                    await conn.close()

            df = asyncio.run(_fetch_from_db())
            if df is None:
                df = _load_dataset_df(file_path, dataset_id)
        else:
            df = _load_dataset_df(file_path, dataset_id)

        from app.ingestion import _normalise_df as _norm
        df, _ = _norm(df)

        # 1. Type mapping
        for col, dtype in mapping.items():
            if col not in df.columns:
                continue

            if dtype == "number":
                if df[col].dtype in (pl.Float64, pl.Int64, pl.Float32, pl.Int32):
                    df = df.with_columns(pl.col(col).cast(pl.Float64, strict=False))
                else:
                    df = df.with_columns(
                        pl.col(col)
                        .cast(pl.String)
                        .str.strip_chars()
                        .str.replace_all(r"[₹$£€,]", "")
                        .str.replace_all(r"^\-+$", "0")
                        .cast(pl.Float64, strict=False)
                    )
            elif dtype == "date":
                if df[col].dtype in (pl.Date, pl.Datetime):
                    df = df.with_columns(pl.col(col).cast(pl.Date, strict=False))
                else:
                    date_formats = [
                        "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y",
                        "%d-%b-%Y", "%d-%b-%y", "%d %b %Y", "%d %b %y",
                        "%B %d, %Y", "%Y%m%d", "%d.%m.%Y", "%m-%d-%Y",
                    ]
                    datetime_formats = [
                        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S%z",
                        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z",
                        "%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S",
                    ]
                    parsed = False
                    for fmt in date_formats + datetime_formats:
                        try:
                            col_data = df[col]
                            parse_fmt = fmt
                            if "%y" in fmt:
                                col_data = col_data.str.replace_all(
                                    r"(\D)(\d{2})$", r"${1}20${2}"
                                )
                                parse_fmt = fmt.replace("%y", "%Y")
                            if fmt in datetime_formats:
                                candidate = col_data.str.to_datetime(
                                    parse_fmt, strict=False
                                ).dt.date()
                            else:
                                candidate = col_data.str.to_date(parse_fmt, strict=False)
                            if candidate.drop_nulls().len() > 0:
                                df = df.with_columns(candidate.alias(col))
                                parsed = True
                                break
                        except Exception:
                            continue
                    if not parsed:
                        pass
            elif dtype == "datetime":
                if df[col].dtype in (pl.Date, pl.Datetime):
                    df = df.with_columns(pl.col(col).cast(pl.Datetime, strict=False))
                else:
                    dt_formats = [
                        "%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S",
                        "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                        "%d-%m-%Y %H:%M", "%d/%m/%Y %H:%M",
                        "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S%z",
                        "%d-%m-%Y %H:%M:%S%z", "%d/%m/%Y %H:%M:%S%z",
                    ]
                    parsed = False
                    for fmt in dt_formats:
                        try:
                            candidate = df[col].str.to_datetime(fmt, strict=False)
                            if candidate.drop_nulls().len() > 0:
                                df = df.with_columns(candidate.alias(col))
                                parsed = True
                                break
                        except Exception:
                            continue
                    if not parsed:
                        pass
            elif dtype == "currency":
                if df[col].dtype in (pl.Float64, pl.Int64, pl.Float32, pl.Int32):
                    df = df.with_columns(pl.col(col).cast(pl.Float64, strict=False))
                else:
                    df = df.with_columns(
                        pl.col(col)
                        .cast(pl.String)
                        .str.strip_chars()
                        .str.replace_all(r"[₹$£€,]", "")
                        .str.strip_chars()
                        .str.replace_all(r"^\-+$", "0")
                        .cast(pl.Float64, strict=False)
                    )
            elif dtype == "boolean":
                df = df.with_columns(pl.col(col).cast(pl.Boolean, strict=False))
            elif dtype == "text":
                df = df.with_columns(pl.col(col).cast(pl.String))

        # 2. Renaming
        if renames:
            valid_renames = {old: new for old, new in renames.items() if old in df.columns}
            if valid_renames:
                df = df.rename(valid_renames)

        # 3. Reordering
        if column_order:
            final_order = []
            for col in column_order:
                new_name = renames.get(col, col) if renames else col
                if new_name in df.columns:
                    final_order.append(new_name)
            for col in df.columns:
                if col not in final_order:
                    final_order.append(col)
            df = df.select(final_order)

        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.csv")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        df.write_csv(result_path)

        if dataset_id:
            asyncio.run(_replace_dataset_table(dataset_id, df))

        asyncio.run(update_job_status(job_id, "completed", result_path))
        return None
    except Exception as e:
        asyncio.run(
            update_job_status(job_id, "failed", error_message=traceback.format_exc())
        )
        raise e
