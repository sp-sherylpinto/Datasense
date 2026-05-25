# """Dataset CRUD + merge + share endpoints."""
# import asyncio
# import json
# import os
# from email.message import EmailMessage
# from uuid import UUID

# import asyncpg
# import polars as pl
# from fastapi import APIRouter, Body, Depends, HTTPException

# from app.config import settings
# from app.db import get_db_pool
# from app.deps import _validate_table_name, get_user_conn, rls_conn
# from app.ingestion import _infer_type, ingest_dataframe

# logger = __import__("logging").getLogger(__name__)


# # ─── Share notification email ─────────────────────────────────────────────────

# def _share_email_html(shared_with: str, granted_by: str, filename: str, app_url: str) -> str:
#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     return f"""<!DOCTYPE html>
# <html><head><meta charset="UTF-8"></head>
# <body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;">
# <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:32px 16px;">
# <tr><td align="center">
# <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e3d8;">
#   <tr><td style="background:#9a3324;padding:24px 32px;border-radius:8px 8px 0 0;">
#     <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Varma &amp; Varma · DataSense</p>
#     <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">A dataset was shared with you</h1>
#   </td></tr>
#   <tr><td style="padding:32px;">
#     <p style="margin:0 0 16px;color:#3d3530;font-size:15px;">Hi {shared_with.split('@')[0].replace('.', ' ').title()},</p>
#     <p style="margin:0 0 24px;color:#5c534d;font-size:14px;line-height:1.6;">
#       <strong>{sharer_display}</strong> (<a href="mailto:{granted_by}" style="color:#9a3324;text-decoration:none;">{granted_by}</a>)
#       has shared a dataset with you on DataSense Pro.
#     </p>
#     <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e3d8;border-radius:6px;margin-bottom:24px;">
#       <tr><td style="padding:14px 18px;">
#         <p style="margin:0 0 4px;font-size:11px;color:#a89d96;letter-spacing:0.06em;text-transform:uppercase;">Dataset</p>
#         <p style="margin:0;font-size:14px;font-weight:600;color:#3d3530;font-family:monospace;">{filename}</p>
#       </td></tr>
#     </table>
#     <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
#       <tr><td style="background:#9a3324;border-radius:6px;">
#         <a href="{app_url}" style="display:inline-block;padding:11px 24px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Open DataSense</a>
#       </td></tr>
#     </table>
#     <p style="margin:0;color:#a89d96;font-size:12px;line-height:1.6;">
#       The dataset will appear in your DataSense library once you log in.
#       You can view and analyse it but cannot share it further or delete it.
#     </p>
#   </td></tr>
#   <tr><td style="padding:16px 32px;background:#faf8f5;border-top:1px solid #e8e3d8;border-radius:0 0 8px 8px;">
#     <p style="margin:0;color:#a89d96;font-size:11px;">Varma &amp; Varma Chartered Accountants · Automated notification from DataSense Pro.</p>
#   </td></tr>
# </table>
# </td></tr></table>
# </body></html>"""


# async def _send_share_notification(shared_with: str, granted_by: str, filename: str) -> None:
#     if not settings.SMTP_HOST or not shared_with:
#         return
#     import aiosmtplib

#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     msg = EmailMessage()
#     msg["Subject"] = f'{sharer_display} shared "{filename}" with you on DataSense'
#     msg["From"] = settings.SMTP_FROM
#     msg["To"] = shared_with
#     msg.set_content(
#         f"Hi,\n\n{sharer_display} ({granted_by}) has shared the dataset \"{filename}\" with you on DataSense Pro.\n\n"
#         f"Open DataSense: {settings.APP_URL}\n\n"
#         "The dataset will appear in your DataSense library once you log in."
#     )
#     msg.add_alternative(
#         _share_email_html(shared_with, granted_by, filename, settings.APP_URL),
#         subtype="html",
#     )
#     try:
#         await aiosmtplib.send(
#             msg,
#             hostname=settings.SMTP_HOST,
#             port=settings.SMTP_PORT,
#             username=settings.SMTP_USER,
#             password=settings.SMTP_PASS,
#             start_tls=settings.SMTP_USE_TLS,
#             use_tls=settings.SMTP_USE_SSL,
#         )
#         logger.info("Share notification sent to %s for dataset %s", shared_with, filename)
#     except Exception as exc:
#         logger.warning("Failed to send share notification to %s: %s", shared_with, exc)

# router = APIRouter()


# @router.get("/datasets", response_model=list)
# async def list_datasets(rls: tuple = Depends(get_user_conn)):
#     """List datasets visible to the current user (RLS enforced)."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, original_filename, file_type, table_name, row_count, columns, ingest_warnings, created_at, owner, dataset_type, audit_area_code, pii_detected, lineage FROM datasets ORDER BY created_at DESC"
#         )
#     return [dict(r) for r in rows]


# @router.get("/datasets/{dataset_id}", response_model=dict)
# async def get_dataset(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT * FROM datasets WHERE id = $1", dataset_id
#         )
#     if not row:
#         raise HTTPException(status_code=404, detail="Dataset not found")
#     return dict(row)


# @router.delete("/datasets/{dataset_id}")
# async def delete_dataset(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
#     pool: asyncpg.Pool = Depends(get_db_pool),
# ):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT file_path, table_name FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         await conn.execute(
#             "UPDATE jobs SET dataset_id = NULL WHERE dataset_id = $1",
#             dataset_id,
#         )
#         await conn.execute("DELETE FROM datasets WHERE id = $1", dataset_id)

#     # DROP TABLE requires the superuser pool — analytics_app doesn't own dataset tables
#     if row["table_name"]:
#         async with pool.acquire() as conn:
#             await conn.execute(
#                 f"DROP TABLE IF EXISTS {_validate_table_name(row['table_name'])}"
#             )

#     if row["file_path"] and os.path.exists(row["file_path"]):
#         os.remove(row["file_path"])

#     return {"deleted": str(dataset_id)}


# @router.post("/datasets/{dataset_id}/redetect", response_model=dict)
# async def redetect_types(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Re-run type inference against the current data in the dataset's
#     Postgres table and update the saved `columns` JSONB metadata.

#     Useful when:
#     - The dataset was uploaded before the inference logic was last improved.
#     - A user has run a cleaning job that changed types and the saved
#       metadata has drifted from the actual table schema.

