"""Job lifecycle + DuckDB result querying + raw-file data preview + SSE + cancel."""
import asyncio
import json
import os
from uuid import UUID

import asyncpg
import duckdb
from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.config import settings
from app.db import get_db_pool
from app.deps import get_current_user
from app.duckdb_helper import get_duckdb_conn
from app.logging_config import get_correlation_id, set_correlation_id

router = APIRouter()


@router.post("/jobs", response_model=dict)
async def create_job(
    task_name: str,
    file_path: str = "",
    dataset_id: str | None = None,
    client_id: str | None = None,
    params: dict = Body(default={}),
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Enqueue a Celery task and return job_id."""
    if not dataset_id and "dataset_id" in params:
        dataset_id = params.pop("dataset_id")

    # Merged/table-backed datasets have no file on disk.
    # Resolve file_path from the DB so the worker can fall back to it,
    # and always pass dataset_id so _load_dataset_df reads from Postgres.
    if dataset_id and not file_path:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT file_path FROM datasets WHERE id = $1",
                UUID(dataset_id),
            )
            if row and row["file_path"]:
                file_path = row["file_path"]
            # file_path may still be "" for merged datasets — that's fine,
            # the worker uses dataset_id to query Postgres directly.

    persisted_params = {k: v for k, v in params.items() if k != "dataset_id"}

    async with pool.acquire() as conn:
        job_id = await conn.fetchval(
            """
            INSERT INTO jobs (status, task_name, client_id, dataset_id, owner, task_params, result_retention_days)
            VALUES ('pending', $1, $2, $3, $4, $5, $6)
            RETURNING id
            """,
            task_name,
            UUID(client_id) if client_id else None,
            UUID(dataset_id) if dataset_id else None,
            user,
            json.dumps(persisted_params) if persisted_params else None,
            30,
        )

    from worker.tasks import (
        summarise_csv,
        run_benford,
        run_outliers,
        run_timeseries,
        run_clustering,
        run_network,
        run_cleaning,
        run_forecast,
        run_profile,
        run_isolation_forest,
    )

    task_map = {
        "summarise_csv": summarise_csv,
        "run_benford": run_benford,
        "run_outliers": run_outliers,
        "run_timeseries": run_timeseries,
        "run_clustering": run_clustering,
        "run_network": run_network,
        "run_cleaning": run_cleaning,
        "run_forecast": run_forecast,
        "run_profile": run_profile,
        "run_isolation_forest": run_isolation_forest,
    }

    if task_name not in task_map:
        raise HTTPException(status_code=400, detail="Invalid task name")

    if dataset_id:
        params["dataset_id"] = dataset_id

    result = task_map[task_name].delay(file_path, str(job_id), **params)
    celery_task_id = result.id

    # Store celery task id for cancellation
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET celery_task_id = $1 WHERE id = $2",
            celery_task_id, job_id,
        )

    return {"job_id": str(job_id), "status": "pending", "celery_task_id": celery_task_id}


@router.get(
    "/jobs/{job_id}",
    response_model=dict,
    dependencies=[Depends(get_current_user)],
)
async def get_job(
    job_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    async with pool.acquire() as conn:
        job = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    raw_params = job["task_params"]
    if isinstance(raw_params, str):
        try:
            raw_params = json.loads(raw_params)
        except (TypeError, ValueError):
            raw_params = None

    return {
        "id": str(job["id"]),
        "status": job["status"],
        "task_name": job["task_name"],
        "task_params": raw_params,
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "result_path": job["result_path"],
        "error_message": job["error_message"],
        "dataset_id": str(job["dataset_id"]) if job["dataset_id"] else None,
        "celery_task_id": job["celery_task_id"],
        "cancelled_at": job["cancelled_at"],
    }


@router.post("/jobs/{job_id}/cancel", response_model=dict)
async def cancel_job(
    job_id: UUID,
    user: str = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Revoke a running Celery task and mark the job as cancelled."""
    async with pool.acquire() as conn:
        job = await conn.fetchrow(
            "SELECT status, celery_task_id, owner FROM jobs WHERE id = $1", job_id
        )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["owner"] != user:
        raise HTTPException(status_code=403, detail="Only the job owner can cancel it")
    if job["status"] in ("completed", "failed", "cancelled"):
        return {"job_id": str(job_id), "status": job["status"], "message": "Job already terminal"}

    celery_task_id = job["celery_task_id"]
    if celery_task_id:
        from celery import Celery
        from app.config import settings
        celery_app = Celery(broker=settings.REDIS_URL)
        celery_app.control.revoke(celery_task_id, terminate=True)

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
            job_id,
        )

    return {"job_id": str(job_id), "status": "cancelled"}


