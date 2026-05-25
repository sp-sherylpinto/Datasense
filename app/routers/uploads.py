"""File upload endpoint (CSV / XLSX / PDF / Tally XML)."""
import asyncio
import json
import os
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile

from app.ai import classify_dataset, generate_dataset_memo
from app.config import settings
from app.deps import _validate_table_name, get_current_user, get_user_conn, rls_conn
from app.ingestion import ingest_file

router = APIRouter()

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".pdf", ".xml"}


VALID_DATASET_TYPES = {
    "journal_entries", "financial_statements", "debtors_creditors",
    "register_analytics", "general",
}


@router.post("/upload", response_model=dict)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    client_id: str | None = None,
    engagement_id: str | None = None,
    dataset_type: str = "general",
    user: str = Depends(get_current_user),
    rls: tuple = Depends(get_user_conn),
):
    """Upload CSV, XLSX, PDF (digital), or Tally XML."""
    rls_pool, owner = rls
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )
    file_type = ext.lstrip(".")

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_id = str(uuid4())
    save_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}{ext}")

    file_bytes = await file.read()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: open(save_path, "wb").write(file_bytes))

    try:
        async with rls_conn(rls_pool, owner) as conn:
            meta = await ingest_file(conn, save_path, file_type)
            dataset_id = await conn.fetchval(
                """
                INSERT INTO datasets
                    (client_id, engagement_id, original_filename, file_type,
                     table_name, file_path, row_count, columns, ingest_warnings, owner,
                     dataset_type, pii_detected, pii_summary)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                RETURNING id
                """,
                UUID(client_id) if client_id else None,
                UUID(engagement_id) if engagement_id else None,
                file.filename,
                file_type,
                meta["table_name"],
                save_path,
                meta["row_count"],
                json.dumps(meta["columns"]),
                json.dumps(meta["warnings"]),
                owner,
                dataset_type if dataset_type in VALID_DATASET_TYPES else "general",
                meta.get("pii_detected", False),
                json.dumps(meta.get("pii_summary")) if meta.get("pii_summary") else None,
            )

        preview: list[dict] = []
        if meta["table_name"]:
            async with rls_conn(rls_pool, owner) as conn:
                rows = await conn.fetch(
                    f"SELECT * FROM {_validate_table_name(meta['table_name'])} LIMIT 10"
                )
                preview = [dict(r) for r in rows]

        # Classify dataset type in background — does not block upload response
        samples = (
            {
                col["name"]: [
                    str(preview[i].get(col["name"], ""))
                    for i in range(min(5, len(preview)))
                ]
                for col in meta["columns"]
            }
            if preview
            else {col["name"]: [] for col in meta["columns"]}
        )
        background_tasks.add_task(
            classify_dataset,
            str(dataset_id),
            [c["name"] for c in meta["columns"]],
            samples,
            settings.DATABASE_URL,
            owner,
        )
        # Per-dataset characterisation memo — runs once after upload, cached
        # on the dataset row, prepended to every subsequent AI call about
        # this dataset. Smarter answers without re-discovering context.
        background_tasks.add_task(
            generate_dataset_memo,
            str(dataset_id),
            settings.DATABASE_URL,
            owner=owner,
        )

        return {
            "dataset_id": str(dataset_id),
            "file_id": file_id,
            "file_path": save_path,
            "table_name": meta["table_name"],
            "row_count": meta["row_count"],
            "columns": meta["columns"],
            "warnings": meta["warnings"],
            "preview": preview,
        }
    except Exception as e:
        if os.path.exists(save_path):
            os.remove(save_path)
        raise HTTPException(status_code=400, detail=f"Ingestion error: {e}")