#     Reads up to 5,000 rows for the inference sample (more than enough for
#     pattern detection; keeps latency low even on huge tables).
#     """
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         ds = await conn.fetchrow(
#             "SELECT id, table_name, columns FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not ds:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if not ds["table_name"]:
#             raise HTTPException(
#                 status_code=400, detail="Dataset has no underlying table"
#             )

#         _validate_table_name(ds["table_name"])
#         rows = await conn.fetch(
#             f"SELECT * FROM {ds['table_name']} LIMIT 5000"
#         )
#         if not rows:
#             return {"id": str(dataset_id), "columns": ds["columns"], "changed": []}

#         # Build a Polars DataFrame directly from asyncpg's native Python types.
#         # Avoid the CSV-roundtrip approach: str(datetime.date) → "2024-01-01"
#         # is fine, but str(datetime.datetime) → "2024-01-01 00:00:00" makes the
#         # sniffer classify DATE columns as DATETIME after a cleaning run.
#         # Building column-by-column lets Polars retain the real dtype.
#         import datetime as _dt
#         import io
#         col_names = list(rows[0].keys())
#         col_data: dict[str, list] = {c: [] for c in col_names}
#         for r in rows:
#             for c in col_names:
#                 col_data[c].append(r[c])

#         series_list: list[pl.Series] = []
#         for c in col_names:
#             vals = col_data[c]
#             # Peek at first non-None value to choose the right Polars dtype.
#             sample = next((v for v in vals if v is not None), None)
#             try:
#                 if isinstance(sample, bool):
#                     s = pl.Series(c, vals, dtype=pl.Boolean)
#                 elif isinstance(sample, int):
#                     s = pl.Series(c, vals, dtype=pl.Int64)
#                 elif isinstance(sample, float):
#                     s = pl.Series(c, vals, dtype=pl.Float64)
#                 elif isinstance(sample, _dt.datetime):
#                     s = pl.Series(c, vals, dtype=pl.Datetime)
#                 elif isinstance(sample, _dt.date):
#                     s = pl.Series(c, vals, dtype=pl.Date)
#                 else:
#                     # Text / None-only columns — let Polars infer from strings.
#                     str_vals = [str(v) if v is not None else None for v in vals]
#                     s = pl.Series(c, str_vals, dtype=pl.String)
#             except Exception:
#                 # Last resort: stringify everything.
#                 str_vals = [str(v) if v is not None else None for v in vals]
#                 s = pl.Series(c, str_vals, dtype=pl.String)
#             series_list.append(s)

#         df = pl.DataFrame(series_list)

#         # Preserve any non-inference fields (original_name, native_dtype, etc.)
#         # that were saved on prior ingest by merging onto the existing entries.
#         existing = {m["name"]: m for m in (ds["columns"] or []) if m.get("name")}
#         new_meta: list[dict] = []
#         changed: list[dict] = []
#         for col in df.columns:
#             new_type = _infer_type(df[col])
#             prior = existing.get(col, {"name": col, "original_name": col})
#             old_type = prior.get("inferred_type")
#             merged = {
#                 **prior,
#                 "name": col,
#                 "inferred_type": new_type,
#             }
#             new_meta.append(merged)
#             if old_type != new_type:
#                 changed.append({"column": col, "from": old_type, "to": new_type})

#         await conn.execute(
#             "UPDATE datasets SET columns = $1 WHERE id = $2",
#             json.dumps(new_meta),
#             dataset_id,
#         )

#     return {"id": str(dataset_id), "columns": new_meta, "changed": changed}


# @router.patch("/datasets/{dataset_id}", response_model=dict)
# async def update_dataset(
#     dataset_id: UUID,
#     dataset_type: str | None = Body(default=None, embed=True),
#     audit_area_code: str | None = Body(default=None, embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Owner-editable dataset metadata: dataset_type (auto-detect override)
#     and audit_area_code (firm A–Z tag, see core.audit_areas)."""
#     if dataset_type is None and audit_area_code is None:
#         raise HTTPException(
#             status_code=400,
#             detail="Provide at least one of: dataset_type, audit_area_code",
#         )

#     if dataset_type is not None:
#         valid_types = {
#             "journal_entries", "financial_statements", "debtors_creditors",
#             "register_analytics", "general",
#         }
#         if dataset_type not in valid_types:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Invalid dataset_type. Must be one of: {valid_types}",
#             )

#     # audit_area_code: empty string means "clear the tag"; treat as NULL.
#     # Otherwise it's a `vertical:code` id (e.g. 'general:F-PPE'); the FK to
#     # core.audit_areas(id) gives the final word on validity.
#     audit_area_clear = audit_area_code == ""
#     if audit_area_code and not audit_area_clear:
#         if ":" not in audit_area_code or len(audit_area_code) > 100:
#             raise HTTPException(
#                 status_code=400,
#                 detail="audit_area_code must look like 'vertical:code' (e.g. 'general:F-PPE')",
#             )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         sets: list[str] = []
#         args: list = []
#         if dataset_type is not None:
#             args.append(dataset_type)
#             sets.append(f"dataset_type = ${len(args)}")
#         if audit_area_code is not None:
#             args.append(None if audit_area_clear else audit_area_code)
#             sets.append(f"audit_area_code = ${len(args)}")
#         args.append(dataset_id)
#         try:
#             row = await conn.fetchrow(
#                 f"UPDATE datasets SET {', '.join(sets)} WHERE id = ${len(args)} "
#                 "RETURNING id, dataset_type, audit_area_code",
#                 *args,
#             )
#         except asyncpg.ForeignKeyViolationError:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Unknown audit_area_code (not in core.audit_areas)",
#             )
#     if not row:
#         raise HTTPException(
#             status_code=404, detail="Dataset not found or not owned by you"
#         )
#     return dict(row)


# @router.post("/datasets/merge", response_model=dict)
# async def merge_datasets(
#     dataset_ids: list[str] = Body(..., embed=True),
#     name: str = Body(..., embed=True),
#     strategy: str = Body(default="union_all", embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Stack rows from multiple datasets into a new dataset.

#     **strategy** controls how tables are combined:
#     - `union_all` (default) — server-side `UNION ALL` in Postgres; handles
#       arbitrary row counts without Python memory pressure.
#     - `diagonal` — legacy Polars diagonal_relaxed concat; used only when
#       column-name alignment is impossible server-side.
#     """
#     if len(dataset_ids) < 2:
#         raise HTTPException(
#             status_code=400, detail="Select at least 2 datasets to merge"
#         )
#     if strategy not in {"union_all", "diagonal"}:
#         raise HTTPException(
#             status_code=400, detail="strategy must be 'union_all' or 'diagonal'"
#         )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, table_name, original_filename, row_count FROM datasets WHERE id = ANY($1::uuid[]) AND table_name IS NOT NULL",
#             [UUID(i) for i in dataset_ids],
#         )
#         if len(rows) < 2:
#             raise HTTPException(
#                 status_code=404,
#                 detail="Could not find 2 or more accessible datasets",
#             )

#         table_names = [r["table_name"] for r in rows]
#         validated = [_validate_table_name(t) for t in table_names]

#         if strategy == "union_all":
#             # 1. Discover the union of all columns across all tables
#             all_cols: set[str] = set()
#             per_table_cols: list[list[str]] = []
#             for t in validated:
#                 cols = await conn.fetch(
#                     f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'datasets' AND table_name = $1",
#                     t.split(".")[-1],
#                 )
#                 cnames = [c["column_name"] for c in cols]
#                 per_table_cols.append(cnames)
#                 all_cols.update(cnames)

#             ordered_cols = sorted(all_cols)

#             # 2. Build SELECT expressions with NULL padding for missing columns
#             selects: list[str] = []
#             for idx, cnames in enumerate(per_table_cols):
#                 col_set = set(cnames)
#                 exprs = []
#                 for c in ordered_cols:
#                     if c in col_set:
#                         exprs.append(f'"{c}"')
#                     else:
#                         exprs.append("NULL AS \"" + c + "\"")
#                 table = validated[idx]
#                 selects.append(f"SELECT {', '.join(exprs)} FROM {table}")

#             union_sql = " UNION ALL ".join(selects)

#             # 3. Create new table
#             import uuid as uuid_mod
#             new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
#             await conn.execute(f"CREATE TABLE {new_table} AS {union_sql}")

#             # 4. Count rows
#             row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

#             # 5. Build column metadata
#             col_meta = [
#                 {"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False}
#                 for c in ordered_cols
#             ]

#             # 6. Redetect types from the merged table (sample)
#             sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
#             if sample_rows:
#                 import io
#                 csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
#                 for r in sample_rows:
#                     vals = []
#                     for c in ordered_cols:
#                         v = r[c]
#                         if v is None:
#                             vals.append("")
#                         else:
#                             s = str(v).replace('"', '""')
#                             vals.append(f'"{s}"')
#                     csv_lines.append(",".join(vals))
#                 df = pl.read_csv(
#                     io.StringIO("\n".join(csv_lines)),
#                     infer_schema_length=10_000,
#                     ignore_errors=True,
#                 )
#                 col_meta = []
#                 for c in ordered_cols:
#                     col_meta.append({
#                         "name": c,
#                         "original_name": c,
#                         "inferred_type": _infer_type(df[c]),
#                         "native_dtype": False,
#                     })

#         else:
#             # Legacy diagonal merge via Polars (fallback)
#             dfs: list[pl.DataFrame] = []
#             for t in validated:
#                 db_rows = await conn.fetch(f"SELECT * FROM {t}")
#                 if db_rows:
#                     dfs.append(pl.from_dicts([dict(r) for r in db_rows]))

#             if not dfs:
#                 raise HTTPException(
#                     status_code=400, detail="Selected datasets contain no data"
#                 )

#             merged_df = pl.concat(dfs, how="diagonal_relaxed")
#             meta = await ingest_dataframe(conn, merged_df)
#             if not meta["table_name"]:
#                 raise HTTPException(
#                     status_code=400, detail="Merge produced no data"
#                 )
#             new_table = meta["table_name"]
#             row_count = meta["row_count"]
#             col_meta = meta["columns"]

#         # Build lineage
#         lineage = {
#             "source_type": "merge",
#             "strategy": strategy,
#             "parents": [str(r["id"]) for r in rows],
#             "parent_names": [r["original_filename"] for r in rows],
#             "parent_row_counts": [r["row_count"] for r in rows],
#             "performed_by": owner,
#             "performed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
#         }

#         dataset_id = await conn.fetchval(
#             """
#             INSERT INTO datasets
#                 (client_id, engagement_id, original_filename, file_type,
#                  table_name, file_path, row_count, columns, ingest_warnings, owner, lineage)
#             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
#             RETURNING id
#             """,
#             None,  # client_id — will be set by EngagementPicker once SPA wires it
#             None,  # engagement_id
#             name,
#             "merged",
#             new_table,
#             None,
#             row_count,
#             json.dumps(col_meta),
#             json.dumps([]),
#             owner,
#             json.dumps(lineage),
#         )

#     return {
#         "id": str(dataset_id),
#         "original_filename": name,
#         "file_type": "merged",
#         "table_name": new_table,
#         "row_count": row_count,
#         "columns": col_meta,
#         "lineage": lineage,
#     }


# @router.get("/datasets/{dataset_id}/shares", response_model=list)
# async def list_shares(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     """List shares for a dataset. Only the owner can see their share list."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, shared_with, granted_by, created_at FROM dataset_shares WHERE dataset_id = $1",
#             dataset_id,
#         )
#     return [dict(r) for r in rows]


# @router.post("/datasets/{dataset_id}/shares", response_model=dict)
# async def create_share(
#     dataset_id: UUID,
#     shared_with: str = Body(..., embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Grant read access to another user. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner, original_filename FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403, detail="Only the dataset owner can share it"
#             )

#         existing = await conn.fetchval(
#             "SELECT id FROM dataset_shares WHERE dataset_id = $1 AND shared_with = $2",
#             dataset_id,
#             shared_with,
#         )
#         if existing:
#             raise HTTPException(
#                 status_code=409, detail="Already shared with this user"
#             )

#         row = await conn.fetchrow(
#             """
#             INSERT INTO dataset_shares (dataset_id, shared_with, granted_by)
#             VALUES ($1, $2, $3)
#             RETURNING id, dataset_id, shared_with, granted_by, created_at
#             """,
#             dataset_id,
#             shared_with,
#             owner,
#         )

#     filename = dataset_row["original_filename"] or str(dataset_id)
#     asyncio.create_task(_send_share_notification(shared_with, owner, filename))
#     return dict(row)


# @router.delete("/datasets/{dataset_id}/shares/{share_id}")
# async def delete_share(
#     dataset_id: UUID,
#     share_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Revoke a share. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403,
#                 detail="Only the dataset owner can revoke shares",
#             )
#         await conn.execute(
#             "DELETE FROM dataset_shares WHERE id = $1 AND dataset_id = $2",
#             share_id,
#             dataset_id,
#         )
#     return {"deleted": str(share_id)}



# """Dataset CRUD + merge + share endpoints."""
# import asyncio
# import json
# import os
# from email.message import EmailMessage
# from uuid import UUID

# import asyncpg
# import polars as pl
# from fastapi import APIRouter, Body, Depends, HTTPException

# from app.config import settings
# from app.db import get_db_pool
# from app.deps import _validate_table_name, get_user_conn, rls_conn
# from app.ingestion import _infer_type, ingest_dataframe

# logger = __import__("logging").getLogger(__name__)


# # ─── Share notification email ─────────────────────────────────────────────────

# def _share_email_html(shared_with: str, granted_by: str, filename: str, app_url: str) -> str:
#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     return f"""<!DOCTYPE html>
# <html><head><meta charset="UTF-8"></head>
# <body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;">
# <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:32px 16px;">
# <tr><td align="center">
# <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e3d8;">
#   <tr><td style="background:#9a3324;padding:24px 32px;border-radius:8px 8px 0 0;">
#     <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Varma &amp; Varma · DataSense</p>
#     <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">A dataset was shared with you</h1>
#   </td></tr>
#   <tr><td style="padding:32px;">
#     <p style="margin:0 0 16px;color:#3d3530;font-size:15px;">Hi {shared_with.split('@')[0].replace('.', ' ').title()},</p>
#     <p style="margin:0 0 24px;color:#5c534d;font-size:14px;line-height:1.6;">
#       <strong>{sharer_display}</strong> (<a href="mailto:{granted_by}" style="color:#9a3324;text-decoration:none;">{granted_by}</a>)
#       has shared a dataset with you on DataSense Pro.
#     </p>
#     <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e3d8;border-radius:6px;margin-bottom:24px;">
#       <tr><td style="padding:14px 18px;">
#         <p style="margin:0 0 4px;font-size:11px;color:#a89d96;letter-spacing:0.06em;text-transform:uppercase;">Dataset</p>
#         <p style="margin:0;font-size:14px;font-weight:600;color:#3d3530;font-family:monospace;">{filename}</p>
#       </td></tr>
#     </table>
#     <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
#       <tr><td style="background:#9a3324;border-radius:6px;">
#         <a href="{app_url}" style="display:inline-block;padding:11px 24px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Open DataSense</a>
#       </td></tr>
#     </table>
#     <p style="margin:0;color:#a89d96;font-size:12px;line-height:1.6;">
#       The dataset will appear in your DataSense library once you log in.
#       You can view and analyse it but cannot share it further or delete it.
#     </p>
#   </td></tr>
#   <tr><td style="padding:16px 32px;background:#faf8f5;border-top:1px solid #e8e3d8;border-radius:0 0 8px 8px;">
#     <p style="margin:0;color:#a89d96;font-size:11px;">Varma &amp; Varma Chartered Accountants · Automated notification from DataSense Pro.</p>
#   </td></tr>
# </table>
# </td></tr></table>
# </body></html>"""


# async def _send_share_notification(shared_with: str, granted_by: str, filename: str) -> None:
#     if not settings.SMTP_HOST or not shared_with:
#         return
#     import aiosmtplib

#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     msg = EmailMessage()
#     msg["Subject"] = f'{sharer_display} shared "{filename}" with you on DataSense'
#     msg["From"] = settings.SMTP_FROM
#     msg["To"] = shared_with
#     msg.set_content(
#         f"Hi,\n\n{sharer_display} ({granted_by}) has shared the dataset \"{filename}\" with you on DataSense Pro.\n\n"
#         f"Open DataSense: {settings.APP_URL}\n\n"
#         "The dataset will appear in your DataSense library once you log in."
#     )
#     msg.add_alternative(
#         _share_email_html(shared_with, granted_by, filename, settings.APP_URL),
#         subtype="html",
#     )
#     try:
#         await aiosmtplib.send(
#             msg,
#             hostname=settings.SMTP_HOST,
#             port=settings.SMTP_PORT,
#             username=settings.SMTP_USER,
#             password=settings.SMTP_PASS,
#             start_tls=settings.SMTP_USE_TLS,
#             use_tls=settings.SMTP_USE_SSL,
#         )
#         logger.info("Share notification sent to %s for dataset %s", shared_with, filename)
#     except Exception as exc:
#         logger.warning("Failed to send share notification to %s: %s", shared_with, exc)

# router = APIRouter()


# @router.get("/datasets", response_model=list)
# async def list_datasets(rls: tuple = Depends(get_user_conn)):
#     """List datasets visible to the current user (RLS enforced)."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, original_filename, file_type, table_name, row_count, columns, ingest_warnings, created_at, owner, dataset_type, audit_area_code, pii_detected, lineage FROM datasets ORDER BY created_at DESC"
#         )
#     return [dict(r) for r in rows]


# @router.get("/datasets/{dataset_id}", response_model=dict)
# async def get_dataset(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT * FROM datasets WHERE id = $1", dataset_id
#         )
#     if not row:
#         raise HTTPException(status_code=404, detail="Dataset not found")
#     return dict(row)


# @router.delete("/datasets/{dataset_id}")
# async def delete_dataset(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
#     pool: asyncpg.Pool = Depends(get_db_pool),
# ):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT file_path, table_name FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         await conn.execute(
#             "UPDATE jobs SET dataset_id = NULL WHERE dataset_id = $1",
#             dataset_id,
#         )
#         await conn.execute("DELETE FROM datasets WHERE id = $1", dataset_id)

#     # DROP TABLE requires the superuser pool — analytics_app doesn't own dataset tables
#     if row["table_name"]:
#         async with pool.acquire() as conn:
#             await conn.execute(
#                 f"DROP TABLE IF EXISTS {_validate_table_name(row['table_name'])}"
#             )

#     if row["file_path"] and os.path.exists(row["file_path"]):
#         os.remove(row["file_path"])

#     return {"deleted": str(dataset_id)}


# @router.post("/datasets/{dataset_id}/redetect", response_model=dict)
# async def redetect_types(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Re-run type inference against the current data in the dataset's
#     Postgres table and update the saved `columns` JSONB metadata.

#     Useful when:
#     - The dataset was uploaded before the inference logic was last improved.
#     - A user has run a cleaning job that changed types and the saved
#       metadata has drifted from the actual table schema.

#     Reads up to 5,000 rows for the inference sample (more than enough for
#     pattern detection; keeps latency low even on huge tables).
#     """
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         ds = await conn.fetchrow(
#             "SELECT id, table_name, columns FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not ds:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if not ds["table_name"]:
#             raise HTTPException(
#                 status_code=400, detail="Dataset has no underlying table"
#             )

#         _validate_table_name(ds["table_name"])
#         rows = await conn.fetch(
#             f"SELECT * FROM {ds['table_name']} LIMIT 5000"
#         )
#         if not rows:
#             return {"id": str(dataset_id), "columns": ds["columns"], "changed": []}

#         # Build a Polars DataFrame directly from asyncpg's native Python types.
#         # Avoid the CSV-roundtrip approach: str(datetime.date) → "2024-01-01"
#         # is fine, but str(datetime.datetime) → "2024-01-01 00:00:00" makes the
#         # sniffer classify DATE columns as DATETIME after a cleaning run.
#         # Building column-by-column lets Polars retain the real dtype.
#         import datetime as _dt
#         import io
#         col_names = list(rows[0].keys())
#         col_data: dict[str, list] = {c: [] for c in col_names}
#         for r in rows:
#             for c in col_names:
#                 col_data[c].append(r[c])

#         series_list: list[pl.Series] = []
#         for c in col_names:
#             vals = col_data[c]
#             # Peek at first non-None value to choose the right Polars dtype.
#             sample = next((v for v in vals if v is not None), None)
#             try:
#                 if isinstance(sample, bool):
#                     s = pl.Series(c, vals, dtype=pl.Boolean)
#                 elif isinstance(sample, int):
#                     s = pl.Series(c, vals, dtype=pl.Int64)
#                 elif isinstance(sample, float):
#                     s = pl.Series(c, vals, dtype=pl.Float64)
#                 elif isinstance(sample, _dt.datetime):
#                     s = pl.Series(c, vals, dtype=pl.Datetime)
#                 elif isinstance(sample, _dt.date):
#                     s = pl.Series(c, vals, dtype=pl.Date)
#                 else:
#                     # Text / None-only columns — let Polars infer from strings.
#                     str_vals = [str(v) if v is not None else None for v in vals]
#                     s = pl.Series(c, str_vals, dtype=pl.String)
#             except Exception:
#                 # Last resort: stringify everything.
#                 str_vals = [str(v) if v is not None else None for v in vals]
#                 s = pl.Series(c, str_vals, dtype=pl.String)
#             series_list.append(s)

#         df = pl.DataFrame(series_list)

#         # Preserve any non-inference fields (original_name, native_dtype, etc.)
#         # that were saved on prior ingest by merging onto the existing entries.
#         existing = {m["name"]: m for m in (ds["columns"] or []) if m.get("name")}
#         new_meta: list[dict] = []
#         changed: list[dict] = []
#         for col in df.columns:
#             new_type = _infer_type(df[col])
#             prior = existing.get(col, {"name": col, "original_name": col})
#             old_type = prior.get("inferred_type")
#             merged = {
#                 **prior,
#                 "name": col,
#                 "inferred_type": new_type,
#             }
#             new_meta.append(merged)
#             if old_type != new_type:
#                 changed.append({"column": col, "from": old_type, "to": new_type})

#         await conn.execute(
#             "UPDATE datasets SET columns = $1 WHERE id = $2",
#             json.dumps(new_meta),
#             dataset_id,
#         )

#     return {"id": str(dataset_id), "columns": new_meta, "changed": changed}


# @router.patch("/datasets/{dataset_id}", response_model=dict)
# async def update_dataset(
#     dataset_id: UUID,
#     dataset_type: str | None = Body(default=None, embed=True),
#     audit_area_code: str | None = Body(default=None, embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Owner-editable dataset metadata: dataset_type (auto-detect override)
#     and audit_area_code (firm A–Z tag, see core.audit_areas)."""
#     if dataset_type is None and audit_area_code is None:
#         raise HTTPException(
#             status_code=400,
#             detail="Provide at least one of: dataset_type, audit_area_code",
#         )

#     if dataset_type is not None:
#         valid_types = {
#             "journal_entries", "financial_statements", "debtors_creditors",
#             "register_analytics", "general",
#         }
#         if dataset_type not in valid_types:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Invalid dataset_type. Must be one of: {valid_types}",
#             )

#     # audit_area_code: empty string means "clear the tag"; treat as NULL.
#     # Otherwise it's a `vertical:code` id (e.g. 'general:F-PPE'); the FK to
#     # core.audit_areas(id) gives the final word on validity.
#     audit_area_clear = audit_area_code == ""
#     if audit_area_code and not audit_area_clear:
#         if ":" not in audit_area_code or len(audit_area_code) > 100:
#             raise HTTPException(
#                 status_code=400,
#                 detail="audit_area_code must look like 'vertical:code' (e.g. 'general:F-PPE')",
#             )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         sets: list[str] = []
#         args: list = []
#         if dataset_type is not None:
#             args.append(dataset_type)
#             sets.append(f"dataset_type = ${len(args)}")
#         if audit_area_code is not None:
#             args.append(None if audit_area_clear else audit_area_code)
#             sets.append(f"audit_area_code = ${len(args)}")
#         args.append(dataset_id)
#         try:
#             row = await conn.fetchrow(
#                 f"UPDATE datasets SET {', '.join(sets)} WHERE id = ${len(args)} "
#                 "RETURNING id, dataset_type, audit_area_code",
#                 *args,
#             )
#         except asyncpg.ForeignKeyViolationError:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Unknown audit_area_code (not in core.audit_areas)",
#             )
#     if not row:
#         raise HTTPException(
#             status_code=404, detail="Dataset not found or not owned by you"
#         )
#     return dict(row)


# @router.post("/datasets/merge", response_model=dict)
# async def merge_datasets(
#     dataset_ids: list[str] = Body(..., embed=True),
#     name: str = Body(..., embed=True),
#     strategy: str = Body(default="union_all", embed=True),
#     join_key: str | None = Body(default=None, embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Stack or join rows from multiple datasets into a new dataset.

#     **strategy** controls how tables are combined:
#     - `union_all` (default) — server-side UNION ALL; preserves left table column order.
#     - `join` — LEFT JOIN on a shared unique key column (join_key required).
#     - `diagonal` — legacy Polars diagonal_relaxed concat fallback.
#     """
#     if len(dataset_ids) < 2:
#         raise HTTPException(
#             status_code=400, detail="Select at least 2 datasets to merge"
#         )
#     if strategy not in {"union_all", "join", "diagonal"}:
#         raise HTTPException(
#             status_code=400, detail="strategy must be 'union_all', 'join', or 'diagonal'"
#         )
#     if strategy == "join" and not join_key:
#         raise HTTPException(
#             status_code=400, detail="join_key is required when strategy is 'join'"
#         )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, table_name, original_filename, row_count FROM datasets WHERE id = ANY($1::uuid[]) AND table_name IS NOT NULL",
#             [UUID(i) for i in dataset_ids],
#         )
#         if len(rows) < 2:
#             raise HTTPException(
#                 status_code=404,
#                 detail="Could not find 2 or more accessible datasets",
#             )

#         table_names = [r["table_name"] for r in rows]
#         validated = [_validate_table_name(t) for t in table_names]

#         if strategy == "union_all":
#             # 1. Discover the union of all columns across all tables
#             all_cols: set[str] = set()
#             per_table_cols: list[list[str]] = []
#             for t in validated:
#                 cols = await conn.fetch(
#                     f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'datasets' AND table_name = $1",
#                     t.split(".")[-1],
#                 )
#                 cnames = [c["column_name"] for c in cols]
#                 per_table_cols.append(cnames)
#                 all_cols.update(cnames)

#             # Preserve left (primary) table column order, append extra cols from other tables
#             left_cols = per_table_cols[0]
#             extra_cols = [c for c in all_cols if c not in set(left_cols)]
#             ordered_cols = left_cols + sorted(extra_cols)

#             # 2. Build SELECT expressions with NULL padding for missing columns
#             selects: list[str] = []
#             for idx, cnames in enumerate(per_table_cols):
#                 col_set = set(cnames)
#                 exprs = []
#                 for c in ordered_cols:
#                     if c in col_set:
#                         exprs.append(f'"{c}"')
#                     else:
#                         exprs.append("NULL AS \"" + c + "\"")
#                 table = validated[idx]
#                 selects.append(f"SELECT {', '.join(exprs)} FROM {table}")

#             union_sql = " UNION ALL ".join(selects)

#             # 3. Create new table
#             import uuid as uuid_mod
#             new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
#             await conn.execute(f"CREATE TABLE {new_table} AS {union_sql}")

#             # 4. Count rows
#             row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

#             # 5. Build column metadata
#             col_meta = [
#                 {"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False}
#                 for c in ordered_cols
#             ]

#             # 6. Redetect types from the merged table (sample)
#             sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
#             if sample_rows:
#                 import io
#                 csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
#                 for r in sample_rows:
#                     vals = []
#                     for c in ordered_cols:
#                         v = r[c]
#                         if v is None:
#                             vals.append("")
#                         else:
#                             s = str(v).replace('"', '""')
#                             vals.append(f'"{s}"')
#                     csv_lines.append(",".join(vals))
#                 df = pl.read_csv(
#                     io.StringIO("\n".join(csv_lines)),
#                     infer_schema_length=10_000,
#                     ignore_errors=True,
#                 )
#                 col_meta = []
#                 for c in ordered_cols:
#                     col_meta.append({
#                         "name": c,
#                         "original_name": c,
#                         "inferred_type": _infer_type(df[c]),
#                         "native_dtype": False,
#                     })

#         elif strategy == "join":
#             # LEFT JOIN on a shared unique key — left table is primary
#             import uuid as uuid_mod
#             left_table  = validated[0]
#             right_table = validated[1]

#             # Get left table columns (preserves original order)
#             left_cols_rows = await conn.fetch(
#                 "SELECT column_name FROM information_schema.columns "
#                 "WHERE table_schema = 'datasets' AND table_name = $1 ORDER BY ordinal_position",
#                 left_table.split(".")[-1],
#             )
#             left_cols = [c["column_name"] for c in left_cols_rows]

#             # Get right table columns
#             right_cols_rows = await conn.fetch(
#                 "SELECT column_name FROM information_schema.columns "
#                 "WHERE table_schema = 'datasets' AND table_name = $1 ORDER BY ordinal_position",
#                 right_table.split(".")[-1],
#             )
#             right_cols = [c["column_name"] for c in right_cols_rows]

#             # Build SELECT: all left cols first, then right cols (excluding join key to avoid duplicate)
#             left_exprs  = [f'l."{c}"' for c in left_cols]
#             right_exprs = [f'r."{c}" AS "{c}"' for c in right_cols if c != join_key]

#             all_exprs = left_exprs + right_exprs
#             ordered_cols = left_cols + [c for c in right_cols if c != join_key]

#             join_sql = (
#                 f"SELECT {', '.join(all_exprs)} "
#                 f"FROM {left_table} l "
#                 f"LEFT JOIN {right_table} r ON l.\"{join_key}\" = r.\"{join_key}\""
#             )

#             new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
#             await conn.execute(f"CREATE TABLE {new_table} AS {join_sql}")
#             row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

#             # Build col metadata
#             sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
#             col_meta = []
#             if sample_rows:
#                 import io
#                 csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
#                 for r in sample_rows:
#                     vals = []
#                     for c in ordered_cols:
#                         v = r[c] if c in dict(r) else None
#                         if v is None:
#                             vals.append("")
#                         else:
#                             s = str(v).replace('"', '""')
#                             vals.append(f'"{s}"')
#                     csv_lines.append(",".join(vals))
#                 df = pl.read_csv(
#                     io.StringIO("\n".join(csv_lines)),
#                     infer_schema_length=10_000,
#                     ignore_errors=True,
#                 )
#                 for c in ordered_cols:
#                     col_meta.append({
#                         "name": c,
#                         "original_name": c,
#                         "inferred_type": _infer_type(df[c]) if c in df.columns else "text",
#                         "native_dtype": False,
#                     })
#             else:
#                 col_meta = [{"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False} for c in ordered_cols]

#         else:
#             # Legacy diagonal merge via Polars (fallback)
#             dfs: list[pl.DataFrame] = []
#             for t in validated:
#                 db_rows = await conn.fetch(f"SELECT * FROM {t}")
#                 if db_rows:
#                     dfs.append(pl.from_dicts([dict(r) for r in db_rows]))

#             if not dfs:
#                 raise HTTPException(
#                     status_code=400, detail="Selected datasets contain no data"
#                 )

#             merged_df = pl.concat(dfs, how="diagonal_relaxed")
#             meta = await ingest_dataframe(conn, merged_df)
#             if not meta["table_name"]:
#                 raise HTTPException(
#                     status_code=400, detail="Merge produced no data"
#                 )
#             new_table = meta["table_name"]
#             row_count = meta["row_count"]
#             col_meta = meta["columns"]

#         # Build lineage
#         lineage = {
#             "source_type": "merge",
#             "strategy": strategy,
#             "join_key": join_key,
#             "parents": [str(r["id"]) for r in rows],
#             "parent_names": [r["original_filename"] for r in rows],
#             "parent_row_counts": [r["row_count"] for r in rows],
#             "performed_by": owner,
#             "performed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
#         }

#         dataset_id = await conn.fetchval(
#             """
#             INSERT INTO datasets
#                 (client_id, engagement_id, original_filename, file_type,
#                  table_name, file_path, row_count, columns, ingest_warnings, owner, lineage)
#             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
#             RETURNING id
#             """,
#             None,  # client_id — will be set by EngagementPicker once SPA wires it
#             None,  # engagement_id
#             name,
#             "merged",
#             new_table,
#             None,
#             row_count,
#             json.dumps(col_meta),
#             json.dumps([]),
#             owner,
#             json.dumps(lineage),
#         )

#     return {
#         "id": str(dataset_id),
#         "original_filename": name,
#         "file_type": "merged",
#         "table_name": new_table,
#         "row_count": row_count,
#         "columns": col_meta,
#         "lineage": lineage,
#     }


# @router.get("/datasets/{dataset_id}/shares", response_model=list)
# async def list_shares(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     """List shares for a dataset. Only the owner can see their share list."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, shared_with, granted_by, created_at FROM dataset_shares WHERE dataset_id = $1",
#             dataset_id,
#         )
#     return [dict(r) for r in rows]


# @router.post("/datasets/{dataset_id}/shares", response_model=dict)
# async def create_share(
#     dataset_id: UUID,
#     shared_with: str = Body(..., embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Grant read access to another user. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner, original_filename FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403, detail="Only the dataset owner can share it"
#             )

#         existing = await conn.fetchval(
#             "SELECT id FROM dataset_shares WHERE dataset_id = $1 AND shared_with = $2",
#             dataset_id,
#             shared_with,
#         )
#         if existing:
#             raise HTTPException(
#                 status_code=409, detail="Already shared with this user"
#             )

#         row = await conn.fetchrow(
#             """
#             INSERT INTO dataset_shares (dataset_id, shared_with, granted_by)
#             VALUES ($1, $2, $3)
#             RETURNING id, dataset_id, shared_with, granted_by, created_at
#             """,
#             dataset_id,
#             shared_with,
#             owner,
#         )

#     filename = dataset_row["original_filename"] or str(dataset_id)
#     asyncio.create_task(_send_share_notification(shared_with, owner, filename))
#     return dict(row)


# @router.delete("/datasets/{dataset_id}/shares/{share_id}")
# async def delete_share(
#     dataset_id: UUID,
#     share_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Revoke a share. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403,
#                 detail="Only the dataset owner can revoke shares",
#             )
#         await conn.execute(
#             "DELETE FROM dataset_shares WHERE id = $1 AND dataset_id = $2",
#             share_id,
#             dataset_id,
#         )
#     return {"deleted": str(share_id)}


# """Dataset CRUD + merge + share endpoints."""
# import asyncio
# import json
# import os
# from email.message import EmailMessage
# from uuid import UUID

# import asyncpg
# import polars as pl
# from fastapi import APIRouter, Body, Depends, HTTPException

# from app.config import settings
# from app.db import get_db_pool
# from app.deps import _validate_table_name, get_user_conn, rls_conn
# from app.ingestion import _infer_type, ingest_dataframe

# logger = __import__("logging").getLogger(__name__)


# # ─── Share notification email ─────────────────────────────────────────────────

# def _share_email_html(shared_with: str, granted_by: str, filename: str, app_url: str) -> str:
#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     return f"""<!DOCTYPE html>
# <html><head><meta charset="UTF-8"></head>
# <body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;">
# <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:32px 16px;">
# <tr><td align="center">
# <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e3d8;">
#   <tr><td style="background:#9a3324;padding:24px 32px;border-radius:8px 8px 0 0;">
#     <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Varma &amp; Varma · DataSense</p>
#     <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">A dataset was shared with you</h1>
#   </td></tr>
#   <tr><td style="padding:32px;">
#     <p style="margin:0 0 16px;color:#3d3530;font-size:15px;">Hi {shared_with.split('@')[0].replace('.', ' ').title()},</p>
#     <p style="margin:0 0 24px;color:#5c534d;font-size:14px;line-height:1.6;">
#       <strong>{sharer_display}</strong> (<a href="mailto:{granted_by}" style="color:#9a3324;text-decoration:none;">{granted_by}</a>)
#       has shared a dataset with you on DataSense Pro.
#     </p>
#     <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e3d8;border-radius:6px;margin-bottom:24px;">
#       <tr><td style="padding:14px 18px;">
#         <p style="margin:0 0 4px;font-size:11px;color:#a89d96;letter-spacing:0.06em;text-transform:uppercase;">Dataset</p>
#         <p style="margin:0;font-size:14px;font-weight:600;color:#3d3530;font-family:monospace;">{filename}</p>
#       </td></tr>
#     </table>
#     <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
#       <tr><td style="background:#9a3324;border-radius:6px;">
#         <a href="{app_url}" style="display:inline-block;padding:11px 24px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Open DataSense</a>
#       </td></tr>
#     </table>
#     <p style="margin:0;color:#a89d96;font-size:12px;line-height:1.6;">
#       The dataset will appear in your DataSense library once you log in.
#       You can view and analyse it but cannot share it further or delete it.
#     </p>
#   </td></tr>
#   <tr><td style="padding:16px 32px;background:#faf8f5;border-top:1px solid #e8e3d8;border-radius:0 0 8px 8px;">
#     <p style="margin:0;color:#a89d96;font-size:11px;">Varma &amp; Varma Chartered Accountants · Automated notification from DataSense Pro.</p>
#   </td></tr>
# </table>
# </td></tr></table>
# </body></html>"""


# async def _send_share_notification(shared_with: str, granted_by: str, filename: str) -> None:
#     if not settings.SMTP_HOST or not shared_with:
#         return
#     import aiosmtplib

#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     msg = EmailMessage()
#     msg["Subject"] = f'{sharer_display} shared "{filename}" with you on DataSense'
#     msg["From"] = settings.SMTP_FROM
#     msg["To"] = shared_with
#     msg.set_content(
#         f"Hi,\n\n{sharer_display} ({granted_by}) has shared the dataset \"{filename}\" with you on DataSense Pro.\n\n"
#         f"Open DataSense: {settings.APP_URL}\n\n"
#         "The dataset will appear in your DataSense library once you log in."
#     )
#     msg.add_alternative(
#         _share_email_html(shared_with, granted_by, filename, settings.APP_URL),
#         subtype="html",
#     )
#     try:
#         await aiosmtplib.send(
#             msg,
#             hostname=settings.SMTP_HOST,
#             port=settings.SMTP_PORT,
#             username=settings.SMTP_USER,
#             password=settings.SMTP_PASS,
#             start_tls=settings.SMTP_USE_TLS,
#             use_tls=settings.SMTP_USE_SSL,
#         )
#         logger.info("Share notification sent to %s for dataset %s", shared_with, filename)
#     except Exception as exc:
#         logger.warning("Failed to send share notification to %s: %s", shared_with, exc)

# router = APIRouter()


# @router.get("/datasets", response_model=list)
# async def list_datasets(rls: tuple = Depends(get_user_conn)):
#     """List datasets visible to the current user (RLS enforced)."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, original_filename, file_type, table_name, row_count, columns, ingest_warnings, created_at, owner, dataset_type, audit_area_code, pii_detected, lineage FROM datasets ORDER BY created_at DESC"
#         )
#     return [dict(r) for r in rows]


# @router.get("/datasets/{dataset_id}", response_model=dict)
# async def get_dataset(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT * FROM datasets WHERE id = $1", dataset_id
#         )
#     if not row:
#         raise HTTPException(status_code=404, detail="Dataset not found")
#     return dict(row)


# @router.delete("/datasets/{dataset_id}")
# async def delete_dataset(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
#     pool: asyncpg.Pool = Depends(get_db_pool),
# ):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT file_path, table_name FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         await conn.execute(
#             "UPDATE jobs SET dataset_id = NULL WHERE dataset_id = $1",
#             dataset_id,
#         )
#         await conn.execute("DELETE FROM datasets WHERE id = $1", dataset_id)

#     # DROP TABLE requires the superuser pool — analytics_app doesn't own dataset tables
#     if row["table_name"]:
#         async with pool.acquire() as conn:
#             await conn.execute(
#                 f"DROP TABLE IF EXISTS {_validate_table_name(row['table_name'])}"
#             )

#     if row["file_path"] and os.path.exists(row["file_path"]):
#         os.remove(row["file_path"])

#     return {"deleted": str(dataset_id)}


# @router.post("/datasets/{dataset_id}/redetect", response_model=dict)
# async def redetect_types(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Re-run type inference against the current data in the dataset's
#     Postgres table and update the saved `columns` JSONB metadata.

#     Useful when:
#     - The dataset was uploaded before the inference logic was last improved.
#     - A user has run a cleaning job that changed types and the saved
#       metadata has drifted from the actual table schema.

#     Reads up to 5,000 rows for the inference sample (more than enough for
#     pattern detection; keeps latency low even on huge tables).
#     """
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         ds = await conn.fetchrow(
#             "SELECT id, table_name, columns FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not ds:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if not ds["table_name"]:
#             raise HTTPException(
#                 status_code=400, detail="Dataset has no underlying table"
#             )

#         _validate_table_name(ds["table_name"])
#         rows = await conn.fetch(
#             f"SELECT * FROM {ds['table_name']} LIMIT 5000"
#         )
#         if not rows:
#             return {"id": str(dataset_id), "columns": ds["columns"], "changed": []}

#         # Build a Polars DataFrame directly from asyncpg's native Python types.
#         # Avoid the CSV-roundtrip approach: str(datetime.date) → "2024-01-01"
#         # is fine, but str(datetime.datetime) → "2024-01-01 00:00:00" makes the
#         # sniffer classify DATE columns as DATETIME after a cleaning run.
#         # Building column-by-column lets Polars retain the real dtype.
#         import datetime as _dt
#         import io
#         col_names = list(rows[0].keys())
#         col_data: dict[str, list] = {c: [] for c in col_names}
#         for r in rows:
#             for c in col_names:
#                 col_data[c].append(r[c])

#         series_list: list[pl.Series] = []
#         for c in col_names:
#             vals = col_data[c]
#             # Peek at first non-None value to choose the right Polars dtype.
#             sample = next((v for v in vals if v is not None), None)
#             try:
#                 if isinstance(sample, bool):
#                     s = pl.Series(c, vals, dtype=pl.Boolean)
#                 elif isinstance(sample, int):
#                     s = pl.Series(c, vals, dtype=pl.Int64)
#                 elif isinstance(sample, float):
#                     s = pl.Series(c, vals, dtype=pl.Float64)
#                 elif isinstance(sample, _dt.datetime):
#                     s = pl.Series(c, vals, dtype=pl.Datetime)
#                 elif isinstance(sample, _dt.date):
#                     s = pl.Series(c, vals, dtype=pl.Date)
#                 else:
#                     # Text / None-only columns — let Polars infer from strings.
#                     str_vals = [str(v) if v is not None else None for v in vals]
#                     s = pl.Series(c, str_vals, dtype=pl.String)
#             except Exception:
#                 # Last resort: stringify everything.
#                 str_vals = [str(v) if v is not None else None for v in vals]
#                 s = pl.Series(c, str_vals, dtype=pl.String)
#             series_list.append(s)

#         df = pl.DataFrame(series_list)

#         # Preserve any non-inference fields (original_name, native_dtype, etc.)
#         # that were saved on prior ingest by merging onto the existing entries.
#         existing = {m["name"]: m for m in (ds["columns"] or []) if m.get("name")}
#         new_meta: list[dict] = []
#         changed: list[dict] = []
#         for col in df.columns:
#             new_type = _infer_type(df[col])
#             prior = existing.get(col, {"name": col, "original_name": col})
#             old_type = prior.get("inferred_type")
#             merged = {
#                 **prior,
#                 "name": col,
#                 "inferred_type": new_type,
#             }
#             new_meta.append(merged)
#             if old_type != new_type:
#                 changed.append({"column": col, "from": old_type, "to": new_type})

#         await conn.execute(
#             "UPDATE datasets SET columns = $1 WHERE id = $2",
#             json.dumps(new_meta),
#             dataset_id,
#         )

#     return {"id": str(dataset_id), "columns": new_meta, "changed": changed}


# @router.patch("/datasets/{dataset_id}", response_model=dict)
# async def update_dataset(
#     dataset_id: UUID,
#     dataset_type: str | None = Body(default=None, embed=True),
#     audit_area_code: str | None = Body(default=None, embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Owner-editable dataset metadata: dataset_type (auto-detect override)
#     and audit_area_code (firm A–Z tag, see core.audit_areas)."""
#     if dataset_type is None and audit_area_code is None:
#         raise HTTPException(
#             status_code=400,
#             detail="Provide at least one of: dataset_type, audit_area_code",
#         )

#     if dataset_type is not None:
#         valid_types = {
#             "journal_entries", "financial_statements", "debtors_creditors",
#             "register_analytics", "general",
#         }
#         if dataset_type not in valid_types:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Invalid dataset_type. Must be one of: {valid_types}",
#             )

#     # audit_area_code: empty string means "clear the tag"; treat as NULL.
#     # Otherwise it's a `vertical:code` id (e.g. 'general:F-PPE'); the FK to
#     # core.audit_areas(id) gives the final word on validity.
#     audit_area_clear = audit_area_code == ""
#     if audit_area_code and not audit_area_clear:
#         if ":" not in audit_area_code or len(audit_area_code) > 100:
#             raise HTTPException(
#                 status_code=400,
#                 detail="audit_area_code must look like 'vertical:code' (e.g. 'general:F-PPE')",
#             )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         sets: list[str] = []
#         args: list = []
#         if dataset_type is not None:
#             args.append(dataset_type)
#             sets.append(f"dataset_type = ${len(args)}")
#         if audit_area_code is not None:
#             args.append(None if audit_area_clear else audit_area_code)
#             sets.append(f"audit_area_code = ${len(args)}")
#         args.append(dataset_id)
#         try:
#             row = await conn.fetchrow(
#                 f"UPDATE datasets SET {', '.join(sets)} WHERE id = ${len(args)} "
#                 "RETURNING id, dataset_type, audit_area_code",
#                 *args,
#             )
#         except asyncpg.ForeignKeyViolationError:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Unknown audit_area_code (not in core.audit_areas)",
#             )
#     if not row:
#         raise HTTPException(
#             status_code=404, detail="Dataset not found or not owned by you"
#         )
#     return dict(row)


# @router.post("/datasets/merge", response_model=dict)
# async def merge_datasets(
#     dataset_ids: list[str] = Body(..., embed=True),
#     name: str = Body(..., embed=True),
#     strategy: str = Body(default="union_all", embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Stack rows from multiple datasets into a new dataset.

#     **strategy** controls how tables are combined:
#     - `union_all` (default) — server-side `UNION ALL` in Postgres; handles
#       arbitrary row counts without Python memory pressure.
#     - `diagonal` — legacy Polars diagonal_relaxed concat; used only when
#       column-name alignment is impossible server-side.
#     """
#     if len(dataset_ids) < 2:
#         raise HTTPException(
#             status_code=400, detail="Select at least 2 datasets to merge"
#         )
#     if strategy not in {"union_all", "diagonal"}:
#         raise HTTPException(
#             status_code=400, detail="strategy must be 'union_all' or 'diagonal'"
#         )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, table_name, original_filename, row_count FROM datasets WHERE id = ANY($1::uuid[]) AND table_name IS NOT NULL",
#             [UUID(i) for i in dataset_ids],
#         )
#         if len(rows) < 2:
#             raise HTTPException(
#                 status_code=404,
#                 detail="Could not find 2 or more accessible datasets",
#             )

#         table_names = [r["table_name"] for r in rows]
#         validated = [_validate_table_name(t) for t in table_names]

#         if strategy == "union_all":
#             # 1. Discover the union of all columns across all tables
#             all_cols: set[str] = set()
#             per_table_cols: list[list[str]] = []
#             for t in validated:
#                 cols = await conn.fetch(
#                     f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'datasets' AND table_name = $1",
#                     t.split(".")[-1],
#                 )
#                 cnames = [c["column_name"] for c in cols]
#                 per_table_cols.append(cnames)
#                 all_cols.update(cnames)

#             ordered_cols = sorted(all_cols)

#             # 2. Build SELECT expressions with NULL padding for missing columns
#             selects: list[str] = []
#             for idx, cnames in enumerate(per_table_cols):
#                 col_set = set(cnames)
#                 exprs = []
#                 for c in ordered_cols:
#                     if c in col_set:
#                         exprs.append(f'"{c}"')
#                     else:
#                         exprs.append("NULL AS \"" + c + "\"")
#                 table = validated[idx]
#                 selects.append(f"SELECT {', '.join(exprs)} FROM {table}")

#             union_sql = " UNION ALL ".join(selects)

#             # 3. Create new table
#             import uuid as uuid_mod
#             new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
#             await conn.execute(f"CREATE TABLE {new_table} AS {union_sql}")

#             # 4. Count rows
#             row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

#             # 5. Build column metadata
#             col_meta = [
#                 {"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False}
#                 for c in ordered_cols
#             ]

#             # 6. Redetect types from the merged table (sample)
#             sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
#             if sample_rows:
#                 import io
#                 csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
#                 for r in sample_rows:
#                     vals = []
#                     for c in ordered_cols:
#                         v = r[c]
#                         if v is None:
#                             vals.append("")
#                         else:
#                             s = str(v).replace('"', '""')
#                             vals.append(f'"{s}"')
#                     csv_lines.append(",".join(vals))
#                 df = pl.read_csv(
#                     io.StringIO("\n".join(csv_lines)),
#                     infer_schema_length=10_000,
#                     ignore_errors=True,
#                 )
#                 col_meta = []
#                 for c in ordered_cols:
#                     col_meta.append({
#                         "name": c,
#                         "original_name": c,
#                         "inferred_type": _infer_type(df[c]),
#                         "native_dtype": False,
#                     })

#         else:
#             # Legacy diagonal merge via Polars (fallback)
#             dfs: list[pl.DataFrame] = []
#             for t in validated:
#                 db_rows = await conn.fetch(f"SELECT * FROM {t}")
#                 if db_rows:
#                     dfs.append(pl.from_dicts([dict(r) for r in db_rows]))

#             if not dfs:
#                 raise HTTPException(
#                     status_code=400, detail="Selected datasets contain no data"
#                 )

#             merged_df = pl.concat(dfs, how="diagonal_relaxed")
#             meta = await ingest_dataframe(conn, merged_df)
#             if not meta["table_name"]:
#                 raise HTTPException(
#                     status_code=400, detail="Merge produced no data"
#                 )
#             new_table = meta["table_name"]
#             row_count = meta["row_count"]
#             col_meta = meta["columns"]

#         # Build lineage
#         lineage = {
#             "source_type": "merge",
#             "strategy": strategy,
#             "parents": [str(r["id"]) for r in rows],
#             "parent_names": [r["original_filename"] for r in rows],
#             "parent_row_counts": [r["row_count"] for r in rows],
#             "performed_by": owner,
#             "performed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
#         }

#         dataset_id = await conn.fetchval(
#             """
#             INSERT INTO datasets
#                 (client_id, engagement_id, original_filename, file_type,
#                  table_name, file_path, row_count, columns, ingest_warnings, owner, lineage)
#             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
#             RETURNING id
#             """,
#             None,  # client_id — will be set by EngagementPicker once SPA wires it
#             None,  # engagement_id
#             name,
#             "merged",
#             new_table,
#             None,
#             row_count,
#             json.dumps(col_meta),
#             json.dumps([]),
#             owner,
#             json.dumps(lineage),
#         )

#     return {
#         "id": str(dataset_id),
#         "original_filename": name,
#         "file_type": "merged",
#         "table_name": new_table,
#         "row_count": row_count,
#         "columns": col_meta,
#         "lineage": lineage,
#     }


# @router.get("/datasets/{dataset_id}/shares", response_model=list)
# async def list_shares(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     """List shares for a dataset. Only the owner can see their share list."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, shared_with, granted_by, created_at FROM dataset_shares WHERE dataset_id = $1",
#             dataset_id,
#         )
#     return [dict(r) for r in rows]


# @router.post("/datasets/{dataset_id}/shares", response_model=dict)
# async def create_share(
#     dataset_id: UUID,
#     shared_with: str = Body(..., embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Grant read access to another user. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner, original_filename FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403, detail="Only the dataset owner can share it"
#             )

#         existing = await conn.fetchval(
#             "SELECT id FROM dataset_shares WHERE dataset_id = $1 AND shared_with = $2",
#             dataset_id,
#             shared_with,
#         )
#         if existing:
#             raise HTTPException(
#                 status_code=409, detail="Already shared with this user"
#             )

#         row = await conn.fetchrow(
#             """
#             INSERT INTO dataset_shares (dataset_id, shared_with, granted_by)
#             VALUES ($1, $2, $3)
#             RETURNING id, dataset_id, shared_with, granted_by, created_at
#             """,
#             dataset_id,
#             shared_with,
#             owner,
#         )

#     filename = dataset_row["original_filename"] or str(dataset_id)
#     asyncio.create_task(_send_share_notification(shared_with, owner, filename))
#     return dict(row)


# @router.delete("/datasets/{dataset_id}/shares/{share_id}")
# async def delete_share(
#     dataset_id: UUID,
#     share_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Revoke a share. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403,
#                 detail="Only the dataset owner can revoke shares",
#             )
#         await conn.execute(
#             "DELETE FROM dataset_shares WHERE id = $1 AND dataset_id = $2",
#             share_id,
#             dataset_id,
#         )
#     return {"deleted": str(share_id)}



# """Dataset CRUD + merge + share endpoints."""
# import asyncio
# import json
# import os
# from email.message import EmailMessage
# from uuid import UUID

# import asyncpg
# import polars as pl
# from fastapi import APIRouter, Body, Depends, HTTPException

# from app.config import settings
# from app.db import get_db_pool
# from app.deps import _validate_table_name, get_user_conn, rls_conn
# from app.ingestion import _infer_type, ingest_dataframe

# logger = __import__("logging").getLogger(__name__)


# # ─── Share notification email ─────────────────────────────────────────────────

# def _share_email_html(shared_with: str, granted_by: str, filename: str, app_url: str) -> str:
#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     return f"""<!DOCTYPE html>
# <html><head><meta charset="UTF-8"></head>
# <body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;">
# <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:32px 16px;">
# <tr><td align="center">
# <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e3d8;">
#   <tr><td style="background:#9a3324;padding:24px 32px;border-radius:8px 8px 0 0;">
#     <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Varma &amp; Varma · DataSense</p>
#     <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">A dataset was shared with you</h1>
#   </td></tr>
#   <tr><td style="padding:32px;">
#     <p style="margin:0 0 16px;color:#3d3530;font-size:15px;">Hi {shared_with.split('@')[0].replace('.', ' ').title()},</p>
#     <p style="margin:0 0 24px;color:#5c534d;font-size:14px;line-height:1.6;">
#       <strong>{sharer_display}</strong> (<a href="mailto:{granted_by}" style="color:#9a3324;text-decoration:none;">{granted_by}</a>)
#       has shared a dataset with you on DataSense Pro.
#     </p>
#     <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e3d8;border-radius:6px;margin-bottom:24px;">
#       <tr><td style="padding:14px 18px;">
#         <p style="margin:0 0 4px;font-size:11px;color:#a89d96;letter-spacing:0.06em;text-transform:uppercase;">Dataset</p>
#         <p style="margin:0;font-size:14px;font-weight:600;color:#3d3530;font-family:monospace;">{filename}</p>
#       </td></tr>
#     </table>
#     <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
#       <tr><td style="background:#9a3324;border-radius:6px;">
#         <a href="{app_url}" style="display:inline-block;padding:11px 24px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Open DataSense</a>
#       </td></tr>
#     </table>
#     <p style="margin:0;color:#a89d96;font-size:12px;line-height:1.6;">
#       The dataset will appear in your DataSense library once you log in.
#       You can view and analyse it but cannot share it further or delete it.
#     </p>
#   </td></tr>
#   <tr><td style="padding:16px 32px;background:#faf8f5;border-top:1px solid #e8e3d8;border-radius:0 0 8px 8px;">
#     <p style="margin:0;color:#a89d96;font-size:11px;">Varma &amp; Varma Chartered Accountants · Automated notification from DataSense Pro.</p>
#   </td></tr>
# </table>
# </td></tr></table>
# </body></html>"""


# async def _send_share_notification(shared_with: str, granted_by: str, filename: str) -> None:
#     if not settings.SMTP_HOST or not shared_with:
#         return
#     import aiosmtplib

#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     msg = EmailMessage()
#     msg["Subject"] = f'{sharer_display} shared "{filename}" with you on DataSense'
#     msg["From"] = settings.SMTP_FROM
#     msg["To"] = shared_with
#     msg.set_content(
#         f"Hi,\n\n{sharer_display} ({granted_by}) has shared the dataset \"{filename}\" with you on DataSense Pro.\n\n"
#         f"Open DataSense: {settings.APP_URL}\n\n"
#         "The dataset will appear in your DataSense library once you log in."
#     )
#     msg.add_alternative(
#         _share_email_html(shared_with, granted_by, filename, settings.APP_URL),
#         subtype="html",
#     )
#     try:
#         await aiosmtplib.send(
#             msg,
#             hostname=settings.SMTP_HOST,
#             port=settings.SMTP_PORT,
#             username=settings.SMTP_USER,
#             password=settings.SMTP_PASS,
#             start_tls=settings.SMTP_USE_TLS,
#             use_tls=settings.SMTP_USE_SSL,
#         )
#         logger.info("Share notification sent to %s for dataset %s", shared_with, filename)
#     except Exception as exc:
#         logger.warning("Failed to send share notification to %s: %s", shared_with, exc)

# router = APIRouter()


# @router.get("/datasets", response_model=list)
# async def list_datasets(rls: tuple = Depends(get_user_conn)):
#     """List datasets visible to the current user (RLS enforced)."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, original_filename, file_type, table_name, row_count, columns, ingest_warnings, created_at, owner, dataset_type, audit_area_code, pii_detected, lineage FROM datasets ORDER BY created_at DESC"
#         )
#     return [dict(r) for r in rows]


# @router.get("/datasets/{dataset_id}", response_model=dict)
# async def get_dataset(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT * FROM datasets WHERE id = $1", dataset_id
#         )
#     if not row:
#         raise HTTPException(status_code=404, detail="Dataset not found")
#     return dict(row)


# @router.delete("/datasets/{dataset_id}")
# async def delete_dataset(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
#     pool: asyncpg.Pool = Depends(get_db_pool),
# ):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT file_path, table_name FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         await conn.execute(
#             "UPDATE jobs SET dataset_id = NULL WHERE dataset_id = $1",
#             dataset_id,
#         )
#         await conn.execute("DELETE FROM datasets WHERE id = $1", dataset_id)

#     # DROP TABLE requires the superuser pool — analytics_app doesn't own dataset tables
#     if row["table_name"]:
#         async with pool.acquire() as conn:
#             await conn.execute(
#                 f"DROP TABLE IF EXISTS {_validate_table_name(row['table_name'])}"
#             )

#     if row["file_path"] and os.path.exists(row["file_path"]):
#         os.remove(row["file_path"])

#     return {"deleted": str(dataset_id)}


# @router.post("/datasets/{dataset_id}/redetect", response_model=dict)
# async def redetect_types(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Re-run type inference against the current data in the dataset's
#     Postgres table and update the saved `columns` JSONB metadata.

#     Useful when:
#     - The dataset was uploaded before the inference logic was last improved.
#     - A user has run a cleaning job that changed types and the saved
#       metadata has drifted from the actual table schema.

#     Reads up to 5,000 rows for the inference sample (more than enough for
#     pattern detection; keeps latency low even on huge tables).
#     """
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         ds = await conn.fetchrow(
#             "SELECT id, table_name, columns FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not ds:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if not ds["table_name"]:
#             raise HTTPException(
#                 status_code=400, detail="Dataset has no underlying table"
#             )

#         _validate_table_name(ds["table_name"])
#         rows = await conn.fetch(
#             f"SELECT * FROM {ds['table_name']} LIMIT 5000"
#         )
#         if not rows:
#             return {"id": str(dataset_id), "columns": ds["columns"], "changed": []}

#         # Build a Polars DataFrame directly from asyncpg's native Python types.
#         # Avoid the CSV-roundtrip approach: str(datetime.date) → "2024-01-01"
#         # is fine, but str(datetime.datetime) → "2024-01-01 00:00:00" makes the
#         # sniffer classify DATE columns as DATETIME after a cleaning run.
#         # Building column-by-column lets Polars retain the real dtype.
#         import datetime as _dt
#         import io
#         col_names = list(rows[0].keys())
#         col_data: dict[str, list] = {c: [] for c in col_names}
#         for r in rows:
#             for c in col_names:
#                 col_data[c].append(r[c])

#         series_list: list[pl.Series] = []
#         for c in col_names:
#             vals = col_data[c]
#             # Peek at first non-None value to choose the right Polars dtype.
#             sample = next((v for v in vals if v is not None), None)
#             try:
#                 if isinstance(sample, bool):
#                     s = pl.Series(c, vals, dtype=pl.Boolean)
#                 elif isinstance(sample, int):
#                     s = pl.Series(c, vals, dtype=pl.Int64)
#                 elif isinstance(sample, float):
#                     s = pl.Series(c, vals, dtype=pl.Float64)
#                 elif isinstance(sample, _dt.datetime):
#                     s = pl.Series(c, vals, dtype=pl.Datetime)
#                 elif isinstance(sample, _dt.date):
#                     s = pl.Series(c, vals, dtype=pl.Date)
#                 else:
#                     # Text / None-only columns — let Polars infer from strings.
#                     str_vals = [str(v) if v is not None else None for v in vals]
#                     s = pl.Series(c, str_vals, dtype=pl.String)
#             except Exception:
#                 # Last resort: stringify everything.
#                 str_vals = [str(v) if v is not None else None for v in vals]
#                 s = pl.Series(c, str_vals, dtype=pl.String)
#             series_list.append(s)

#         df = pl.DataFrame(series_list)

#         # Preserve any non-inference fields (original_name, native_dtype, etc.)
#         # that were saved on prior ingest by merging onto the existing entries.
#         existing = {m["name"]: m for m in (ds["columns"] or []) if m.get("name")}
#         new_meta: list[dict] = []
#         changed: list[dict] = []
#         for col in df.columns:
#             new_type = _infer_type(df[col])
#             prior = existing.get(col, {"name": col, "original_name": col})
#             old_type = prior.get("inferred_type")
#             merged = {
#                 **prior,
#                 "name": col,
#                 "inferred_type": new_type,
#             }
#             new_meta.append(merged)
#             if old_type != new_type:
#                 changed.append({"column": col, "from": old_type, "to": new_type})

#         await conn.execute(
#             "UPDATE datasets SET columns = $1 WHERE id = $2",
#             json.dumps(new_meta),
#             dataset_id,
#         )

#     return {"id": str(dataset_id), "columns": new_meta, "changed": changed}


# @router.patch("/datasets/{dataset_id}", response_model=dict)
# async def update_dataset(
#     dataset_id: UUID,
#     dataset_type: str | None = Body(default=None, embed=True),
#     audit_area_code: str | None = Body(default=None, embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Owner-editable dataset metadata: dataset_type (auto-detect override)
#     and audit_area_code (firm A–Z tag, see core.audit_areas)."""
#     if dataset_type is None and audit_area_code is None:
#         raise HTTPException(
#             status_code=400,
#             detail="Provide at least one of: dataset_type, audit_area_code",
#         )

#     if dataset_type is not None:
#         valid_types = {
#             "journal_entries", "financial_statements", "debtors_creditors",
#             "register_analytics", "general",
#         }
#         if dataset_type not in valid_types:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Invalid dataset_type. Must be one of: {valid_types}",
#             )

#     # audit_area_code: empty string means "clear the tag"; treat as NULL.
#     # Otherwise it's a `vertical:code` id (e.g. 'general:F-PPE'); the FK to
#     # core.audit_areas(id) gives the final word on validity.
#     audit_area_clear = audit_area_code == ""
#     if audit_area_code and not audit_area_clear:
#         if ":" not in audit_area_code or len(audit_area_code) > 100:
#             raise HTTPException(
#                 status_code=400,
#                 detail="audit_area_code must look like 'vertical:code' (e.g. 'general:F-PPE')",
#             )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         sets: list[str] = []
#         args: list = []
#         if dataset_type is not None:
#             args.append(dataset_type)
#             sets.append(f"dataset_type = ${len(args)}")
#         if audit_area_code is not None:
#             args.append(None if audit_area_clear else audit_area_code)
#             sets.append(f"audit_area_code = ${len(args)}")
#         args.append(dataset_id)
#         try:
#             row = await conn.fetchrow(
#                 f"UPDATE datasets SET {', '.join(sets)} WHERE id = ${len(args)} "
#                 "RETURNING id, dataset_type, audit_area_code",
#                 *args,
#             )
#         except asyncpg.ForeignKeyViolationError:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Unknown audit_area_code (not in core.audit_areas)",
#             )
#     if not row:
#         raise HTTPException(
#             status_code=404, detail="Dataset not found or not owned by you"
#         )
#     return dict(row)


# @router.post("/datasets/merge", response_model=dict)
# async def merge_datasets(
#     dataset_ids: list[str] = Body(..., embed=True),
#     name: str = Body(..., embed=True),
#     strategy: str = Body(default="union_all", embed=True),
#     join_key: str | None = Body(default=None, embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Stack or join rows from multiple datasets into a new dataset.

#     **strategy** controls how tables are combined:
#     - `union_all` (default) — server-side UNION ALL; preserves left table column order.
#     - `join` — LEFT JOIN on a shared unique key column (join_key required).
#     - `diagonal` — legacy Polars diagonal_relaxed concat fallback.
#     """
#     if len(dataset_ids) < 2:
#         raise HTTPException(
#             status_code=400, detail="Select at least 2 datasets to merge"
#         )
#     if strategy not in {"union_all", "join", "diagonal"}:
#         raise HTTPException(
#             status_code=400, detail="strategy must be 'union_all', 'join', or 'diagonal'"
#         )
#     if strategy == "join" and not join_key:
#         raise HTTPException(
#             status_code=400, detail="join_key is required when strategy is 'join'"
#         )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, table_name, original_filename, row_count FROM datasets WHERE id = ANY($1::uuid[]) AND table_name IS NOT NULL",
#             [UUID(i) for i in dataset_ids],
#         )
#         if len(rows) < 2:
#             raise HTTPException(
#                 status_code=404,
#                 detail="Could not find 2 or more accessible datasets",
#             )

#         table_names = [r["table_name"] for r in rows]
#         validated = [_validate_table_name(t) for t in table_names]

#         if strategy == "union_all":
#             # 1. Discover the union of all columns across all tables
#             all_cols: set[str] = set()
#             per_table_cols: list[list[str]] = []
#             for t in validated:
#                 cols = await conn.fetch(
#                     f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'datasets' AND table_name = $1",
#                     t.split(".")[-1],
#                 )
#                 cnames = [c["column_name"] for c in cols]
#                 per_table_cols.append(cnames)
#                 all_cols.update(cnames)

#             # Preserve left (primary) table column order, append extra cols from other tables
#             left_cols = per_table_cols[0]
#             extra_cols = [c for c in all_cols if c not in set(left_cols)]
#             ordered_cols = left_cols + sorted(extra_cols)

#             # 2. Build SELECT expressions with NULL padding for missing columns
#             selects: list[str] = []
#             for idx, cnames in enumerate(per_table_cols):
#                 col_set = set(cnames)
#                 exprs = []
#                 for c in ordered_cols:
#                     if c in col_set:
#                         exprs.append(f'CAST("{c}" AS TEXT) AS "{c}"')
#                     else:
#                         exprs.append(f'NULL AS "{c}"')
#                 table = validated[idx]
#                 selects.append(f"SELECT {', '.join(exprs)} FROM {table}")

#             union_sql = " UNION ALL ".join(selects)

#             # 3. Create new table
#             import uuid as uuid_mod
#             new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
#             await conn.execute(f"CREATE TABLE {new_table} AS {union_sql}")

#             # 4. Count rows
#             row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

#             # 5. Build column metadata
#             col_meta = [
#                 {"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False}
#                 for c in ordered_cols
#             ]

#             # 6. Redetect types from the merged table (sample)
#             sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
#             if sample_rows:
#                 import io
#                 csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
#                 for r in sample_rows:
#                     vals = []
#                     for c in ordered_cols:
#                         v = r[c]
#                         if v is None:
#                             vals.append("")
#                         else:
#                             s = str(v).replace('"', '""')
#                             vals.append(f'"{s}"')
#                     csv_lines.append(",".join(vals))
#                 df = pl.read_csv(
#                     io.StringIO("\n".join(csv_lines)),
#                     infer_schema_length=10_000,
#                     ignore_errors=True,
#                 )
#                 col_meta = []
#                 for c in ordered_cols:
#                     col_meta.append({
#                         "name": c,
#                         "original_name": c,
#                         "inferred_type": _infer_type(df[c]),
#                         "native_dtype": False,
#                     })

#         elif strategy == "join":
#             # LEFT JOIN on a shared unique key — left table is primary
#             import uuid as uuid_mod
#             left_table  = validated[0]
#             right_table = validated[1]

#             # Get left table columns (preserves original order)
#             left_cols_rows = await conn.fetch(
#                 "SELECT column_name FROM information_schema.columns "
#                 "WHERE table_schema = 'datasets' AND table_name = $1 ORDER BY ordinal_position",
#                 left_table.split(".")[-1],
#             )
#             left_cols = [c["column_name"] for c in left_cols_rows]

#             # Get right table columns
#             right_cols_rows = await conn.fetch(
#                 "SELECT column_name FROM information_schema.columns "
#                 "WHERE table_schema = 'datasets' AND table_name = $1 ORDER BY ordinal_position",
#                 right_table.split(".")[-1],
#             )
#             right_cols = [c["column_name"] for c in right_cols_rows]

#             # Build SELECT: all left cols first, then right cols (excluding join key to avoid duplicate)
#             left_exprs  = [f'l."{c}"' for c in left_cols]
#             right_exprs = [f'r."{c}" AS "{c}"' for c in right_cols if c != join_key]

#             all_exprs = left_exprs + right_exprs
#             ordered_cols = left_cols + [c for c in right_cols if c != join_key]

#             join_sql = (
#                 f"SELECT {', '.join(all_exprs)} "
#                 f"FROM {left_table} l "
#                 f"LEFT JOIN {right_table} r ON CAST(l.\"{join_key}\" AS TEXT) = CAST(r.\"{join_key}\" AS TEXT)"
#             )

#             new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
#             await conn.execute(f"CREATE TABLE {new_table} AS {join_sql}")
#             row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

#             # Build col metadata
#             sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
#             col_meta = []
#             if sample_rows:
#                 import io
#                 csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
#                 for r in sample_rows:
#                     vals = []
#                     for c in ordered_cols:
#                         v = r[c] if c in dict(r) else None
#                         if v is None:
#                             vals.append("")
#                         else:
#                             s = str(v).replace('"', '""')
#                             vals.append(f'"{s}"')
#                     csv_lines.append(",".join(vals))
#                 df = pl.read_csv(
#                     io.StringIO("\n".join(csv_lines)),
#                     infer_schema_length=10_000,
#                     ignore_errors=True,
#                 )
#                 for c in ordered_cols:
#                     col_meta.append({
#                         "name": c,
#                         "original_name": c,
#                         "inferred_type": _infer_type(df[c]) if c in df.columns else "text",
#                         "native_dtype": False,
#                     })
#             else:
#                 col_meta = [{"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False} for c in ordered_cols]

#         else:
#             # Legacy diagonal merge via Polars (fallback)
#             dfs: list[pl.DataFrame] = []
#             for t in validated:
#                 db_rows = await conn.fetch(f"SELECT * FROM {t}")
#                 if db_rows:
#                     dfs.append(pl.from_dicts([dict(r) for r in db_rows]))

#             if not dfs:
#                 raise HTTPException(
#                     status_code=400, detail="Selected datasets contain no data"
#                 )

#             merged_df = pl.concat(dfs, how="diagonal_relaxed")
#             meta = await ingest_dataframe(conn, merged_df)
#             if not meta["table_name"]:
#                 raise HTTPException(
#                     status_code=400, detail="Merge produced no data"
#                 )
#             new_table = meta["table_name"]
#             row_count = meta["row_count"]
#             col_meta = meta["columns"]

#         # Build lineage
#         lineage = {
#             "source_type": "merge",
#             "strategy": strategy,
#             "join_key": join_key,
#             "parents": [str(r["id"]) for r in rows],
#             "parent_names": [r["original_filename"] for r in rows],
#             "parent_row_counts": [r["row_count"] for r in rows],
#             "performed_by": owner,
#             "performed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
#         }

#         dataset_id = await conn.fetchval(
#             """
#             INSERT INTO datasets
#                 (client_id, engagement_id, original_filename, file_type,
#                  table_name, file_path, row_count, columns, ingest_warnings, owner, lineage)
#             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
#             RETURNING id
#             """,
#             None,  # client_id — will be set by EngagementPicker once SPA wires it
#             None,  # engagement_id
#             name,
#             "merged",
#             new_table,
#             None,
#             row_count,
#             json.dumps(col_meta),
#             json.dumps([]),
#             owner,
#             json.dumps(lineage),
#         )

#     return {
#         "id": str(dataset_id),
#         "original_filename": name,
#         "file_type": "merged",
#         "table_name": new_table,
#         "row_count": row_count,
#         "columns": col_meta,
#         "lineage": lineage,
#     }


# @router.get("/datasets/{dataset_id}/shares", response_model=list)
# async def list_shares(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     """List shares for a dataset. Only the owner can see their share list."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, shared_with, granted_by, created_at FROM dataset_shares WHERE dataset_id = $1",
#             dataset_id,
#         )
#     return [dict(r) for r in rows]


# @router.post("/datasets/{dataset_id}/shares", response_model=dict)
# async def create_share(
#     dataset_id: UUID,
#     shared_with: str = Body(..., embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Grant read access to another user. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner, original_filename FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403, detail="Only the dataset owner can share it"
#             )

#         existing = await conn.fetchval(
#             "SELECT id FROM dataset_shares WHERE dataset_id = $1 AND shared_with = $2",
#             dataset_id,
#             shared_with,
#         )
#         if existing:
#             raise HTTPException(
#                 status_code=409, detail="Already shared with this user"
#             )

#         row = await conn.fetchrow(
#             """
#             INSERT INTO dataset_shares (dataset_id, shared_with, granted_by)
#             VALUES ($1, $2, $3)
#             RETURNING id, dataset_id, shared_with, granted_by, created_at
#             """,
#             dataset_id,
#             shared_with,
#             owner,
#         )

#     filename = dataset_row["original_filename"] or str(dataset_id)
#     asyncio.create_task(_send_share_notification(shared_with, owner, filename))
#     return dict(row)


# @router.delete("/datasets/{dataset_id}/shares/{share_id}")
# async def delete_share(
#     dataset_id: UUID,
#     share_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Revoke a share. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403,
#                 detail="Only the dataset owner can revoke shares",
#             )
#         await conn.execute(
#             "DELETE FROM dataset_shares WHERE id = $1 AND dataset_id = $2",
#             share_id,
#             dataset_id,
#         )
#     return {"deleted": str(share_id)}


# """Dataset CRUD + merge + share endpoints."""
# import asyncio
# import json
# import os
# from email.message import EmailMessage
# from uuid import UUID

# import asyncpg
# import polars as pl
# from fastapi import APIRouter, Body, Depends, HTTPException

# from app.config import settings
# from app.db import get_db_pool
# from app.deps import _validate_table_name, get_user_conn, rls_conn
# from app.ingestion import _infer_type, ingest_dataframe

# logger = __import__("logging").getLogger(__name__)


# # ─── Share notification email ─────────────────────────────────────────────────

# def _share_email_html(shared_with: str, granted_by: str, filename: str, app_url: str) -> str:
#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     return f"""<!DOCTYPE html>
# <html><head><meta charset="UTF-8"></head>
# <body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;">
# <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:32px 16px;">
# <tr><td align="center">
# <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e3d8;">
#   <tr><td style="background:#9a3324;padding:24px 32px;border-radius:8px 8px 0 0;">
#     <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Varma &amp; Varma · DataSense</p>
#     <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">A dataset was shared with you</h1>
#   </td></tr>
#   <tr><td style="padding:32px;">
#     <p style="margin:0 0 16px;color:#3d3530;font-size:15px;">Hi {shared_with.split('@')[0].replace('.', ' ').title()},</p>
#     <p style="margin:0 0 24px;color:#5c534d;font-size:14px;line-height:1.6;">
#       <strong>{sharer_display}</strong> (<a href="mailto:{granted_by}" style="color:#9a3324;text-decoration:none;">{granted_by}</a>)
#       has shared a dataset with you on DataSense Pro.
#     </p>
#     <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e3d8;border-radius:6px;margin-bottom:24px;">
#       <tr><td style="padding:14px 18px;">
#         <p style="margin:0 0 4px;font-size:11px;color:#a89d96;letter-spacing:0.06em;text-transform:uppercase;">Dataset</p>
#         <p style="margin:0;font-size:14px;font-weight:600;color:#3d3530;font-family:monospace;">{filename}</p>
#       </td></tr>
#     </table>
#     <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
#       <tr><td style="background:#9a3324;border-radius:6px;">
#         <a href="{app_url}" style="display:inline-block;padding:11px 24px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Open DataSense</a>
#       </td></tr>
#     </table>
#     <p style="margin:0;color:#a89d96;font-size:12px;line-height:1.6;">
#       The dataset will appear in your DataSense library once you log in.
#       You can view and analyse it but cannot share it further or delete it.
#     </p>
#   </td></tr>
#   <tr><td style="padding:16px 32px;background:#faf8f5;border-top:1px solid #e8e3d8;border-radius:0 0 8px 8px;">
#     <p style="margin:0;color:#a89d96;font-size:11px;">Varma &amp; Varma Chartered Accountants · Automated notification from DataSense Pro.</p>
#   </td></tr>
# </table>
# </td></tr></table>
# </body></html>"""


# async def _send_share_notification(shared_with: str, granted_by: str, filename: str) -> None:
#     if not settings.SMTP_HOST or not shared_with:
#         return
#     import aiosmtplib

#     sharer_display = granted_by.split("@")[0].replace(".", " ").title()
#     msg = EmailMessage()
#     msg["Subject"] = f'{sharer_display} shared "{filename}" with you on DataSense'
#     msg["From"] = settings.SMTP_FROM
#     msg["To"] = shared_with
#     msg.set_content(
#         f"Hi,\n\n{sharer_display} ({granted_by}) has shared the dataset \"{filename}\" with you on DataSense Pro.\n\n"
#         f"Open DataSense: {settings.APP_URL}\n\n"
#         "The dataset will appear in your DataSense library once you log in."
#     )
#     msg.add_alternative(
#         _share_email_html(shared_with, granted_by, filename, settings.APP_URL),
#         subtype="html",
#     )
#     try:
#         await aiosmtplib.send(
#             msg,
#             hostname=settings.SMTP_HOST,
#             port=settings.SMTP_PORT,
#             username=settings.SMTP_USER,
#             password=settings.SMTP_PASS,
#             start_tls=settings.SMTP_USE_TLS,
#             use_tls=settings.SMTP_USE_SSL,
#         )
#         logger.info("Share notification sent to %s for dataset %s", shared_with, filename)
#     except Exception as exc:
#         logger.warning("Failed to send share notification to %s: %s", shared_with, exc)

# router = APIRouter()


# @router.get("/datasets", response_model=list)
# async def list_datasets(rls: tuple = Depends(get_user_conn)):
#     """List datasets visible to the current user (RLS enforced)."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, original_filename, file_type, table_name, row_count, columns, ingest_warnings, created_at, owner, dataset_type, audit_area_code, pii_detected, lineage FROM datasets ORDER BY created_at DESC"
#         )
#     return [dict(r) for r in rows]


# @router.get("/datasets/{dataset_id}", response_model=dict)
# async def get_dataset(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT * FROM datasets WHERE id = $1", dataset_id
#         )
#     if not row:
#         raise HTTPException(status_code=404, detail="Dataset not found")
#     return dict(row)


# @router.delete("/datasets/{dataset_id}")
# async def delete_dataset(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
#     pool: asyncpg.Pool = Depends(get_db_pool),
# ):
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         row = await conn.fetchrow(
#             "SELECT file_path, table_name FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         await conn.execute(
#             "UPDATE jobs SET dataset_id = NULL WHERE dataset_id = $1",
#             dataset_id,
#         )
#         await conn.execute("DELETE FROM datasets WHERE id = $1", dataset_id)

#     # DROP TABLE requires the superuser pool — analytics_app doesn't own dataset tables
#     if row["table_name"]:
#         async with pool.acquire() as conn:
#             await conn.execute(
#                 f"DROP TABLE IF EXISTS {_validate_table_name(row['table_name'])}"
#             )

#     if row["file_path"] and os.path.exists(row["file_path"]):
#         os.remove(row["file_path"])

#     return {"deleted": str(dataset_id)}


# @router.post("/datasets/{dataset_id}/redetect", response_model=dict)
# async def redetect_types(
#     dataset_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Re-run type inference against the current data in the dataset's
#     Postgres table and update the saved `columns` JSONB metadata.

#     Useful when:
#     - The dataset was uploaded before the inference logic was last improved.
#     - A user has run a cleaning job that changed types and the saved
#       metadata has drifted from the actual table schema.

#     Reads up to 5,000 rows for the inference sample (more than enough for
#     pattern detection; keeps latency low even on huge tables).
#     """
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         ds = await conn.fetchrow(
#             "SELECT id, table_name, columns FROM datasets WHERE id = $1",
#             dataset_id,
#         )
#         if not ds:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if not ds["table_name"]:
#             raise HTTPException(
#                 status_code=400, detail="Dataset has no underlying table"
#             )

#         _validate_table_name(ds["table_name"])
#         rows = await conn.fetch(
#             f"SELECT * FROM {ds['table_name']} LIMIT 5000"
#         )
#         if not rows:
#             return {"id": str(dataset_id), "columns": ds["columns"], "changed": []}

#         # Build a Polars DataFrame directly from asyncpg's native Python types.
#         # Avoid the CSV-roundtrip approach: str(datetime.date) → "2024-01-01"
#         # is fine, but str(datetime.datetime) → "2024-01-01 00:00:00" makes the
#         # sniffer classify DATE columns as DATETIME after a cleaning run.
#         # Building column-by-column lets Polars retain the real dtype.
#         import datetime as _dt
#         import io
#         col_names = list(rows[0].keys())
#         col_data: dict[str, list] = {c: [] for c in col_names}
#         for r in rows:
#             for c in col_names:
#                 col_data[c].append(r[c])

#         series_list: list[pl.Series] = []
#         for c in col_names:
#             vals = col_data[c]
#             # Peek at first non-None value to choose the right Polars dtype.
#             sample = next((v for v in vals if v is not None), None)
#             try:
#                 if isinstance(sample, bool):
#                     s = pl.Series(c, vals, dtype=pl.Boolean)
#                 elif isinstance(sample, int):
#                     s = pl.Series(c, vals, dtype=pl.Int64)
#                 elif isinstance(sample, float):
#                     s = pl.Series(c, vals, dtype=pl.Float64)
#                 elif isinstance(sample, _dt.datetime):
#                     s = pl.Series(c, vals, dtype=pl.Datetime)
#                 elif isinstance(sample, _dt.date):
#                     s = pl.Series(c, vals, dtype=pl.Date)
#                 else:
#                     # Text / None-only columns — let Polars infer from strings.
#                     str_vals = [str(v) if v is not None else None for v in vals]
#                     s = pl.Series(c, str_vals, dtype=pl.String)
#             except Exception:
#                 # Last resort: stringify everything.
#                 str_vals = [str(v) if v is not None else None for v in vals]
#                 s = pl.Series(c, str_vals, dtype=pl.String)
#             series_list.append(s)

#         df = pl.DataFrame(series_list)

#         # Preserve any non-inference fields (original_name, native_dtype, etc.)
#         # that were saved on prior ingest by merging onto the existing entries.
#         existing = {m["name"]: m for m in (ds["columns"] or []) if m.get("name")}
#         new_meta: list[dict] = []
#         changed: list[dict] = []
#         for col in df.columns:
#             new_type = _infer_type(df[col])
#             prior = existing.get(col, {"name": col, "original_name": col})
#             old_type = prior.get("inferred_type")
#             merged = {
#                 **prior,
#                 "name": col,
#                 "inferred_type": new_type,
#             }
#             new_meta.append(merged)
#             if old_type != new_type:
#                 changed.append({"column": col, "from": old_type, "to": new_type})

#         await conn.execute(
#             "UPDATE datasets SET columns = $1 WHERE id = $2",
#             json.dumps(new_meta),
#             dataset_id,
#         )

#     return {"id": str(dataset_id), "columns": new_meta, "changed": changed}


# @router.patch("/datasets/{dataset_id}", response_model=dict)
# async def update_dataset(
#     dataset_id: UUID,
#     dataset_type: str | None = Body(default=None, embed=True),
#     audit_area_code: str | None = Body(default=None, embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Owner-editable dataset metadata: dataset_type (auto-detect override)
#     and audit_area_code (firm A–Z tag, see core.audit_areas)."""
#     if dataset_type is None and audit_area_code is None:
#         raise HTTPException(
#             status_code=400,
#             detail="Provide at least one of: dataset_type, audit_area_code",
#         )

#     if dataset_type is not None:
#         valid_types = {
#             "journal_entries", "financial_statements", "debtors_creditors",
#             "register_analytics", "general",
#         }
#         if dataset_type not in valid_types:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Invalid dataset_type. Must be one of: {valid_types}",
#             )

#     # audit_area_code: empty string means "clear the tag"; treat as NULL.
#     # Otherwise it's a `vertical:code` id (e.g. 'general:F-PPE'); the FK to
#     # core.audit_areas(id) gives the final word on validity.
#     audit_area_clear = audit_area_code == ""
#     if audit_area_code and not audit_area_clear:
#         if ":" not in audit_area_code or len(audit_area_code) > 100:
#             raise HTTPException(
#                 status_code=400,
#                 detail="audit_area_code must look like 'vertical:code' (e.g. 'general:F-PPE')",
#             )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         sets: list[str] = []
#         args: list = []
#         if dataset_type is not None:
#             args.append(dataset_type)
#             sets.append(f"dataset_type = ${len(args)}")
#         if audit_area_code is not None:
#             args.append(None if audit_area_clear else audit_area_code)
#             sets.append(f"audit_area_code = ${len(args)}")
#         args.append(dataset_id)
#         try:
#             row = await conn.fetchrow(
#                 f"UPDATE datasets SET {', '.join(sets)} WHERE id = ${len(args)} "
#                 "RETURNING id, dataset_type, audit_area_code",
#                 *args,
#             )
#         except asyncpg.ForeignKeyViolationError:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Unknown audit_area_code (not in core.audit_areas)",
#             )
#     if not row:
#         raise HTTPException(
#             status_code=404, detail="Dataset not found or not owned by you"
#         )
#     return dict(row)


# @router.post("/datasets/merge", response_model=dict)
# async def merge_datasets(
#     dataset_ids: list[str] = Body(..., embed=True),
#     name: str = Body(..., embed=True),
#     strategy: str = Body(default="union_all", embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Stack rows from multiple datasets into a new dataset.

#     **strategy** controls how tables are combined:
#     - `union_all` (default) — server-side `UNION ALL` in Postgres; handles
#       arbitrary row counts without Python memory pressure.
#     - `diagonal` — legacy Polars diagonal_relaxed concat; used only when
#       column-name alignment is impossible server-side.
#     """
#     if len(dataset_ids) < 2:
#         raise HTTPException(
#             status_code=400, detail="Select at least 2 datasets to merge"
#         )
#     if strategy not in {"union_all", "diagonal"}:
#         raise HTTPException(
#             status_code=400, detail="strategy must be 'union_all' or 'diagonal'"
#         )

#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, table_name, original_filename, row_count FROM datasets WHERE id = ANY($1::uuid[]) AND table_name IS NOT NULL",
#             [UUID(i) for i in dataset_ids],
#         )
#         if len(rows) < 2:
#             raise HTTPException(
#                 status_code=404,
#                 detail="Could not find 2 or more accessible datasets",
#             )

#         table_names = [r["table_name"] for r in rows]
#         validated = [_validate_table_name(t) for t in table_names]

#         if strategy == "union_all":
#             # 1. Discover the union of all columns across all tables
#             all_cols: set[str] = set()
#             per_table_cols: list[list[str]] = []
#             for t in validated:
#                 cols = await conn.fetch(
#                     f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'datasets' AND table_name = $1",
#                     t.split(".")[-1],
#                 )
#                 cnames = [c["column_name"] for c in cols]
#                 per_table_cols.append(cnames)
#                 all_cols.update(cnames)

#             ordered_cols = sorted(all_cols)

#             # 2. Build SELECT expressions with NULL padding for missing columns
#             selects: list[str] = []
#             for idx, cnames in enumerate(per_table_cols):
#                 col_set = set(cnames)
#                 exprs = []
#                 for c in ordered_cols:
#                     if c in col_set:
#                         exprs.append(f'"{c}"')
#                     else:
#                         exprs.append("NULL AS \"" + c + "\"")
#                 table = validated[idx]
#                 selects.append(f"SELECT {', '.join(exprs)} FROM {table}")

#             union_sql = " UNION ALL ".join(selects)

#             # 3. Create new table
#             import uuid as uuid_mod
#             new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
#             await conn.execute(f"CREATE TABLE {new_table} AS {union_sql}")

#             # 4. Count rows
#             row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

#             # 5. Build column metadata
#             col_meta = [
#                 {"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False}
#                 for c in ordered_cols
#             ]

#             # 6. Redetect types from the merged table (sample)
#             sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
#             if sample_rows:
#                 import io
#                 csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
#                 for r in sample_rows:
#                     vals = []
#                     for c in ordered_cols:
#                         v = r[c]
#                         if v is None:
#                             vals.append("")
#                         else:
#                             s = str(v).replace('"', '""')
#                             vals.append(f'"{s}"')
#                     csv_lines.append(",".join(vals))
#                 df = pl.read_csv(
#                     io.StringIO("\n".join(csv_lines)),
#                     infer_schema_length=10_000,
#                     ignore_errors=True,
#                 )
#                 col_meta = []
#                 for c in ordered_cols:
#                     col_meta.append({
#                         "name": c,
#                         "original_name": c,
#                         "inferred_type": _infer_type(df[c]),
#                         "native_dtype": False,
#                     })

#         else:
#             # Legacy diagonal merge via Polars (fallback)
#             dfs: list[pl.DataFrame] = []
#             for t in validated:
#                 db_rows = await conn.fetch(f"SELECT * FROM {t}")
#                 if db_rows:
#                     dfs.append(pl.from_dicts([dict(r) for r in db_rows]))

#             if not dfs:
#                 raise HTTPException(
#                     status_code=400, detail="Selected datasets contain no data"
#                 )

#             merged_df = pl.concat(dfs, how="diagonal_relaxed")
#             meta = await ingest_dataframe(conn, merged_df)
#             if not meta["table_name"]:
#                 raise HTTPException(
#                     status_code=400, detail="Merge produced no data"
#                 )
#             new_table = meta["table_name"]
#             row_count = meta["row_count"]
#             col_meta = meta["columns"]

#         # Build lineage
#         lineage = {
#             "source_type": "merge",
#             "strategy": strategy,
#             "parents": [str(r["id"]) for r in rows],
#             "parent_names": [r["original_filename"] for r in rows],
#             "parent_row_counts": [r["row_count"] for r in rows],
#             "performed_by": owner,
#             "performed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
#         }

#         dataset_id = await conn.fetchval(
#             """
#             INSERT INTO datasets
#                 (client_id, engagement_id, original_filename, file_type,
#                  table_name, file_path, row_count, columns, ingest_warnings, owner, lineage)
#             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
#             RETURNING id
#             """,
#             None,  # client_id — will be set by EngagementPicker once SPA wires it
#             None,  # engagement_id
#             name,
#             "merged",
#             new_table,
#             None,
#             row_count,
#             json.dumps(col_meta),
#             json.dumps([]),
#             owner,
#             json.dumps(lineage),
#         )

#     return {
#         "id": str(dataset_id),
#         "original_filename": name,
#         "file_type": "merged",
#         "table_name": new_table,
#         "row_count": row_count,
#         "columns": col_meta,
#         "lineage": lineage,
#     }


# @router.get("/datasets/{dataset_id}/shares", response_model=list)
# async def list_shares(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
#     """List shares for a dataset. Only the owner can see their share list."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         rows = await conn.fetch(
#             "SELECT id, shared_with, granted_by, created_at FROM dataset_shares WHERE dataset_id = $1",
#             dataset_id,
#         )
#     return [dict(r) for r in rows]


# @router.post("/datasets/{dataset_id}/shares", response_model=dict)
# async def create_share(
#     dataset_id: UUID,
#     shared_with: str = Body(..., embed=True),
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Grant read access to another user. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner, original_filename FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403, detail="Only the dataset owner can share it"
#             )

#         existing = await conn.fetchval(
#             "SELECT id FROM dataset_shares WHERE dataset_id = $1 AND shared_with = $2",
#             dataset_id,
#             shared_with,
#         )
#         if existing:
#             raise HTTPException(
#                 status_code=409, detail="Already shared with this user"
#             )

#         row = await conn.fetchrow(
#             """
#             INSERT INTO dataset_shares (dataset_id, shared_with, granted_by)
#             VALUES ($1, $2, $3)
#             RETURNING id, dataset_id, shared_with, granted_by, created_at
#             """,
#             dataset_id,
#             shared_with,
#             owner,
#         )

#     filename = dataset_row["original_filename"] or str(dataset_id)
#     asyncio.create_task(_send_share_notification(shared_with, owner, filename))
#     return dict(row)


# @router.delete("/datasets/{dataset_id}/shares/{share_id}")
# async def delete_share(
#     dataset_id: UUID,
#     share_id: UUID,
#     rls: tuple = Depends(get_user_conn),
# ):
#     """Revoke a share. Only the dataset owner may call this."""
#     rls_pool, owner = rls
#     async with rls_conn(rls_pool, owner) as conn:
#         dataset_row = await conn.fetchrow(
#             "SELECT owner FROM datasets WHERE id = $1", dataset_id
#         )
#         if not dataset_row:
#             raise HTTPException(status_code=404, detail="Dataset not found")
#         if dataset_row["owner"] != owner:
#             raise HTTPException(
#                 status_code=403,
#                 detail="Only the dataset owner can revoke shares",
#             )
#         await conn.execute(
#             "DELETE FROM dataset_shares WHERE id = $1 AND dataset_id = $2",
#             share_id,
#             dataset_id,
#         )
#     return {"deleted": str(share_id)}

"""Dataset CRUD + merge + share endpoints."""
import asyncio
import json
import os
from email.message import EmailMessage
from uuid import UUID

import asyncpg
import polars as pl
from fastapi import APIRouter, Body, Depends, HTTPException

from app.config import settings
from app.db import get_db_pool
from app.deps import _validate_table_name, get_user_conn, rls_conn
from app.ingestion import _infer_type, ingest_dataframe

logger = __import__("logging").getLogger(__name__)


# ─── Share notification email ─────────────────────────────────────────────────

def _share_email_html(shared_with: str, granted_by: str, filename: str, app_url: str) -> str:
    sharer_display = granted_by.split("@")[0].replace(".", " ").title()
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e3d8;">
  <tr><td style="background:#9a3324;padding:24px 32px;border-radius:8px 8px 0 0;">
    <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Varma &amp; Varma · DataSense</p>
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">A dataset was shared with you</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;color:#3d3530;font-size:15px;">Hi {shared_with.split('@')[0].replace('.', ' ').title()},</p>
    <p style="margin:0 0 24px;color:#5c534d;font-size:14px;line-height:1.6;">
      <strong>{sharer_display}</strong> (<a href="mailto:{granted_by}" style="color:#9a3324;text-decoration:none;">{granted_by}</a>)
      has shared a dataset with you on DataSense Pro.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e3d8;border-radius:6px;margin-bottom:24px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0 0 4px;font-size:11px;color:#a89d96;letter-spacing:0.06em;text-transform:uppercase;">Dataset</p>
        <p style="margin:0;font-size:14px;font-weight:600;color:#3d3530;font-family:monospace;">{filename}</p>
      </td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:#9a3324;border-radius:6px;">
        <a href="{app_url}" style="display:inline-block;padding:11px 24px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Open DataSense</a>
      </td></tr>
    </table>
    <p style="margin:0;color:#a89d96;font-size:12px;line-height:1.6;">
      The dataset will appear in your DataSense library once you log in.
      You can view and analyse it but cannot share it further or delete it.
    </p>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#faf8f5;border-top:1px solid #e8e3d8;border-radius:0 0 8px 8px;">
    <p style="margin:0;color:#a89d96;font-size:11px;">Varma &amp; Varma Chartered Accountants · Automated notification from DataSense Pro.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


async def _send_share_notification(shared_with: str, granted_by: str, filename: str) -> None:
    if not settings.SMTP_HOST or not shared_with:
        return
    import aiosmtplib

    sharer_display = granted_by.split("@")[0].replace(".", " ").title()
    msg = EmailMessage()
    msg["Subject"] = f'{sharer_display} shared "{filename}" with you on DataSense'
    msg["From"] = settings.SMTP_FROM
    msg["To"] = shared_with
    msg.set_content(
        f"Hi,\n\n{sharer_display} ({granted_by}) has shared the dataset \"{filename}\" with you on DataSense Pro.\n\n"
        f"Open DataSense: {settings.APP_URL}\n\n"
        "The dataset will appear in your DataSense library once you log in."
    )
    msg.add_alternative(
        _share_email_html(shared_with, granted_by, filename, settings.APP_URL),
        subtype="html",
    )
    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
            start_tls=settings.SMTP_USE_TLS,
            use_tls=settings.SMTP_USE_SSL,
        )
        logger.info("Share notification sent to %s for dataset %s", shared_with, filename)
    except Exception as exc:
        logger.warning("Failed to send share notification to %s: %s", shared_with, exc)

router = APIRouter()


@router.get("/datasets", response_model=list)
async def list_datasets(rls: tuple = Depends(get_user_conn)):
    """List datasets visible to the current user (RLS enforced)."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            "SELECT id, original_filename, file_type, table_name, row_count, columns, ingest_warnings, created_at, owner, dataset_type, audit_area_code, pii_detected, lineage FROM datasets ORDER BY created_at DESC"
        )
    import json as _json

    result = []
    for r in rows:
        d = dict(r)
        # Calculate completeness_pct from columns metadata
        # completeness = average of (100 - null_pct) across all columns
        cols = d.get("columns")
        if cols:
            if isinstance(cols, str):
                try:
                    cols = _json.loads(cols)
                except Exception:
                    cols = []
            null_pcts = [c.get("null_pct", 0) for c in cols if isinstance(c, dict)]
            if null_pcts:
                avg_null = sum(null_pcts) / len(null_pcts)
                d["completeness_pct"] = round(100 - avg_null, 1)
            else:
                d["completeness_pct"] = None
        else:
            d["completeness_pct"] = None
        result.append(d)
    return result


@router.get("/datasets/{dataset_id}", response_model=dict)
async def get_dataset(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM datasets WHERE id = $1", dataset_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dict(row)


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(
    dataset_id: UUID,
    rls: tuple = Depends(get_user_conn),
    pool: asyncpg.Pool = Depends(get_db_pool),
):
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        row = await conn.fetchrow(
            "SELECT file_path, table_name FROM datasets WHERE id = $1",
            dataset_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Dataset not found")
        await conn.execute(
            "UPDATE jobs SET dataset_id = NULL WHERE dataset_id = $1",
            dataset_id,
        )
        await conn.execute("DELETE FROM datasets WHERE id = $1", dataset_id)

    # DROP TABLE requires the superuser pool — analytics_app doesn't own dataset tables
    if row["table_name"]:
        async with pool.acquire() as conn:
            await conn.execute(
                f"DROP TABLE IF EXISTS {_validate_table_name(row['table_name'])}"
            )

    if row["file_path"] and os.path.exists(row["file_path"]):
        os.remove(row["file_path"])

    return {"deleted": str(dataset_id)}


@router.post("/datasets/{dataset_id}/redetect", response_model=dict)
async def redetect_types(
    dataset_id: UUID,
    rls: tuple = Depends(get_user_conn),
):
    """Re-run type inference against the current data in the dataset's
    Postgres table and update the saved `columns` JSONB metadata.

    Useful when:
    - The dataset was uploaded before the inference logic was last improved.
    - A user has run a cleaning job that changed types and the saved
      metadata has drifted from the actual table schema.

    Reads up to 5,000 rows for the inference sample (more than enough for
    pattern detection; keeps latency low even on huge tables).
    """
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        ds = await conn.fetchrow(
            "SELECT id, table_name, columns FROM datasets WHERE id = $1",
            dataset_id,
        )
        if not ds:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if not ds["table_name"]:
            raise HTTPException(
                status_code=400, detail="Dataset has no underlying table"
            )

        _validate_table_name(ds["table_name"])
        rows = await conn.fetch(
            f"SELECT * FROM {ds['table_name']} LIMIT 5000"
        )
        if not rows:
            return {"id": str(dataset_id), "columns": ds["columns"], "changed": []}

        # Build a Polars DataFrame directly from asyncpg's native Python types.
        # Avoid the CSV-roundtrip approach: str(datetime.date) → "2024-01-01"
        # is fine, but str(datetime.datetime) → "2024-01-01 00:00:00" makes the
        # sniffer classify DATE columns as DATETIME after a cleaning run.
        # Building column-by-column lets Polars retain the real dtype.
        import datetime as _dt
        import io
        col_names = list(rows[0].keys())
        col_data: dict[str, list] = {c: [] for c in col_names}
        for r in rows:
            for c in col_names:
                col_data[c].append(r[c])

        series_list: list[pl.Series] = []
        for c in col_names:
            vals = col_data[c]
            # Peek at first non-None value to choose the right Polars dtype.
            sample = next((v for v in vals if v is not None), None)
            try:
                if isinstance(sample, bool):
                    s = pl.Series(c, vals, dtype=pl.Boolean)
                elif isinstance(sample, int):
                    s = pl.Series(c, vals, dtype=pl.Int64)
                elif isinstance(sample, float):
                    s = pl.Series(c, vals, dtype=pl.Float64)
                elif isinstance(sample, _dt.datetime):
                    s = pl.Series(c, vals, dtype=pl.Datetime)
                elif isinstance(sample, _dt.date):
                    s = pl.Series(c, vals, dtype=pl.Date)
                else:
                    # Text / None-only columns — let Polars infer from strings.
                    str_vals = [str(v) if v is not None else None for v in vals]
                    s = pl.Series(c, str_vals, dtype=pl.String)
            except Exception:
                # Last resort: stringify everything.
                str_vals = [str(v) if v is not None else None for v in vals]
                s = pl.Series(c, str_vals, dtype=pl.String)
            series_list.append(s)

        df = pl.DataFrame(series_list)

        # Preserve any non-inference fields (original_name, native_dtype, etc.)
        # that were saved on prior ingest by merging onto the existing entries.
        existing = {m["name"]: m for m in (ds["columns"] or []) if m.get("name")}
        new_meta: list[dict] = []
        changed: list[dict] = []
        for col in df.columns:
            new_type = _infer_type(df[col])
            prior = existing.get(col, {"name": col, "original_name": col})
            old_type = prior.get("inferred_type")
            merged = {
                **prior,
                "name": col,
                "inferred_type": new_type,
            }
            new_meta.append(merged)
            if old_type != new_type:
                changed.append({"column": col, "from": old_type, "to": new_type})

        await conn.execute(
            "UPDATE datasets SET columns = $1 WHERE id = $2",
            json.dumps(new_meta),
            dataset_id,
        )

    return {"id": str(dataset_id), "columns": new_meta, "changed": changed}


@router.patch("/datasets/{dataset_id}", response_model=dict)
async def update_dataset(
    dataset_id: UUID,
    dataset_type: str | None = Body(default=None, embed=True),
    audit_area_code: str | None = Body(default=None, embed=True),
    rls: tuple = Depends(get_user_conn),
):
    """Owner-editable dataset metadata: dataset_type (auto-detect override)
    and audit_area_code (firm A–Z tag, see core.audit_areas)."""
    if dataset_type is None and audit_area_code is None:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: dataset_type, audit_area_code",
        )

    if dataset_type is not None:
        valid_types = {
            "journal_entries", "financial_statements", "debtors_creditors",
            "register_analytics", "general",
        }
        if dataset_type not in valid_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid dataset_type. Must be one of: {valid_types}",
            )

    # audit_area_code: empty string means "clear the tag"; treat as NULL.
    # Otherwise it's a `vertical:code` id (e.g. 'general:F-PPE'); the FK to
    # core.audit_areas(id) gives the final word on validity.
    audit_area_clear = audit_area_code == ""
    if audit_area_code and not audit_area_clear:
        if ":" not in audit_area_code or len(audit_area_code) > 100:
            raise HTTPException(
                status_code=400,
                detail="audit_area_code must look like 'vertical:code' (e.g. 'general:F-PPE')",
            )

    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        sets: list[str] = []
        args: list = []
        if dataset_type is not None:
            args.append(dataset_type)
            sets.append(f"dataset_type = ${len(args)}")
        if audit_area_code is not None:
            args.append(None if audit_area_clear else audit_area_code)
            sets.append(f"audit_area_code = ${len(args)}")
        args.append(dataset_id)
        try:
            row = await conn.fetchrow(
                f"UPDATE datasets SET {', '.join(sets)} WHERE id = ${len(args)} "
                "RETURNING id, dataset_type, audit_area_code",
                *args,
            )
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown audit_area_code (not in core.audit_areas)",
            )
    if not row:
        raise HTTPException(
            status_code=404, detail="Dataset not found or not owned by you"
        )
    return dict(row)


@router.post("/datasets/merge", response_model=dict)
async def merge_datasets(
    dataset_ids: list[str] = Body(..., embed=True),
    name: str = Body(..., embed=True),
    strategy: str = Body(default="union_all", embed=True),
    join_key: str | None = Body(default=None, embed=True),
    rls: tuple = Depends(get_user_conn),
):
    """Stack or join rows from multiple datasets into a new dataset.

    **strategy** controls how tables are combined:
    - `union_all` (default) — server-side UNION ALL; preserves left table column order.
    - `join` — LEFT JOIN on a shared unique key column (join_key required).
    - `diagonal` — legacy Polars diagonal_relaxed concat fallback.
    """
    if len(dataset_ids) < 2:
        raise HTTPException(
            status_code=400, detail="Select at least 2 datasets to merge"
        )
    if strategy not in {"union_all", "join", "diagonal"}:
        raise HTTPException(
            status_code=400, detail="strategy must be 'union_all', 'join', or 'diagonal'"
        )
    if strategy == "join" and not join_key:
        raise HTTPException(
            status_code=400, detail="join_key is required when strategy is 'join'"
        )

    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            "SELECT id, table_name, original_filename, row_count FROM datasets WHERE id = ANY($1::uuid[]) AND table_name IS NOT NULL",
            [UUID(i) for i in dataset_ids],
        )
        if len(rows) < 2:
            raise HTTPException(
                status_code=404,
                detail="Could not find 2 or more accessible datasets",
            )

        table_names = [r["table_name"] for r in rows]
        validated = [_validate_table_name(t) for t in table_names]

        if strategy == "union_all":
            # 1. Discover the union of all columns across all tables
            all_cols: set[str] = set()
            per_table_cols: list[list[str]] = []
            for t in validated:
                cols = await conn.fetch(
                    f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'datasets' AND table_name = $1",
                    t.split(".")[-1],
                )
                cnames = [c["column_name"] for c in cols]
                per_table_cols.append(cnames)
                all_cols.update(cnames)

            # Preserve left (primary) table column order, append extra cols from other tables
            left_cols = per_table_cols[0]
            extra_cols = [c for c in all_cols if c not in set(left_cols)]
            ordered_cols = left_cols + sorted(extra_cols)

            # 2. Build SELECT expressions with NULL padding for missing columns
            selects: list[str] = []
            for idx, cnames in enumerate(per_table_cols):
                col_set = set(cnames)
                exprs = []
                for c in ordered_cols:
                    if c in col_set:
                        exprs.append(f'"{c}"')
                    else:
                        exprs.append("NULL AS \"" + c + "\"")
                table = validated[idx]
                selects.append(f"SELECT {', '.join(exprs)} FROM {table}")

            union_sql = " UNION ALL ".join(selects)

            # 3. Create new table
            import uuid as uuid_mod
            new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
            await conn.execute(f"CREATE TABLE {new_table} AS {union_sql}")

            # 4. Count rows
            row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

            # 5. Build column metadata
            col_meta = [
                {"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False}
                for c in ordered_cols
            ]

            # 6. Redetect types from the merged table (sample)
            sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
            if sample_rows:
                import io
                csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
                for r in sample_rows:
                    vals = []
                    for c in ordered_cols:
                        v = r[c]
                        if v is None:
                            vals.append("")
                        else:
                            s = str(v).replace('"', '""')
                            vals.append(f'"{s}"')
                    csv_lines.append(",".join(vals))
                df = pl.read_csv(
                    io.StringIO("\n".join(csv_lines)),
                    infer_schema_length=10_000,
                    ignore_errors=True,
                )
                col_meta = []
                for c in ordered_cols:
                    col_meta.append({
                        "name": c,
                        "original_name": c,
                        "inferred_type": _infer_type(df[c]),
                        "native_dtype": False,
                    })

        elif strategy == "join":
            # LEFT JOIN on a shared unique key — left table is primary
            import uuid as uuid_mod
            left_table  = validated[0]
            right_table = validated[1]

            # Get left table columns (preserves original order)
            left_cols_rows = await conn.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'datasets' AND table_name = $1 ORDER BY ordinal_position",
                left_table.split(".")[-1],
            )
            left_cols = [c["column_name"] for c in left_cols_rows]

            # Get right table columns
            right_cols_rows = await conn.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'datasets' AND table_name = $1 ORDER BY ordinal_position",
                right_table.split(".")[-1],
            )
            right_cols = [c["column_name"] for c in right_cols_rows]

            # Build SELECT: all left cols first, then right cols (excluding join key to avoid duplicate)
            left_exprs  = [f'l."{c}"' for c in left_cols]
            right_exprs = [f'r."{c}" AS "{c}"' for c in right_cols if c != join_key]

            all_exprs = left_exprs + right_exprs
            ordered_cols = left_cols + [c for c in right_cols if c != join_key]

            join_sql = (
                f"SELECT {', '.join(all_exprs)} "
                f"FROM {left_table} l "
                f"LEFT JOIN {right_table} r ON l.\"{join_key}\" = r.\"{join_key}\""
            )

            new_table = f"datasets.ds_{uuid_mod.uuid4().hex}"
            await conn.execute(f"CREATE TABLE {new_table} AS {join_sql}")
            row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {new_table}")

            # Build col metadata
            sample_rows = await conn.fetch(f"SELECT * FROM {new_table} LIMIT 5000")
            col_meta = []
            if sample_rows:
                import io
                csv_lines = [",".join(f'"{c}"' for c in ordered_cols)]
                for r in sample_rows:
                    vals = []
                    for c in ordered_cols:
                        v = r[c] if c in dict(r) else None
                        if v is None:
                            vals.append("")
                        else:
                            s = str(v).replace('"', '""')
                            vals.append(f'"{s}"')
                    csv_lines.append(",".join(vals))
                df = pl.read_csv(
                    io.StringIO("\n".join(csv_lines)),
                    infer_schema_length=10_000,
                    ignore_errors=True,
                )
                for c in ordered_cols:
                    col_meta.append({
                        "name": c,
                        "original_name": c,
                        "inferred_type": _infer_type(df[c]) if c in df.columns else "text",
                        "native_dtype": False,
                    })
            else:
                col_meta = [{"name": c, "original_name": c, "inferred_type": "text", "native_dtype": False} for c in ordered_cols]

        else:
            # Legacy diagonal merge via Polars (fallback)
            dfs: list[pl.DataFrame] = []
            for t in validated:
                db_rows = await conn.fetch(f"SELECT * FROM {t}")
                if db_rows:
                    dfs.append(pl.from_dicts([dict(r) for r in db_rows]))

            if not dfs:
                raise HTTPException(
                    status_code=400, detail="Selected datasets contain no data"
                )

            merged_df = pl.concat(dfs, how="diagonal_relaxed")
            meta = await ingest_dataframe(conn, merged_df)
            if not meta["table_name"]:
                raise HTTPException(
                    status_code=400, detail="Merge produced no data"
                )
            new_table = meta["table_name"]
            row_count = meta["row_count"]
            col_meta = meta["columns"]

        # Build lineage
        lineage = {
            "source_type": "merge",
            "strategy": strategy,
            "join_key": join_key,
            "parents": [str(r["id"]) for r in rows],
            "parent_names": [r["original_filename"] for r in rows],
            "parent_row_counts": [r["row_count"] for r in rows],
            "performed_by": owner,
            "performed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }

        dataset_id = await conn.fetchval(
            """
            INSERT INTO datasets
                (client_id, engagement_id, original_filename, file_type,
                 table_name, file_path, row_count, columns, ingest_warnings, owner, lineage)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id
            """,
            None,  # client_id — will be set by EngagementPicker once SPA wires it
            None,  # engagement_id
            name,
            "merged",
            new_table,
            None,
            row_count,
            json.dumps(col_meta),
            json.dumps([]),
            owner,
            json.dumps(lineage),
        )

    return {
        "id": str(dataset_id),
        "original_filename": name,
        "file_type": "merged",
        "table_name": new_table,
        "row_count": row_count,
        "columns": col_meta,
        "lineage": lineage,
    }


@router.get("/datasets/{dataset_id}/shares", response_model=list)
async def list_shares(dataset_id: UUID, rls: tuple = Depends(get_user_conn)):
    """List shares for a dataset. Only the owner can see their share list."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        rows = await conn.fetch(
            "SELECT id, shared_with, granted_by, created_at FROM dataset_shares WHERE dataset_id = $1",
            dataset_id,
        )
    return [dict(r) for r in rows]


@router.post("/datasets/{dataset_id}/shares", response_model=dict)
async def create_share(
    dataset_id: UUID,
    shared_with: str = Body(..., embed=True),
    rls: tuple = Depends(get_user_conn),
):
    """Grant read access to another user. Only the dataset owner may call this."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        dataset_row = await conn.fetchrow(
            "SELECT owner, original_filename FROM datasets WHERE id = $1", dataset_id
        )
        if not dataset_row:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset_row["owner"] != owner:
            raise HTTPException(
                status_code=403, detail="Only the dataset owner can share it"
            )

        existing = await conn.fetchval(
            "SELECT id FROM dataset_shares WHERE dataset_id = $1 AND shared_with = $2",
            dataset_id,
            shared_with,
        )
        if existing:
            raise HTTPException(
                status_code=409, detail="Already shared with this user"
            )

        row = await conn.fetchrow(
            """
            INSERT INTO dataset_shares (dataset_id, shared_with, granted_by)
            VALUES ($1, $2, $3)
            RETURNING id, dataset_id, shared_with, granted_by, created_at
            """,
            dataset_id,
            shared_with,
            owner,
        )

    filename = dataset_row["original_filename"] or str(dataset_id)
    asyncio.create_task(_send_share_notification(shared_with, owner, filename))
    return dict(row)


@router.delete("/datasets/{dataset_id}/shares/{share_id}")
async def delete_share(
    dataset_id: UUID,
    share_id: UUID,
    rls: tuple = Depends(get_user_conn),
):
    """Revoke a share. Only the dataset owner may call this."""
    rls_pool, owner = rls
    async with rls_conn(rls_pool, owner) as conn:
        dataset_row = await conn.fetchrow(
            "SELECT owner FROM datasets WHERE id = $1", dataset_id
        )
        if not dataset_row:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset_row["owner"] != owner:
            raise HTTPException(
                status_code=403,
                detail="Only the dataset owner can revoke shares",
            )
        await conn.execute(
            "DELETE FROM dataset_shares WHERE id = $1 AND dataset_id = $2",
            share_id,
            dataset_id,
        )
    return {"deleted": str(share_id)}