@router.get("/jobs/{job_id}/events")
async def job_events(
    job_id: UUID,
    token: str | None = None,
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Server-Sent Events stream for job status.
    Replaces frontend polling with a single persistent connection.
    """
    async def event_stream():
        last_status = None
        tries = 0
        max_tries = 1800  # 30 minutes at 1s intervals
        while tries < max_tries:
            async with pool.acquire() as conn:
                job = await conn.fetchrow(
                    "SELECT status, result_path, error_message, updated_at FROM jobs WHERE id = $1",
                    job_id,
                )
            if not job:
                yield f"event: error\ndata: {{\"detail\": \"Job not found\"}}\n\n"
                break

            status = job["status"]
            if status != last_status:
                last_status = status
                payload = json.dumps({
                    "status": status,
                    "result_path": job["result_path"],
                    "error_message": job["error_message"],
                    "updated_at": job["updated_at"].isoformat() if job["updated_at"] else None,
                })
                yield f"event: status\ndata: {payload}\n\n"

            if status in ("completed", "failed", "cancelled"):
                yield f"event: done\ndata: {{\"status\": \"{status}\"}}\n\n"
                break

            tries += 1
            await asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Correlation-ID": get_correlation_id(),
        },
    )


@router.post("/internal/cleanup", response_model=dict)
async def cleanup_old_results(
    token: str = Body(..., embed=True),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    """Delete result Parquet files older than their retention period.
    Intended to be called by a nightly systemd timer (see host-configs).
    """
    from app.config import settings
    if token != settings.API_AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, result_path, updated_at, result_retention_days
            FROM jobs
            WHERE result_path IS NOT NULL
              AND status IN ('completed', 'failed', 'cancelled')
              AND updated_at < now() - make_interval(days => COALESCE(result_retention_days, 30))
            """
        )

    deleted_files = 0
    deleted_rows = 0
    for row in rows:
        path = row["result_path"]
        if path and os.path.exists(path):
            try:
                os.remove(path)
                deleted_files += 1
            except OSError:
                pass
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE jobs SET result_path = NULL WHERE id = $1",
                row["id"],
            )
            deleted_rows += 1

    return {"deleted_files": deleted_files, "updated_rows": deleted_rows}


@router.post(
    "/query", response_model=dict, dependencies=[Depends(get_current_user)]
)
async def query_job_result(
    job_id: UUID = Body(...),
    sql: str = Body(...),
    pool: asyncpg.Pool = Depends(get_db_pool),
    duck_conn: duckdb.DuckDBPyConnection = Depends(get_duckdb_conn),
):
    """Query a job's result Parquet file using DuckDB."""
    async with pool.acquire() as conn:
        job = await conn.fetchrow(
            "SELECT result_path FROM jobs WHERE id = $1", job_id
        )

    if not job or not job["result_path"]:
        raise HTTPException(status_code=404, detail="Job result not found")

    result_path = job["result_path"]

    results_dir = os.path.join(os.path.realpath(settings.DATA_DIR), "results")
    if not os.path.realpath(result_path).startswith(results_dir):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="Result file missing on disk")

    sql_clean = sql.strip().lstrip("(").upper()
    if not sql_clean.startswith("SELECT") and not sql_clean.startswith("WITH"):
        raise HTTPException(
            status_code=400, detail="Only SELECT queries are allowed"
        )

    try:
        view_name = f"job_{str(job_id).replace('-', '_')}"
        duck_conn.execute(
            f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{result_path}')"
        )
        res_df = duck_conn.execute(sql.replace("RESULT_TABLE", view_name)).pl()
        return {"columns": res_df.columns, "data": res_df.to_dicts()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query error: {e}")


@router.get("/data", response_model=dict, dependencies=[Depends(get_current_user)])
async def get_source_data(
    file_path: str,
    limit: int = 50,
    offset: int = 0,
    sort_by: str = None,
    sort_order: str = "asc",
    filter_col: str = None,
    filter_val: str = None,
    filter_regex: bool = False,
    duck_conn: duckdb.DuckDBPyConnection = Depends(get_duckdb_conn),
):
    real = os.path.realpath(file_path)
    data_dir = os.path.realpath(settings.DATA_DIR)
    if not real.startswith(data_dir + os.sep):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    if sort_order not in ("asc", "desc"):
        raise HTTPException(
            status_code=400, detail="sort_order must be 'asc' or 'desc'"
        )

    try:
        view_name = "source_data"
        ext = os.path.splitext(real)[1].lower()
        if ext == ".csv":
            reader_sql = f"read_csv_auto('{real}')"
        elif ext == ".xlsx":
            reader_sql = f"read_xlsx_auto('{real}')"
        elif ext == ".parquet":
            reader_sql = f"read_parquet('{real}')"
        else:
            reader_sql = f"read_csv_auto('{real}')"
        duck_conn.execute(
            f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM {reader_sql}"
        )

        col_result = duck_conn.execute(f"SELECT * FROM {view_name} LIMIT 0").description
        valid_columns = {desc[0] for desc in col_result} if col_result else set()

        if sort_by and sort_by not in valid_columns:
            raise HTTPException(
                status_code=400, detail=f"Invalid sort_by column: {sort_by}"
            )
        if filter_col and filter_col not in valid_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid filter_col column: {filter_col}",
            )

        query = f"SELECT * FROM {view_name}"
        count_query = f"SELECT COUNT(*) FROM {view_name}"
        params: list = []
        count_params: list = []

        if filter_col and filter_val:
            if filter_regex:
                where_clause = f" WHERE CAST({filter_col} AS VARCHAR) ~ ?"
            else:
                where_clause = f" WHERE CAST({filter_col} AS VARCHAR) ILIKE ?"
                filter_val = f"%{filter_val}%"
            query += where_clause
            count_query += where_clause
            params.append(filter_val)
            count_params.append(filter_val)

        if sort_by:
            query += f" ORDER BY {sort_by} {sort_order}"
        query += f" LIMIT {limit} OFFSET {offset}"

        res_df = duck_conn.execute(query, params).pl()
        total_count = duck_conn.execute(count_query, count_params).fetchone()[0]

        return {
            "columns": res_df.columns,
            "data": res_df.to_dicts(),
            "total_count": total_count,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Data retrieval error: {e}")
