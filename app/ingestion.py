# # app/ingestion.py
# """
# File ingestion: CSV / XLSX / PDF / Tally XML  →  PostgreSQL table.

# Each uploaded file gets its own table in the `datasets` schema
# (named  datasets.ds_<uuid_hex>).  Column names are normalised
# (lower-cased, spaces replaced with underscores) so they are
# always valid SQL identifiers.

# Returns a dict with:
#   table_name      str  – fully-qualified table name
#   row_count       int
#   columns         list[dict]  – [{name, inferred_type}]
#   warnings        list[str]   – non-fatal parse notes
# """

# from __future__ import annotations

# import asyncio
# import re
# import io
# import json
# import os
# import uuid
# from datetime import date, datetime
# from typing import Any

# import asyncpg
# import polars as pl


# # ---------------------------------------------------------------------------
# # Helpers
# # ---------------------------------------------------------------------------


# def _safe_col(name: str) -> str:
#     """Normalise a column name to a safe SQL identifier."""
#     name = str(name).strip().lower()
#     name = re.sub(r"[^a-z0-9_]", "_", name)
#     name = re.sub(r"_+", "_", name).strip("_")
#     if not name or name[0].isdigit():
#         name = "col_" + name
#     return name


# _INT_DTYPES = (
#     pl.Int8, pl.Int16, pl.Int32, pl.Int64,
#     pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
# )
# _FLOAT_DTYPES = (pl.Float32, pl.Float64)

# # Pre-compiled regexes — the column may have hundreds of values to scan.
# _DATE_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}$"               # ISO 2024-04-01
#     r"|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$"  # 01/04/24, 01-04-2024
#     r"|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}$"  # 01 Apr 2024
#     r"|^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4}$"  # Apr 1, 2024
# )
# _DATETIME_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?$"
# )
# _NUMBER_RE   = re.compile(r"^-?\d+(\.\d+)?$")
# _CURRENCY_RE = re.compile(r"^[₹$£€]?\s*-?\d{1,3}(,\d{2,3})*(\.\d+)?$|^-?\d+(\.\d+)?$|^-+$")
# _BOOL_TEXT   = {"true", "false", "yes", "no", "y", "n", "t", "f"}


# def _sniff_text_column(series: pl.Series) -> str:
#     """Sample up to 200 non-null trimmed string values and try to detect a
#     semantic type. Returns one of the same labels as `_infer_type`."""
#     try:
#         raw = series.drop_nulls().cast(pl.String).head(200).to_list()
#     except Exception:
#         return "text"
#     sample = [s.strip() for s in raw if s is not None and str(s).strip()]
#     if not sample:
#         return "text"
#     n = len(sample)
#     # ≥ 85% of sampled values must match for a confident classification.
#     threshold = 0.85

#     has_symbol = any(any(c in s for c in "₹$£€") for s in sample)
#     has_thousands_sep = any(re.search(r"\d,\d", s) for s in sample)

#     # Booleans only via text variants — don't claim 0/1 columns are bool, those
#     # could just as well be flag-encoded numbers.
#     bools = sum(1 for s in sample if s.lower() in _BOOL_TEXT)
#     if bools / n >= threshold:
#         return "boolean"

#     # Datetime is more specific than date — try it first.
#     datetimes = sum(1 for s in sample if _DATETIME_RE.match(s))
#     if datetimes / n >= threshold:
#         return "datetime"
#     dates = sum(1 for s in sample if _DATE_RE.match(s))
#     if dates / n >= threshold:
#         return "date"

#     currency_shape = sum(1 for s in sample if _CURRENCY_RE.match(s))
#     pure_numbers = sum(1 for s in sample if _NUMBER_RE.match(s))
#     if currency_shape / n >= threshold:
#         if has_symbol or has_thousands_sep:
#             return "currency"
#         if pure_numbers / n >= threshold:
#             return "number"

#     return "text"


# def _infer_type(series: pl.Series) -> str:
#     """Classify a column for display + cleaning purposes.

#     Returns one of: ``text``, ``number``, ``date``, ``datetime``,
#     ``currency``, ``boolean``. These labels match the values the
#     frontend dropdown uses, so a user-supplied override is a string
#     swap rather than a value translation.
#     """
#     dtype = series.dtype
#     if dtype in _INT_DTYPES or dtype in _FLOAT_DTYPES:
#         return "number"
#     if dtype == pl.Boolean:
#         return "boolean"
#     if dtype == pl.Date:
#         return "date"
#     if dtype == pl.Datetime:
#         return "datetime"
#     return _sniff_text_column(series)


# def _pg_type(inferred: str) -> str:
#     return {
#         # New (UI-aligned) labels
#         "number":   "DOUBLE PRECISION",
#         "currency": "DOUBLE PRECISION",
#         "boolean":  "BOOLEAN",
#         "date":     "DATE",
#         "datetime": "TIMESTAMPTZ",
#         "text":     "TEXT",
#         # Backwards-compat: pre-Phase-3 datasets stored these in `columns` JSONB.
#         "integer":  "BIGINT",
#         "float":    "DOUBLE PRECISION",
#     }.get(inferred, "TEXT")


# def _normalise_df(df: pl.DataFrame) -> tuple[pl.DataFrame, list[dict]]:
#     """Rename columns to safe identifiers; return (new_df, column_meta)."""
#     rename_map: dict[str, str] = {}
#     seen: dict[str, int] = {}
#     for col in df.columns:
#         safe = _safe_col(col)
#         if safe in seen:
#             seen[safe] += 1
#             safe = f"{safe}_{seen[safe]}"
#         else:
#             seen[safe] = 0
#         rename_map[col] = safe  # always assigned, outside if/else

#     df = df.rename(rename_map)

#     def _is_native(s: pl.Series) -> bool:
#         """True when the polars dtype is already structured (not a string).
#         Used by `_create_table_and_insert` to decide whether to store the
#         column at its inferred postgres type (native) or keep it as TEXT
#         (sniffed from a string column — needs the cleaning step to convert)."""
#         return s.dtype not in (pl.String, pl.Utf8, pl.Object, pl.Null)

#     col_meta = [
#         {
#             "name": new,
#             "original_name": old,
#             "inferred_type": _infer_type(df[new]),
#             "native_dtype": _is_native(df[new]),
#         }
#         for old, new in rename_map.items()
#     ]
#     return df, col_meta


# async def _create_table_and_insert(
#     conn: asyncpg.Connection,
#     table_name: str,
#     df: pl.DataFrame,
#     col_meta: list[dict],
# ) -> None:
#     """CREATE TABLE then bulk-insert all rows via COPY.

#     Detected types like ``currency`` and ``date``/``datetime`` (when sniffed
#     from a string column) carry semantic meaning but the raw values are still
#     text on disk — e.g. ``₹1,234.56``. We can't insert those into a
#     DOUBLE PRECISION column directly. So during the initial ingestion we
#     store text-sniffed columns as TEXT and let the optional cleaning step
#     re-create the table with the proper type after parsing the values.
#     """

#     def _storage_type(meta: dict) -> str:
#         """How to physically store this column on disk during initial ingest."""
#         inferred = meta["inferred_type"]
#         # Native polars-typed columns can be stored at their inferred type.
#         # Sniffed-from-text classifications keep TEXT until cleaning runs —
#         # this prevents asyncpg copy errors when raw values contain currency
#         # symbols, commas, or other non-numeric characters.
#         is_native = meta.get("native_dtype", False)
#         if inferred in ("number", "currency", "date", "datetime") and not is_native:
#             return "TEXT"
#         return _pg_type(inferred)

#     col_defs = ", ".join(
#         f'"{m["name"]}" {_storage_type(m)}' for m in col_meta
#     )
#     await conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({col_defs})")

#     col_names = [m["name"] for m in col_meta]
#     rows: list[tuple[Any, ...]] = []
#     for row in df.to_dicts():
#         record = []
#         for m in col_meta:
#             val = row.get(m["name"])
#             inferred = m["inferred_type"]
#             is_native = m.get("native_dtype", False)
#             if val is None:
#                 record.append(None)
#             elif inferred == "boolean":
#                 if is_native:
#                     record.append(bool(val))
#                 else:
#                     record.append(str(val).strip().lower() in ("yes", "true", "1", "y", "t"))
#             elif inferred in ("number", "integer", "float") and is_native:
#                 try:
#                     record.append(float(val))
#                 except (ValueError, TypeError):
#                     record.append(None)
#             elif inferred in ("date", "datetime") and is_native:
#                 if isinstance(val, (date, datetime)):
#                     record.append(val)
#                 else:
#                     record.append(None)
#             else:
#                 record.append(str(val) if val is not None else None)
#         rows.append(tuple(record))

#     await conn.copy_records_to_table(
#         table_name.split(".")[-1],
#         records=rows,
#         columns=col_names,
#         schema_name="datasets",
#     )


# # ---------------------------------------------------------------------------
# # Format-specific parsers  →  polars DataFrame
# # ---------------------------------------------------------------------------


# def _parse_csv(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     warnings: list[str] = []
#     try:
#         df = pl.read_csv(
#             file_path, infer_schema_length=10000, ignore_errors=True
#         )
#     except Exception as e:
#         warnings.append(f"CSV parse warning: {e}")
#         df = pl.read_csv(file_path, infer_schema_length=0)
#     return df, warnings


# def _parse_xlsx(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """Parse an XLSX. Tries to preserve numeric/date types where openpyxl
#     already gave us python-native values, then falls back to text-mode
#     parsing if Polars chokes on mixed types within a column.
#     """
#     warnings: list[str] = []
#     try:
#         import openpyxl

#         wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
#         ws = wb.active
#         rows = list(ws.iter_rows(values_only=True))
#         wb.close()
#         if not rows:
#             return pl.DataFrame(), ["Empty workbook"]

#         headers = [
#             str(h).strip() if h is not None else f"col_{i}"
#             for i, h in enumerate(rows[0])
#         ]

#         # Try the rich path first: feed openpyxl's typed values to Polars
#         # column-by-column so ints/floats/dates stay native. This means
#         # `_infer_type` sees the real polars dtype for native columns and
#         # only falls back to text-sniffing where xlsx itself stored strings.
#         try:
#             data_rows = rows[1:]
#             cols: dict[str, list] = {h: [] for h in headers}
#             for row in data_rows:
#                 for i, cell in enumerate(row):
#                     cols[headers[i]].append(cell)
#             df = pl.DataFrame(cols, infer_schema_length=10000, strict=False)
#             return df, warnings
#         except Exception as e_native:
#             warnings.append(
#                 f"XLSX rich-type parse failed, falling back to text mode: {e_native}"
#             )
#             # Fallback: serialise everything as quoted CSV and re-parse with
#             # Polars in text-only mode, then let the sniffer do its best.
#             csv_lines = [",".join(f'"{c}"' for c in headers)]
#             for row in rows[1:]:
#                 vals = []
#                 for cell in row:
#                     if cell is None:
#                         vals.append("")
#                     else:
#                         s = str(cell).replace('"', '""')
#                         vals.append(f'"{s}"')
#                 csv_lines.append(",".join(vals))
#             csv_data = "\n".join(csv_lines)
#             df = pl.read_csv(
#                 io.StringIO(csv_data),
#                 infer_schema_length=10000,
#                 ignore_errors=True,
#             )
#     except Exception as e:
#         warnings.append(f"XLSX parse warning: {e}")
#         df = pl.read_excel(file_path, engine="openpyxl")
#     return df, warnings


# def _parse_pdf(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Extract tables from a digital (non-scanned) PDF using pdfplumber.
#     Merges all tables across all pages into one DataFrame.
#     Bank statements and Tally-exported PDFs work well here.
#     """
#     import pdfplumber

#     warnings: list[str] = []
#     all_rows: list[dict] = []
#     headers: list[str] = []

#     with pdfplumber.open(file_path) as pdf:
#         for page_num, page in enumerate(pdf.pages, 1):
#             tables = page.extract_tables()
#             for tbl in tables:
#                 if not tbl:
#                     continue
#                 if not headers:
#                     # First table header becomes the column names
#                     headers = [
#                         str(h).strip() if h else f"col_{i}"
#                         for i, h in enumerate(tbl[0])
#                     ]
#                     data_start = 1
#                 else:
#                     data_start = 0
#                     # If this page table has same column count, use it
#                     if len(tbl[0]) != len(headers):
#                         warnings.append(
#                             f"Page {page_num}: table column count mismatch, skipping"
#                         )
#                         continue

#                 for row in tbl[data_start:]:
#                     if all(
#                         cell is None or str(cell).strip() == "" for cell in row
#                     ):
#                         continue
#                     all_rows.append(
#                         {
#                             headers[i]: (
#                                 str(cell).strip() if cell is not None else None
#                             )
#                             for i, cell in enumerate(row)
#                         }
#                     )

#     if not all_rows:
#         warnings.append(
#             "No tables found in PDF — the PDF may be scanned or have no extractable tables"
#         )
#         return pl.DataFrame(), warnings

#     df = pl.from_dicts(all_rows)
#     return df, warnings


# def _parse_tally_xml(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Parse Tally Prime / Tally ERP 9 XML exports.

#     Tally XML follows this structure:
#       <ENVELOPE>
#         <BODY>
#           <EXPORTDATA>
#             <REQUESTDATA>
#               <TALLYMESSAGE>
#                 <VOUCHER>   (or LEDGER / STOCKITEM etc.)
#                   <DATE>...</DATE>
#                   <PARTYLEDGERNAME>...</PARTYLEDGERNAME>
#                   ...
#                 </VOUCHER>
#               </TALLYMESSAGE>

#     We discover the repeating element automatically and flatten
#     its direct children + first-level sub-elements into columns.
#     """
#     from lxml import etree

#     warnings: list[str] = []

#     tree = etree.parse(file_path)
#     root = tree.getroot()

#     # Find TALLYMESSAGE nodes (standard Tally export wrapper)
#     messages = root.findall(".//TALLYMESSAGE")
#     if not messages:
#         warnings.append(
#             "No <TALLYMESSAGE> elements found — treating whole XML as flat records"
#         )
#         messages = [root]

#     rows: list[dict] = []
#     for msg in messages:
#         for child in msg:
#             record: dict[str, Any] = {"_element": child.tag}
#             for elem in child:
#                 # Flatten one level deep; skip nested lists
#                 if len(elem) == 0:
#                     record[elem.tag] = (elem.text or "").strip()
#                 else:
#                     # Nested element: join child text
#                     record[elem.tag] = " | ".join(
#                         (e.text or "").strip() for e in elem if e.text
#                     )
#             if len(record) > 1:  # skip empty records
#                 rows.append(record)

#     if not rows:
#         return pl.DataFrame(), ["No data rows parsed from XML"]

#     df = pl.from_dicts(rows, infer_schema_length=len(rows))
#     return df, warnings


# # ---------------------------------------------------------------------------
# # Public entry points
# # ---------------------------------------------------------------------------


# async def ingest_dataframe(
#     conn: asyncpg.Connection,
#     df: pl.DataFrame,
# ) -> dict:
#     """Ingest a pre-built Polars DataFrame into a new datasets table."""
#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": ["DataFrame is empty"],
#             "pii_detected": False,
#             "pii_summary": None,
#         }

#     df, col_meta = _normalise_df(df)
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan (CPU-bound, runs in executor if called from async context)
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": [],
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }


# async def ingest_file(
#     conn: asyncpg.Connection,
#     file_path: str,
#     file_type: str,
# ) -> dict:
#     """
#     Parse *file_path* according to *file_type* and load it into a new
#     PostgreSQL table.  Returns metadata dict.
#     """
#     # 1. Parse to DataFrame
#     parsers = {
#         "csv": _parse_csv,
#         "xlsx": _parse_xlsx,
#         "pdf": _parse_pdf,
#         "xml": _parse_tally_xml,
#     }
#     if file_type not in parsers:
#         raise ValueError(f"Unsupported file type: {file_type}")

#     # Parsing (Polars CSV/XLSX read) is CPU-bound — run in thread to free event loop
#     loop = asyncio.get_event_loop()
#     df, warnings = await loop.run_in_executor(
#         None, parsers[file_type], file_path
#     )

#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": warnings or ["File produced no data rows"],
#         }

#     # 2. Normalise column names (CPU-bound)
#     df, col_meta = await loop.run_in_executor(None, _normalise_df, df)

#     # 3. Choose table name  datasets.ds_<hex>
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"

#     # 4. Create table + insert
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": warnings,
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }



# app/ingestion.py
# """
# File ingestion: CSV / XLSX / PDF / Tally XML  →  PostgreSQL table.

# Each uploaded file gets its own table in the `datasets` schema
# (named  datasets.ds_<uuid_hex>).  Column names are normalised
# (lower-cased, spaces replaced with underscores) so they are
# always valid SQL identifiers.

# Returns a dict with:
#   table_name      str  – fully-qualified table name
#   row_count       int
#   columns         list[dict]  – [{name, inferred_type}]
#   warnings        list[str]   – non-fatal parse notes
# """

# from __future__ import annotations

# import asyncio
# import re
# import io
# import json
# import os
# import uuid
# from datetime import date, datetime
# from typing import Any

# import asyncpg
# import polars as pl


# # ---------------------------------------------------------------------------
# # Helpers
# # ---------------------------------------------------------------------------


# def _safe_col(name: str) -> str:
#     """Normalise a column name to a safe SQL identifier."""
#     name = str(name).strip().lower()
#     name = re.sub(r"[^a-z0-9_]", "_", name)
#     name = re.sub(r"_+", "_", name).strip("_")
#     if not name or name[0].isdigit():
#         name = "col_" + name
#     return name


# _INT_DTYPES = (
#     pl.Int8, pl.Int16, pl.Int32, pl.Int64,
#     pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
# )
# _FLOAT_DTYPES = (pl.Float32, pl.Float64)

# # Pre-compiled regexes — the column may have hundreds of values to scan.
# _DATE_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}$"               # ISO 2024-04-01
#     r"|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$"  # 01/04/24, 01-04-2024
#     r"|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}$"  # 01 Apr 2024
#     r"|^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4}$"  # Apr 1, 2024
# )
# _DATETIME_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?$"
# )
# _NUMBER_RE   = re.compile(r"^-?\d+(\.\d+)?$")
# _CURRENCY_RE = re.compile(r"^[₹$£€]?\s*-?\d{1,3}(,\d{2,3})*(\.\d+)?$|^-?\d+(\.\d+)?$|^-+$")
# _BOOL_TEXT   = {"true", "false", "yes", "no", "y", "n", "t", "f"}


# def _sniff_text_column(series: pl.Series) -> str:
#     """Sample up to 200 non-null trimmed string values and try to detect a
#     semantic type. Returns one of the same labels as `_infer_type`."""
#     try:
#         raw = series.drop_nulls().cast(pl.String).head(200).to_list()
#     except Exception:
#         return "text"
#     sample = [s.strip() for s in raw if s is not None and str(s).strip()]
#     if not sample:
#         return "text"
#     n = len(sample)
#     # ≥ 85% of sampled values must match for a confident classification.
#     threshold = 0.85

#     has_symbol = any(any(c in s for c in "₹$£€") for s in sample)
#     has_thousands_sep = any(re.search(r"\d,\d", s) for s in sample)

#     # Booleans only via text variants — don't claim 0/1 columns are bool, those
#     # could just as well be flag-encoded numbers.
#     bools = sum(1 for s in sample if s.lower() in _BOOL_TEXT)
#     if bools / n >= threshold:
#         return "boolean"

#     # Datetime is more specific than date — try it first.
#     datetimes = sum(1 for s in sample if _DATETIME_RE.match(s))
#     if datetimes / n >= threshold:
#         return "datetime"
#     dates = sum(1 for s in sample if _DATE_RE.match(s))
#     if dates / n >= threshold:
#         return "date"

#     currency_shape = sum(1 for s in sample if _CURRENCY_RE.match(s))
#     pure_numbers = sum(1 for s in sample if _NUMBER_RE.match(s))
#     if currency_shape / n >= threshold:
#         if has_symbol or has_thousands_sep:
#             return "currency"
#         if pure_numbers / n >= threshold:
#             return "number"

#     return "text"


# def _infer_type(series: pl.Series) -> str:
#     """Classify a column for display + cleaning purposes.

#     Returns one of: ``text``, ``number``, ``date``, ``datetime``,
#     ``currency``, ``boolean``. These labels match the values the
#     frontend dropdown uses, so a user-supplied override is a string
#     swap rather than a value translation.
#     """
#     dtype = series.dtype
#     if dtype in _INT_DTYPES or dtype in _FLOAT_DTYPES:
#         return "number"
#     if dtype == pl.Boolean:
#         return "boolean"
#     if dtype == pl.Date:
#         return "date"
#     if dtype == pl.Datetime:
#         return "datetime"
#     return _sniff_text_column(series)


# def _pg_type(inferred: str) -> str:
#     return {
#         # New (UI-aligned) labels
#         "number":   "DOUBLE PRECISION",
#         "currency": "DOUBLE PRECISION",
#         "boolean":  "BOOLEAN",
#         "date":     "DATE",
#         "datetime": "TIMESTAMPTZ",
#         "text":     "TEXT",
#         # Backwards-compat: pre-Phase-3 datasets stored these in `columns` JSONB.
#         "integer":  "BIGINT",
#         "float":    "DOUBLE PRECISION",
#     }.get(inferred, "TEXT")


# def _normalise_df(df: pl.DataFrame) -> tuple[pl.DataFrame, list[dict]]:
#     """Rename columns to safe identifiers; return (new_df, column_meta)."""
#     rename_map: dict[str, str] = {}
#     seen: dict[str, int] = {}
#     for col in df.columns:
#         safe = _safe_col(col)
#         if safe in seen:
#             seen[safe] += 1
#             safe = f"{safe}_{seen[safe]}"
#         else:
#             seen[safe] = 0
#         rename_map[col] = safe  # always assigned, outside if/else

#     df = df.rename(rename_map)

#     def _is_native(s: pl.Series) -> bool:
#         """True when the polars dtype is already structured (not a string).
#         Used by `_create_table_and_insert` to decide whether to store the
#         column at its inferred postgres type (native) or keep it as TEXT
#         (sniffed from a string column — needs the cleaning step to convert)."""
#         return s.dtype not in (pl.String, pl.Utf8, pl.Object, pl.Null)

#     col_meta = [
#         {
#             "name": new,
#             "original_name": old,
#             "inferred_type": _infer_type(df[new]),
#             "native_dtype": _is_native(df[new]),
#             "null_pct": round(df[new].null_count() / max(len(df), 1) * 100, 1),
#         }
#         for old, new in rename_map.items()
#     ]
#     return df, col_meta


# async def _create_table_and_insert(
#     conn: asyncpg.Connection,
#     table_name: str,
#     df: pl.DataFrame,
#     col_meta: list[dict],
# ) -> None:
#     """CREATE TABLE then bulk-insert all rows via COPY.

#     Detected types like ``currency`` and ``date``/``datetime`` (when sniffed
#     from a string column) carry semantic meaning but the raw values are still
#     text on disk — e.g. ``₹1,234.56``. We can't insert those into a
#     DOUBLE PRECISION column directly. So during the initial ingestion we
#     store text-sniffed columns as TEXT and let the optional cleaning step
#     re-create the table with the proper type after parsing the values.
#     """

#     def _storage_type(meta: dict) -> str:
#         """How to physically store this column on disk during initial ingest."""
#         inferred = meta["inferred_type"]
#         # Native polars-typed columns can be stored at their inferred type.
#         # Sniffed-from-text classifications keep TEXT until cleaning runs —
#         # this prevents asyncpg copy errors when raw values contain currency
#         # symbols, commas, or other non-numeric characters.
#         is_native = meta.get("native_dtype", False)
#         if inferred in ("number", "currency", "date", "datetime") and not is_native:
#             return "TEXT"
#         return _pg_type(inferred)

#     col_defs = ", ".join(
#         f'"{m["name"]}" {_storage_type(m)}' for m in col_meta
#     )
#     await conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({col_defs})")

#     col_names = [m["name"] for m in col_meta]
#     rows: list[tuple[Any, ...]] = []
#     for row in df.to_dicts():
#         record = []
#         for m in col_meta:
#             val = row.get(m["name"])
#             inferred = m["inferred_type"]
#             is_native = m.get("native_dtype", False)
#             if val is None:
#                 record.append(None)
#             elif inferred == "boolean":
#                 if is_native:
#                     record.append(bool(val))
#                 else:
#                     record.append(str(val).strip().lower() in ("yes", "true", "1", "y", "t"))
#             elif inferred in ("number", "integer", "float") and is_native:
#                 try:
#                     record.append(float(val))
#                 except (ValueError, TypeError):
#                     record.append(None)
#             elif inferred in ("date", "datetime") and is_native:
#                 if isinstance(val, (date, datetime)):
#                     record.append(val)
#                 else:
#                     record.append(None)
#             else:
#                 record.append(str(val) if val is not None else None)
#         rows.append(tuple(record))

#     await conn.copy_records_to_table(
#         table_name.split(".")[-1],
#         records=rows,
#         columns=col_names,
#         schema_name="datasets",
#     )


# # ---------------------------------------------------------------------------
# # Format-specific parsers  →  polars DataFrame
# # ---------------------------------------------------------------------------


# def _parse_csv(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     warnings: list[str] = []
#     try:
#         df = pl.read_csv(
#             file_path, infer_schema_length=10000, ignore_errors=True
#         )
#     except Exception as e:
#         warnings.append(f"CSV parse warning: {e}")
#         df = pl.read_csv(file_path, infer_schema_length=0)
#     return df, warnings


# def _parse_xlsx(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """Parse an XLSX. Tries to preserve numeric/date types where openpyxl
#     already gave us python-native values, then falls back to text-mode
#     parsing if Polars chokes on mixed types within a column.
#     """
#     warnings: list[str] = []
#     try:
#         import openpyxl

#         wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
#         ws = wb.active
#         rows = list(ws.iter_rows(values_only=True))
#         wb.close()
#         if not rows:
#             return pl.DataFrame(), ["Empty workbook"]

#         headers = [
#             str(h).strip() if h is not None else f"col_{i}"
#             for i, h in enumerate(rows[0])
#         ]

#         # Try the rich path first: feed openpyxl's typed values to Polars
#         # column-by-column so ints/floats/dates stay native. This means
#         # `_infer_type` sees the real polars dtype for native columns and
#         # only falls back to text-sniffing where xlsx itself stored strings.
#         try:
#             data_rows = rows[1:]
#             cols: dict[str, list] = {h: [] for h in headers}
#             for row in data_rows:
#                 for i, cell in enumerate(row):
#                     cols[headers[i]].append(cell)
#             df = pl.DataFrame(cols, infer_schema_length=10000, strict=False)
#             return df, warnings
#         except Exception as e_native:
#             warnings.append(
#                 f"XLSX rich-type parse failed, falling back to text mode: {e_native}"
#             )
#             # Fallback: serialise everything as quoted CSV and re-parse with
#             # Polars in text-only mode, then let the sniffer do its best.
#             csv_lines = [",".join(f'"{c}"' for c in headers)]
#             for row in rows[1:]:
#                 vals = []
#                 for cell in row:
#                     if cell is None:
#                         vals.append("")
#                     else:
#                         s = str(cell).replace('"', '""')
#                         vals.append(f'"{s}"')
#                 csv_lines.append(",".join(vals))
#             csv_data = "\n".join(csv_lines)
#             df = pl.read_csv(
#                 io.StringIO(csv_data),
#                 infer_schema_length=10000,
#                 ignore_errors=True,
#             )
#     except Exception as e:
#         warnings.append(f"XLSX parse warning: {e}")
#         df = pl.read_excel(file_path, engine="openpyxl")
#     return df, warnings


# def _parse_pdf(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Extract tables from a digital (non-scanned) PDF using pdfplumber.
#     Merges all tables across all pages into one DataFrame.
#     Bank statements and Tally-exported PDFs work well here.
#     """
#     import pdfplumber

#     warnings: list[str] = []
#     all_rows: list[dict] = []
#     headers: list[str] = []

#     with pdfplumber.open(file_path) as pdf:
#         for page_num, page in enumerate(pdf.pages, 1):
#             tables = page.extract_tables()
#             for tbl in tables:
#                 if not tbl:
#                     continue
#                 if not headers:
#                     # First table header becomes the column names
#                     headers = [
#                         str(h).strip() if h else f"col_{i}"
#                         for i, h in enumerate(tbl[0])
#                     ]
#                     data_start = 1
#                 else:
#                     data_start = 0
#                     # If this page table has same column count, use it
#                     if len(tbl[0]) != len(headers):
#                         warnings.append(
#                             f"Page {page_num}: table column count mismatch, skipping"
#                         )
#                         continue

#                 for row in tbl[data_start:]:
#                     if all(
#                         cell is None or str(cell).strip() == "" for cell in row
#                     ):
#                         continue
#                     all_rows.append(
#                         {
#                             headers[i]: (
#                                 str(cell).strip() if cell is not None else None
#                             )
#                             for i, cell in enumerate(row)
#                         }
#                     )

#     if not all_rows:
#         warnings.append(
#             "No tables found in PDF — the PDF may be scanned or have no extractable tables"
#         )
#         return pl.DataFrame(), warnings

#     df = pl.from_dicts(all_rows)
#     return df, warnings


# def _parse_tally_xml(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Parse Tally Prime / Tally ERP 9 XML exports.

#     Tally XML follows this structure:
#       <ENVELOPE>
#         <BODY>
#           <EXPORTDATA>
#             <REQUESTDATA>
#               <TALLYMESSAGE>
#                 <VOUCHER>   (or LEDGER / STOCKITEM etc.)
#                   <DATE>...</DATE>
#                   <PARTYLEDGERNAME>...</PARTYLEDGERNAME>
#                   ...
#                 </VOUCHER>
#               </TALLYMESSAGE>

#     We discover the repeating element automatically and flatten
#     its direct children + first-level sub-elements into columns.
#     """
#     from lxml import etree

#     warnings: list[str] = []

#     tree = etree.parse(file_path)
#     root = tree.getroot()

#     # Find TALLYMESSAGE nodes (standard Tally export wrapper)
#     messages = root.findall(".//TALLYMESSAGE")
#     if not messages:
#         warnings.append(
#             "No <TALLYMESSAGE> elements found — treating whole XML as flat records"
#         )
#         messages = [root]

#     rows: list[dict] = []
#     for msg in messages:
#         for child in msg:
#             record: dict[str, Any] = {"_element": child.tag}
#             for elem in child:
#                 # Flatten one level deep; skip nested lists
#                 if len(elem) == 0:
#                     record[elem.tag] = (elem.text or "").strip()
#                 else:
#                     # Nested element: join child text
#                     record[elem.tag] = " | ".join(
#                         (e.text or "").strip() for e in elem if e.text
#                     )
#             if len(record) > 1:  # skip empty records
#                 rows.append(record)

#     if not rows:
#         return pl.DataFrame(), ["No data rows parsed from XML"]

#     df = pl.from_dicts(rows, infer_schema_length=len(rows))
#     return df, warnings


# # ---------------------------------------------------------------------------
# # Public entry points
# # ---------------------------------------------------------------------------


# async def ingest_dataframe(
#     conn: asyncpg.Connection,
#     df: pl.DataFrame,
# ) -> dict:
#     """Ingest a pre-built Polars DataFrame into a new datasets table."""
#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": ["DataFrame is empty"],
#             "pii_detected": False,
#             "pii_summary": None,
#         }

#     df, col_meta = _normalise_df(df)
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan (CPU-bound, runs in executor if called from async context)
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": [],
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }


# async def ingest_file(
#     conn: asyncpg.Connection,
#     file_path: str,
#     file_type: str,
# ) -> dict:
#     """
#     Parse *file_path* according to *file_type* and load it into a new
#     PostgreSQL table.  Returns metadata dict.
#     """
#     # 1. Parse to DataFrame
#     parsers = {
#         "csv": _parse_csv,
#         "xlsx": _parse_xlsx,
#         "pdf": _parse_pdf,
#         "xml": _parse_tally_xml,
#     }
#     if file_type not in parsers:
#         raise ValueError(f"Unsupported file type: {file_type}")

#     # Parsing (Polars CSV/XLSX read) is CPU-bound — run in thread to free event loop
#     loop = asyncio.get_event_loop()
#     df, warnings = await loop.run_in_executor(
#         None, parsers[file_type], file_path
#     )

#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": warnings or ["File produced no data rows"],
#         }

#     # 2. Normalise column names (CPU-bound)
#     df, col_meta = await loop.run_in_executor(None, _normalise_df, df)

#     # 3. Choose table name  datasets.ds_<hex>
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"

#     # 4. Create table + insert
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": warnings,
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }






# # app/ingestion.py
# """
# File ingestion: CSV / XLSX / PDF / Tally XML  →  PostgreSQL table.

# Each uploaded file gets its own table in the `datasets` schema
# (named  datasets.ds_<uuid_hex>).  Column names are normalised
# (lower-cased, spaces replaced with underscores) so they are
# always valid SQL identifiers.

# Returns a dict with:
#   table_name      str  – fully-qualified table name
#   row_count       int
#   columns         list[dict]  – [{name, inferred_type}]
#   warnings        list[str]   – non-fatal parse notes
# """

# from __future__ import annotations

# import asyncio
# import re
# import io
# import json
# import os
# import uuid
# from datetime import date, datetime
# from typing import Any

# import asyncpg
# import polars as pl


# # ---------------------------------------------------------------------------
# # Helpers
# # ---------------------------------------------------------------------------


# def _safe_col(name: str) -> str:
#     """Normalise a column name to a safe SQL identifier."""
#     name = str(name).strip().lower()
#     name = re.sub(r"[^a-z0-9_]", "_", name)
#     name = re.sub(r"_+", "_", name).strip("_")
#     if not name or name[0].isdigit():
#         name = "col_" + name
#     return name


# _INT_DTYPES = (
#     pl.Int8, pl.Int16, pl.Int32, pl.Int64,
#     pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
# )
# _FLOAT_DTYPES = (pl.Float32, pl.Float64)

# # Pre-compiled regexes — the column may have hundreds of values to scan.
# _DATE_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}$"               # ISO 2024-04-01
#     r"|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$"  # 01/04/24, 01-04-2024
#     r"|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}$"  # 01 Apr 2024
#     r"|^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4}$"  # Apr 1, 2024
# )
# _DATETIME_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?$"
# )
# _NUMBER_RE   = re.compile(r"^-?\d+(\.\d+)?$")
# _CURRENCY_RE = re.compile(r"^[₹$£€]?\s*-?\d{1,3}(,\d{2,3})*(\.\d+)?$|^-?\d+(\.\d+)?$|^-+$")
# _BOOL_TEXT   = {"true", "false", "yes", "no", "y", "n", "t", "f"}


# def _sniff_text_column(series: pl.Series) -> str:
#     """Sample up to 200 non-null trimmed string values and try to detect a
#     semantic type. Returns one of the same labels as `_infer_type`."""
#     try:
#         raw = series.drop_nulls().cast(pl.String).head(200).to_list()
#     except Exception:
#         return "text"
#     sample = [s.strip() for s in raw if s is not None and str(s).strip()]
#     if not sample:
#         return "text"
#     n = len(sample)
#     # ≥ 85% of sampled values must match for a confident classification.
#     threshold = 0.85

#     has_symbol = any(any(c in s for c in "₹$£€") for s in sample)
#     has_thousands_sep = any(re.search(r"\d,\d", s) for s in sample)

#     # Booleans only via text variants — don't claim 0/1 columns are bool, those
#     # could just as well be flag-encoded numbers.
#     bools = sum(1 for s in sample if s.lower() in _BOOL_TEXT)
#     if bools / n >= threshold:
#         return "boolean"

#     # Datetime is more specific than date — try it first.
#     datetimes = sum(1 for s in sample if _DATETIME_RE.match(s))
#     if datetimes / n >= threshold:
#         return "datetime"
#     dates = sum(1 for s in sample if _DATE_RE.match(s))
#     if dates / n >= threshold:
#         return "date"

#     currency_shape = sum(1 for s in sample if _CURRENCY_RE.match(s))
#     pure_numbers = sum(1 for s in sample if _NUMBER_RE.match(s))
#     if currency_shape / n >= threshold:
#         if has_symbol or has_thousands_sep:
#             return "currency"
#         if pure_numbers / n >= threshold:
#             return "number"

#     return "text"


# def _infer_type(series: pl.Series) -> str:
#     """Classify a column for display + cleaning purposes.

#     Returns one of: ``text``, ``number``, ``date``, ``datetime``,
#     ``currency``, ``boolean``. These labels match the values the
#     frontend dropdown uses, so a user-supplied override is a string
#     swap rather than a value translation.
#     """
#     dtype = series.dtype
#     if dtype in _INT_DTYPES or dtype in _FLOAT_DTYPES:
#         return "number"
#     if dtype == pl.Boolean:
#         return "boolean"
#     if dtype == pl.Date:
#         return "date"
#     if dtype == pl.Datetime:
#         return "datetime"
#     return _sniff_text_column(series)


# def _pg_type(inferred: str) -> str:
#     return {
#         # New (UI-aligned) labels
#         "number":   "DOUBLE PRECISION",
#         "currency": "DOUBLE PRECISION",
#         "boolean":  "BOOLEAN",
#         "date":     "DATE",
#         "datetime": "TIMESTAMPTZ",
#         "text":     "TEXT",
#         # Backwards-compat: pre-Phase-3 datasets stored these in `columns` JSONB.
#         "integer":  "BIGINT",
#         "float":    "DOUBLE PRECISION",
#     }.get(inferred, "TEXT")


# def _normalise_df(df: pl.DataFrame) -> tuple[pl.DataFrame, list[dict]]:
#     """Rename columns to safe identifiers; return (new_df, column_meta)."""
#     rename_map: dict[str, str] = {}
#     seen: dict[str, int] = {}
#     for col in df.columns:
#         safe = _safe_col(col)
#         if safe in seen:
#             seen[safe] += 1
#             safe = f"{safe}_{seen[safe]}"
#         else:
#             seen[safe] = 0
#         rename_map[col] = safe  # always assigned, outside if/else

#     df = df.rename(rename_map)

#     def _is_native(s: pl.Series) -> bool:
#         """True when the polars dtype is already structured (not a string).
#         Used by `_create_table_and_insert` to decide whether to store the
#         column at its inferred postgres type (native) or keep it as TEXT
#         (sniffed from a string column — needs the cleaning step to convert)."""
#         return s.dtype not in (pl.String, pl.Utf8, pl.Object, pl.Null)

#     col_meta = [
#         {
#             "name": new,
#             "original_name": old,
#             "inferred_type": _infer_type(df[new]),
#             "native_dtype": _is_native(df[new]),
#         }
#         for old, new in rename_map.items()
#     ]
#     return df, col_meta


# async def _create_table_and_insert(
#     conn: asyncpg.Connection,
#     table_name: str,
#     df: pl.DataFrame,
#     col_meta: list[dict],
# ) -> None:
#     """CREATE TABLE then bulk-insert all rows via COPY.

#     Detected types like ``currency`` and ``date``/``datetime`` (when sniffed
#     from a string column) carry semantic meaning but the raw values are still
#     text on disk — e.g. ``₹1,234.56``. We can't insert those into a
#     DOUBLE PRECISION column directly. So during the initial ingestion we
#     store text-sniffed columns as TEXT and let the optional cleaning step
#     re-create the table with the proper type after parsing the values.
#     """

#     def _storage_type(meta: dict) -> str:
#         """How to physically store this column on disk during initial ingest."""
#         inferred = meta["inferred_type"]
#         # Native polars-typed columns can be stored at their inferred type.
#         # Sniffed-from-text classifications keep TEXT until cleaning runs —
#         # this prevents asyncpg copy errors when raw values contain currency
#         # symbols, commas, or other non-numeric characters.
#         is_native = meta.get("native_dtype", False)
#         if inferred in ("number", "currency", "date", "datetime") and not is_native:
#             return "TEXT"
#         return _pg_type(inferred)

#     col_defs = ", ".join(
#         f'"{m["name"]}" {_storage_type(m)}' for m in col_meta
#     )
#     await conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({col_defs})")

#     col_names = [m["name"] for m in col_meta]
#     rows: list[tuple[Any, ...]] = []
#     for row in df.to_dicts():
#         record = []
#         for m in col_meta:
#             val = row.get(m["name"])
#             inferred = m["inferred_type"]
#             is_native = m.get("native_dtype", False)
#             if val is None:
#                 record.append(None)
#             elif inferred == "boolean":
#                 if is_native:
#                     record.append(bool(val))
#                 else:
#                     record.append(str(val).strip().lower() in ("yes", "true", "1", "y", "t"))
#             elif inferred in ("number", "integer", "float") and is_native:
#                 try:
#                     record.append(float(val))
#                 except (ValueError, TypeError):
#                     record.append(None)
#             elif inferred in ("date", "datetime") and is_native:
#                 if isinstance(val, (date, datetime)):
#                     record.append(val)
#                 else:
#                     record.append(None)
#             else:
#                 record.append(str(val) if val is not None else None)
#         rows.append(tuple(record))

#     await conn.copy_records_to_table(
#         table_name.split(".")[-1],
#         records=rows,
#         columns=col_names,
#         schema_name="datasets",
#     )


# # ---------------------------------------------------------------------------
# # Format-specific parsers  →  polars DataFrame
# # ---------------------------------------------------------------------------


# def _parse_csv(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     warnings: list[str] = []
#     try:
#         df = pl.read_csv(
#             file_path, infer_schema_length=10000, ignore_errors=True
#         )
#     except Exception as e:
#         warnings.append(f"CSV parse warning: {e}")
#         df = pl.read_csv(file_path, infer_schema_length=0)
#     return df, warnings


# def _parse_xlsx(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """Parse an XLSX. Tries to preserve numeric/date types where openpyxl
#     already gave us python-native values, then falls back to text-mode
#     parsing if Polars chokes on mixed types within a column.
#     """
#     warnings: list[str] = []
#     try:
#         import openpyxl

#         wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
#         ws = wb.active
#         rows = list(ws.iter_rows(values_only=True))
#         wb.close()
#         if not rows:
#             return pl.DataFrame(), ["Empty workbook"]

#         headers = [
#             str(h).strip() if h is not None else f"col_{i}"
#             for i, h in enumerate(rows[0])
#         ]

#         # Try the rich path first: feed openpyxl's typed values to Polars
#         # column-by-column so ints/floats/dates stay native. This means
#         # `_infer_type` sees the real polars dtype for native columns and
#         # only falls back to text-sniffing where xlsx itself stored strings.
#         try:
#             data_rows = rows[1:]
#             cols: dict[str, list] = {h: [] for h in headers}
#             for row in data_rows:
#                 for i, cell in enumerate(row):
#                     cols[headers[i]].append(cell)
#             df = pl.DataFrame(cols, infer_schema_length=10000, strict=False)
#             return df, warnings
#         except Exception as e_native:
#             warnings.append(
#                 f"XLSX rich-type parse failed, falling back to text mode: {e_native}"
#             )
#             # Fallback: serialise everything as quoted CSV and re-parse with
#             # Polars in text-only mode, then let the sniffer do its best.
#             csv_lines = [",".join(f'"{c}"' for c in headers)]
#             for row in rows[1:]:
#                 vals = []
#                 for cell in row:
#                     if cell is None:
#                         vals.append("")
#                     else:
#                         s = str(cell).replace('"', '""')
#                         vals.append(f'"{s}"')
#                 csv_lines.append(",".join(vals))
#             csv_data = "\n".join(csv_lines)
#             df = pl.read_csv(
#                 io.StringIO(csv_data),
#                 infer_schema_length=10000,
#                 ignore_errors=True,
#             )
#     except Exception as e:
#         warnings.append(f"XLSX parse warning: {e}")
#         df = pl.read_excel(file_path, engine="openpyxl")
#     return df, warnings


# def _parse_pdf(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Extract tables from a digital (non-scanned) PDF using pdfplumber.
#     Merges all tables across all pages into one DataFrame.
#     Bank statements and Tally-exported PDFs work well here.
#     """
#     import pdfplumber

#     warnings: list[str] = []
#     all_rows: list[dict] = []
#     headers: list[str] = []

#     with pdfplumber.open(file_path) as pdf:
#         for page_num, page in enumerate(pdf.pages, 1):
#             tables = page.extract_tables()
#             for tbl in tables:
#                 if not tbl:
#                     continue
#                 if not headers:
#                     # First table header becomes the column names
#                     headers = [
#                         str(h).strip() if h else f"col_{i}"
#                         for i, h in enumerate(tbl[0])
#                     ]
#                     data_start = 1
#                 else:
#                     data_start = 0
#                     # If this page table has same column count, use it
#                     if len(tbl[0]) != len(headers):
#                         warnings.append(
#                             f"Page {page_num}: table column count mismatch, skipping"
#                         )
#                         continue

#                 for row in tbl[data_start:]:
#                     if all(
#                         cell is None or str(cell).strip() == "" for cell in row
#                     ):
#                         continue
#                     all_rows.append(
#                         {
#                             headers[i]: (
#                                 str(cell).strip() if cell is not None else None
#                             )
#                             for i, cell in enumerate(row)
#                         }
#                     )

#     if not all_rows:
#         warnings.append(
#             "No tables found in PDF — the PDF may be scanned or have no extractable tables"
#         )
#         return pl.DataFrame(), warnings

#     df = pl.from_dicts(all_rows)
#     return df, warnings


# def _parse_tally_xml(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Parse Tally Prime / Tally ERP 9 XML exports.

#     Tally XML follows this structure:
#       <ENVELOPE>
#         <BODY>
#           <EXPORTDATA>
#             <REQUESTDATA>
#               <TALLYMESSAGE>
#                 <VOUCHER>   (or LEDGER / STOCKITEM etc.)
#                   <DATE>...</DATE>
#                   <PARTYLEDGERNAME>...</PARTYLEDGERNAME>
#                   ...
#                 </VOUCHER>
#               </TALLYMESSAGE>

#     We discover the repeating element automatically and flatten
#     its direct children + first-level sub-elements into columns.
#     """
#     from lxml import etree

#     warnings: list[str] = []

#     tree = etree.parse(file_path)
#     root = tree.getroot()

#     # Find TALLYMESSAGE nodes (standard Tally export wrapper)
#     messages = root.findall(".//TALLYMESSAGE")
#     if not messages:
#         warnings.append(
#             "No <TALLYMESSAGE> elements found — treating whole XML as flat records"
#         )
#         messages = [root]

#     rows: list[dict] = []
#     for msg in messages:
#         for child in msg:
#             record: dict[str, Any] = {"_element": child.tag}
#             for elem in child:
#                 # Flatten one level deep; skip nested lists
#                 if len(elem) == 0:
#                     record[elem.tag] = (elem.text or "").strip()
#                 else:
#                     # Nested element: join child text
#                     record[elem.tag] = " | ".join(
#                         (e.text or "").strip() for e in elem if e.text
#                     )
#             if len(record) > 1:  # skip empty records
#                 rows.append(record)

#     if not rows:
#         return pl.DataFrame(), ["No data rows parsed from XML"]

#     df = pl.from_dicts(rows, infer_schema_length=len(rows))
#     return df, warnings


# # ---------------------------------------------------------------------------
# # Public entry points
# # ---------------------------------------------------------------------------


# async def ingest_dataframe(
#     conn: asyncpg.Connection,
#     df: pl.DataFrame,
# ) -> dict:
#     """Ingest a pre-built Polars DataFrame into a new datasets table."""
#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": ["DataFrame is empty"],
#             "pii_detected": False,
#             "pii_summary": None,
#         }

#     df, col_meta = _normalise_df(df)
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan (CPU-bound, runs in executor if called from async context)
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": [],
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }


# async def ingest_file(
#     conn: asyncpg.Connection,
#     file_path: str,
#     file_type: str,
# ) -> dict:
#     """
#     Parse *file_path* according to *file_type* and load it into a new
#     PostgreSQL table.  Returns metadata dict.
#     """
#     # 1. Parse to DataFrame
#     parsers = {
#         "csv": _parse_csv,
#         "xlsx": _parse_xlsx,
#         "pdf": _parse_pdf,
#         "xml": _parse_tally_xml,
#     }
#     if file_type not in parsers:
#         raise ValueError(f"Unsupported file type: {file_type}")

#     # Parsing (Polars CSV/XLSX read) is CPU-bound — run in thread to free event loop
#     loop = asyncio.get_event_loop()
#     df, warnings = await loop.run_in_executor(
#         None, parsers[file_type], file_path
#     )

#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": warnings or ["File produced no data rows"],
#         }

#     # 2. Normalise column names (CPU-bound)
#     df, col_meta = await loop.run_in_executor(None, _normalise_df, df)

#     # 3. Choose table name  datasets.ds_<hex>
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"

#     # 4. Create table + insert
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": warnings,
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }


# app/ingestion.py
# # app/ingestion.py
# """
# File ingestion: CSV / XLSX / PDF / Tally XML  →  PostgreSQL table.

# Each uploaded file gets its own table in the `datasets` schema
# (named  datasets.ds_<uuid_hex>).  Column names are normalised
# (lower-cased, spaces replaced with underscores) so they are
# always valid SQL identifiers.

# Returns a dict with:
#   table_name      str  – fully-qualified table name
#   row_count       int
#   columns         list[dict]  – [{name, inferred_type}]
#   warnings        list[str]   – non-fatal parse notes
# """

# from __future__ import annotations

# import asyncio
# import re
# import io
# import json
# import os
# import uuid
# from datetime import date, datetime
# from typing import Any

# import asyncpg
# import polars as pl


# # ---------------------------------------------------------------------------
# # Helpers
# # ---------------------------------------------------------------------------


# def _safe_col(name: str) -> str:
#     """Normalise a column name to a safe SQL identifier."""
#     name = str(name).strip().lower()
#     name = re.sub(r"[^a-z0-9_]", "_", name)
#     name = re.sub(r"_+", "_", name).strip("_")
#     if not name or name[0].isdigit():
#         name = "col_" + name
#     return name


# _INT_DTYPES = (
#     pl.Int8, pl.Int16, pl.Int32, pl.Int64,
#     pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
# )
# _FLOAT_DTYPES = (pl.Float32, pl.Float64)

# # Pre-compiled regexes — the column may have hundreds of values to scan.
# _DATE_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}$"               # ISO 2024-04-01
#     r"|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$"  # 01/04/24, 01-04-2024
#     r"|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}$"  # 01 Apr 2024
#     r"|^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4}$"  # Apr 1, 2024
# )
# _DATETIME_RE = re.compile(
#     r"^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?$"
# )
# _NUMBER_RE   = re.compile(r"^-?\d+(\.\d+)?$")
# _CURRENCY_RE = re.compile(r"^[₹$£€]?\s*-?\d{1,3}(,\d{2,3})*(\.\d+)?$|^-?\d+(\.\d+)?$|^-+$")
# _BOOL_TEXT   = {"true", "false", "yes", "no", "y", "n", "t", "f"}


# def _sniff_text_column(series: pl.Series) -> str:
#     """Sample up to 200 non-null trimmed string values and try to detect a
#     semantic type. Returns one of the same labels as `_infer_type`."""
#     try:
#         raw = series.drop_nulls().cast(pl.String).head(200).to_list()
#     except Exception:
#         return "text"
#     sample = [s.strip() for s in raw if s is not None and str(s).strip()]
#     if not sample:
#         return "text"
#     n = len(sample)
#     # ≥ 85% of sampled values must match for a confident classification.
#     threshold = 0.85

#     has_symbol = any(any(c in s for c in "₹$£€") for s in sample)
#     has_thousands_sep = any(re.search(r"\d,\d", s) for s in sample)

#     # Booleans only via text variants — don't claim 0/1 columns are bool, those
#     # could just as well be flag-encoded numbers.
#     bools = sum(1 for s in sample if s.lower() in _BOOL_TEXT)
#     if bools / n >= threshold:
#         return "boolean"

#     # Datetime is more specific than date — try it first.
#     datetimes = sum(1 for s in sample if _DATETIME_RE.match(s))
#     if datetimes / n >= threshold:
#         return "datetime"
#     dates = sum(1 for s in sample if _DATE_RE.match(s))
#     if dates / n >= threshold:
#         return "date"

#     currency_shape = sum(1 for s in sample if _CURRENCY_RE.match(s))
#     pure_numbers = sum(1 for s in sample if _NUMBER_RE.match(s))
#     if currency_shape / n >= threshold:
#         if has_symbol or has_thousands_sep:
#             return "currency"
#         if pure_numbers / n >= threshold:
#             return "number"

#     return "text"


# def _infer_type(series: pl.Series) -> str:
#     """Classify a column for display + cleaning purposes.

#     Returns one of: ``text``, ``number``, ``date``, ``datetime``,
#     ``currency``, ``boolean``. These labels match the values the
#     frontend dropdown uses, so a user-supplied override is a string
#     swap rather than a value translation.
#     """
#     dtype = series.dtype
#     if dtype in _INT_DTYPES or dtype in _FLOAT_DTYPES:
#         return "number"
#     if dtype == pl.Boolean:
#         return "boolean"
#     if dtype == pl.Date:
#         return "date"
#     if dtype == pl.Datetime:
#         return "datetime"
#     return _sniff_text_column(series)


# def _pg_type(inferred: str) -> str:
#     return {
#         # New (UI-aligned) labels
#         "number":   "DOUBLE PRECISION",
#         "currency": "DOUBLE PRECISION",
#         "boolean":  "BOOLEAN",
#         "date":     "DATE",
#         "datetime": "TIMESTAMPTZ",
#         "text":     "TEXT",
#         # Backwards-compat: pre-Phase-3 datasets stored these in `columns` JSONB.
#         "integer":  "BIGINT",
#         "float":    "DOUBLE PRECISION",
#     }.get(inferred, "TEXT")


# def _normalise_df(df: pl.DataFrame) -> tuple[pl.DataFrame, list[dict]]:
#     """Rename columns to safe identifiers; return (new_df, column_meta)."""
#     rename_map: dict[str, str] = {}
#     seen: dict[str, int] = {}
#     for col in df.columns:
#         safe = _safe_col(col)
#         if safe in seen:
#             seen[safe] += 1
#             safe = f"{safe}_{seen[safe]}"
#         else:
#             seen[safe] = 0
#         rename_map[col] = safe  # always assigned, outside if/else

#     df = df.rename(rename_map)

#     def _is_native(s: pl.Series) -> bool:
#         """True when the polars dtype is already structured (not a string).
#         Used by `_create_table_and_insert` to decide whether to store the
#         column at its inferred postgres type (native) or keep it as TEXT
#         (sniffed from a string column — needs the cleaning step to convert)."""
#         return s.dtype not in (pl.String, pl.Utf8, pl.Object, pl.Null)

#     col_meta = [
#         {
#             "name": new,
#             "original_name": old,
#             "inferred_type": _infer_type(df[new]),
#             "native_dtype": _is_native(df[new]),
#         }
#         for old, new in rename_map.items()
#     ]
#     return df, col_meta


# async def _create_table_and_insert(
#     conn: asyncpg.Connection,
#     table_name: str,
#     df: pl.DataFrame,
#     col_meta: list[dict],
# ) -> None:
#     """CREATE TABLE then bulk-insert all rows via COPY.

#     Detected types like ``currency`` and ``date``/``datetime`` (when sniffed
#     from a string column) carry semantic meaning but the raw values are still
#     text on disk — e.g. ``₹1,234.56``. We can't insert those into a
#     DOUBLE PRECISION column directly. So during the initial ingestion we
#     store text-sniffed columns as TEXT and let the optional cleaning step
#     re-create the table with the proper type after parsing the values.
#     """

#     def _storage_type(meta: dict) -> str:
#         """How to physically store this column on disk during initial ingest."""
#         inferred = meta["inferred_type"]
#         # Native polars-typed columns can be stored at their inferred type.
#         # Sniffed-from-text classifications keep TEXT until cleaning runs —
#         # this prevents asyncpg copy errors when raw values contain currency
#         # symbols, commas, or other non-numeric characters.
#         is_native = meta.get("native_dtype", False)
#         if inferred in ("number", "currency", "date", "datetime") and not is_native:
#             return "TEXT"
#         return _pg_type(inferred)

#     col_defs = ", ".join(
#         f'"{m["name"]}" {_storage_type(m)}' for m in col_meta
#     )
#     await conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({col_defs})")

#     col_names = [m["name"] for m in col_meta]
#     rows: list[tuple[Any, ...]] = []
#     for row in df.to_dicts():
#         record = []
#         for m in col_meta:
#             val = row.get(m["name"])
#             inferred = m["inferred_type"]
#             is_native = m.get("native_dtype", False)
#             if val is None:
#                 record.append(None)
#             elif inferred == "boolean":
#                 if is_native:
#                     record.append(bool(val))
#                 else:
#                     record.append(str(val).strip().lower() in ("yes", "true", "1", "y", "t"))
#             elif inferred in ("number", "integer", "float") and is_native:
#                 try:
#                     record.append(float(val))
#                 except (ValueError, TypeError):
#                     record.append(None)
#             elif inferred in ("date", "datetime") and is_native:
#                 if isinstance(val, (date, datetime)):
#                     record.append(val)
#                 else:
#                     record.append(None)
#             else:
#                 record.append(str(val) if val is not None else None)
#         rows.append(tuple(record))

#     await conn.copy_records_to_table(
#         table_name.split(".")[-1],
#         records=rows,
#         columns=col_names,
#         schema_name="datasets",
#     )


# # ---------------------------------------------------------------------------
# # Format-specific parsers  →  polars DataFrame
# # ---------------------------------------------------------------------------


# def _parse_csv(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     warnings: list[str] = []
#     try:
#         df = pl.read_csv(
#             file_path, infer_schema_length=10000, ignore_errors=True
#         )
#     except Exception as e:
#         warnings.append(f"CSV parse warning: {e}")
#         df = pl.read_csv(file_path, infer_schema_length=0)
#     return df, warnings


# def _parse_xlsx(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """Parse an XLSX. Tries to preserve numeric/date types where openpyxl
#     already gave us python-native values, then falls back to text-mode
#     parsing if Polars chokes on mixed types within a column.
#     """
#     warnings: list[str] = []
#     try:
#         import openpyxl

#         wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
#         ws = wb.active
#         rows = list(ws.iter_rows(values_only=True))
#         wb.close()
#         if not rows:
#             return pl.DataFrame(), ["Empty workbook"]

#         headers = [
#             str(h).strip() if h is not None else f"col_{i}"
#             for i, h in enumerate(rows[0])
#         ]

#         # Try the rich path first: feed openpyxl's typed values to Polars
#         # column-by-column so ints/floats/dates stay native. This means
#         # `_infer_type` sees the real polars dtype for native columns and
#         # only falls back to text-sniffing where xlsx itself stored strings.
#         try:
#             data_rows = rows[1:]
#             cols: dict[str, list] = {h: [] for h in headers}
#             for row in data_rows:
#                 for i, cell in enumerate(row):
#                     cols[headers[i]].append(cell)
#             df = pl.DataFrame(cols, infer_schema_length=10000, strict=False)
#             return df, warnings
#         except Exception as e_native:
#             warnings.append(
#                 f"XLSX rich-type parse failed, falling back to text mode: {e_native}"
#             )
#             # Fallback: serialise everything as quoted CSV and re-parse with
#             # Polars in text-only mode, then let the sniffer do its best.
#             csv_lines = [",".join(f'"{c}"' for c in headers)]
#             for row in rows[1:]:
#                 vals = []
#                 for cell in row:
#                     if cell is None:
#                         vals.append("")
#                     else:
#                         s = str(cell).replace('"', '""')
#                         vals.append(f'"{s}"')
#                 csv_lines.append(",".join(vals))
#             csv_data = "\n".join(csv_lines)
#             df = pl.read_csv(
#                 io.StringIO(csv_data),
#                 infer_schema_length=10000,
#                 ignore_errors=True,
#             )
#     except Exception as e:
#         warnings.append(f"XLSX parse warning: {e}")
#         df = pl.read_excel(file_path, engine="openpyxl")
#     return df, warnings


# def _parse_pdf(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Extract tables from a digital (non-scanned) PDF using pdfplumber.
#     Merges all tables across all pages into one DataFrame.
#     Bank statements and Tally-exported PDFs work well here.
#     """
#     import pdfplumber

#     warnings: list[str] = []
#     all_rows: list[dict] = []
#     headers: list[str] = []

#     with pdfplumber.open(file_path) as pdf:
#         for page_num, page in enumerate(pdf.pages, 1):
#             tables = page.extract_tables()
#             for tbl in tables:
#                 if not tbl:
#                     continue
#                 if not headers:
#                     # First table header becomes the column names
#                     headers = [
#                         str(h).strip() if h else f"col_{i}"
#                         for i, h in enumerate(tbl[0])
#                     ]
#                     data_start = 1
#                 else:
#                     data_start = 0
#                     # If this page table has same column count, use it
#                     if len(tbl[0]) != len(headers):
#                         warnings.append(
#                             f"Page {page_num}: table column count mismatch, skipping"
#                         )
#                         continue

#                 for row in tbl[data_start:]:
#                     if all(
#                         cell is None or str(cell).strip() == "" for cell in row
#                     ):
#                         continue
#                     all_rows.append(
#                         {
#                             headers[i]: (
#                                 str(cell).strip() if cell is not None else None
#                             )
#                             for i, cell in enumerate(row)
#                         }
#                     )

#     if not all_rows:
#         warnings.append(
#             "No tables found in PDF — the PDF may be scanned or have no extractable tables"
#         )
#         return pl.DataFrame(), warnings

#     df = pl.from_dicts(all_rows)
#     return df, warnings


# def _parse_tally_xml(file_path: str) -> tuple[pl.DataFrame, list[str]]:
#     """
#     Parse Tally Prime / Tally ERP 9 XML exports.

#     Tally XML follows this structure:
#       <ENVELOPE>
#         <BODY>
#           <EXPORTDATA>
#             <REQUESTDATA>
#               <TALLYMESSAGE>
#                 <VOUCHER>   (or LEDGER / STOCKITEM etc.)
#                   <DATE>...</DATE>
#                   <PARTYLEDGERNAME>...</PARTYLEDGERNAME>
#                   ...
#                 </VOUCHER>
#               </TALLYMESSAGE>

#     We discover the repeating element automatically and flatten
#     its direct children + first-level sub-elements into columns.
#     """
#     from lxml import etree

#     warnings: list[str] = []

#     tree = etree.parse(file_path)
#     root = tree.getroot()

#     # Find TALLYMESSAGE nodes (standard Tally export wrapper)
#     messages = root.findall(".//TALLYMESSAGE")
#     if not messages:
#         warnings.append(
#             "No <TALLYMESSAGE> elements found — treating whole XML as flat records"
#         )
#         messages = [root]

#     rows: list[dict] = []
#     for msg in messages:
#         for child in msg:
#             record: dict[str, Any] = {"_element": child.tag}
#             for elem in child:
#                 # Flatten one level deep; skip nested lists
#                 if len(elem) == 0:
#                     record[elem.tag] = (elem.text or "").strip()
#                 else:
#                     # Nested element: join child text
#                     record[elem.tag] = " | ".join(
#                         (e.text or "").strip() for e in elem if e.text
#                     )
#             if len(record) > 1:  # skip empty records
#                 rows.append(record)

#     if not rows:
#         return pl.DataFrame(), ["No data rows parsed from XML"]

#     df = pl.from_dicts(rows, infer_schema_length=len(rows))
#     return df, warnings


# # ---------------------------------------------------------------------------
# # Public entry points
# # ---------------------------------------------------------------------------


# async def ingest_dataframe(
#     conn: asyncpg.Connection,
#     df: pl.DataFrame,
# ) -> dict:
#     """Ingest a pre-built Polars DataFrame into a new datasets table."""
#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": ["DataFrame is empty"],
#             "pii_detected": False,
#             "pii_summary": None,
#         }

#     df, col_meta = _normalise_df(df)
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan (CPU-bound, runs in executor if called from async context)
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": [],
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }


# async def ingest_file(
#     conn: asyncpg.Connection,
#     file_path: str,
#     file_type: str,
# ) -> dict:
#     """
#     Parse *file_path* according to *file_type* and load it into a new
#     PostgreSQL table.  Returns metadata dict.
#     """
#     # 1. Parse to DataFrame
#     parsers = {
#         "csv": _parse_csv,
#         "xlsx": _parse_xlsx,
#         "pdf": _parse_pdf,
#         "xml": _parse_tally_xml,
#     }
#     if file_type not in parsers:
#         raise ValueError(f"Unsupported file type: {file_type}")

#     # Parsing (Polars CSV/XLSX read) is CPU-bound — run in thread to free event loop
#     loop = asyncio.get_event_loop()
#     df, warnings = await loop.run_in_executor(
#         None, parsers[file_type], file_path
#     )

#     if df.is_empty():
#         return {
#             "table_name": None,
#             "row_count": 0,
#             "columns": [],
#             "warnings": warnings or ["File produced no data rows"],
#         }

#     # 2. Normalise column names (CPU-bound)
#     df, col_meta = await loop.run_in_executor(None, _normalise_df, df)

#     # 3. Choose table name  datasets.ds_<hex>
#     table_id = uuid.uuid4().hex
#     table_name = f"datasets.ds_{table_id}"

#     # 4. Create table + insert
#     await _create_table_and_insert(conn, table_name, df, col_meta)

#     # PII scan
#     from app.pii_detector import scan_dataframe
#     pii_result = scan_dataframe(df)

#     return {
#         "table_name": table_name,
#         "row_count": len(df),
#         "columns": col_meta,
#         "warnings": warnings,
#         "pii_detected": pii_result["pii_detected"],
#         "pii_summary": pii_result,
#     }


# app/ingestion.py
"""
File ingestion: CSV / XLSX / PDF / Tally XML  →  PostgreSQL table.

Each uploaded file gets its own table in the `datasets` schema
(named  datasets.ds_<uuid_hex>).  Column names are normalised
(lower-cased, spaces replaced with underscores) so they are
always valid SQL identifiers.

Returns a dict with:
  table_name      str  – fully-qualified table name
  row_count       int
  columns         list[dict]  – [{name, inferred_type}]
  warnings        list[str]   – non-fatal parse notes
"""

from __future__ import annotations

import asyncio
import re
import io
import json
import os
import uuid
from datetime import date, datetime
from typing import Any

import asyncpg
import polars as pl


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_col(name: str) -> str:
    """Normalise a column name to a safe SQL identifier."""
    name = str(name).strip().lower()
    name = re.sub(r"[^a-z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name or name[0].isdigit():
        name = "col_" + name
    return name


_INT_DTYPES = (
    pl.Int8, pl.Int16, pl.Int32, pl.Int64,
    pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
)
_FLOAT_DTYPES = (pl.Float32, pl.Float64)

# Pre-compiled regexes — the column may have hundreds of values to scan.
_DATE_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}$"               # ISO 2024-04-01
    r"|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$"  # 01/04/24, 01-04-2024
    r"|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}$"  # 01 Apr 2024
    r"|^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4}$"  # Apr 1, 2024
)
_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?$"
)
_NUMBER_RE   = re.compile(r"^-?\d+(\.\d+)?$")
_CURRENCY_RE = re.compile(r"^[₹$£€]?\s*-?\d{1,3}(,\d{2,3})*(\.\d+)?$|^-?\d+(\.\d+)?$|^-+$")
_BOOL_TEXT   = {"true", "false", "yes", "no", "y", "n", "t", "f"}


def _sniff_text_column(series: pl.Series) -> str:
    """Sample up to 200 non-null trimmed string values and try to detect a
    semantic type. Returns one of the same labels as `_infer_type`."""
    try:
        raw = series.drop_nulls().cast(pl.String).head(200).to_list()
    except Exception:
        return "text"
    sample = [s.strip() for s in raw if s is not None and str(s).strip()]
    if not sample:
        return "text"
    n = len(sample)
    # ≥ 85% of sampled values must match for a confident classification.
    threshold = 0.85

    has_symbol = any(any(c in s for c in "₹$£€") for s in sample)
    has_thousands_sep = any(re.search(r"\d,\d", s) for s in sample)

    # Booleans only via text variants — don't claim 0/1 columns are bool, those
    # could just as well be flag-encoded numbers.
    bools = sum(1 for s in sample if s.lower() in _BOOL_TEXT)
    if bools / n >= threshold:
        return "boolean"

    # Datetime is more specific than date — try it first.
    datetimes = sum(1 for s in sample if _DATETIME_RE.match(s))
    if datetimes / n >= threshold:
        return "datetime"
    dates = sum(1 for s in sample if _DATE_RE.match(s))
    if dates / n >= threshold:
        return "date"

    currency_shape = sum(1 for s in sample if _CURRENCY_RE.match(s))
    pure_numbers = sum(1 for s in sample if _NUMBER_RE.match(s))
    if currency_shape / n >= threshold:
        if has_symbol or has_thousands_sep:
            return "currency"
        if pure_numbers / n >= threshold:
            return "number"

    return "text"


def _infer_type(series: pl.Series) -> str:
    """Classify a column for display + cleaning purposes.

    Returns one of: ``text``, ``number``, ``date``, ``datetime``,
    ``currency``, ``boolean``. These labels match the values the
    frontend dropdown uses, so a user-supplied override is a string
    swap rather than a value translation.
    """
    dtype = series.dtype
    if dtype in _INT_DTYPES or dtype in _FLOAT_DTYPES:
        return "number"
    if dtype == pl.Boolean:
        return "boolean"
    if dtype == pl.Date:
        return "date"
    if dtype == pl.Datetime:
        return "datetime"
    return _sniff_text_column(series)


def _pg_type(inferred: str) -> str:
    return {
        # New (UI-aligned) labels
        "number":   "DOUBLE PRECISION",
        "currency": "DOUBLE PRECISION",
        "boolean":  "BOOLEAN",
        "date":     "DATE",
        "datetime": "TIMESTAMPTZ",
        "text":     "TEXT",
        # Backwards-compat: pre-Phase-3 datasets stored these in `columns` JSONB.
        "integer":  "BIGINT",
        "float":    "DOUBLE PRECISION",
    }.get(inferred, "TEXT")


def _normalise_df(df: pl.DataFrame) -> tuple[pl.DataFrame, list[dict]]:
    """Rename columns to safe identifiers; return (new_df, column_meta)."""
    rename_map: dict[str, str] = {}
    seen: dict[str, int] = {}
    for col in df.columns:
        safe = _safe_col(col)
        if safe in seen:
            seen[safe] += 1
            safe = f"{safe}_{seen[safe]}"
        else:
            seen[safe] = 0
        rename_map[col] = safe  # always assigned, outside if/else

    df = df.rename(rename_map)

    def _is_native(s: pl.Series) -> bool:
        """True when the polars dtype is already structured (not a string).
        Used by `_create_table_and_insert` to decide whether to store the
        column at its inferred postgres type (native) or keep it as TEXT
        (sniffed from a string column — needs the cleaning step to convert)."""
        return s.dtype not in (pl.String, pl.Utf8, pl.Object, pl.Null)

    col_meta = [
        {
            "name": new,
            "original_name": old,
            "inferred_type": _infer_type(df[new]),
            "native_dtype": _is_native(df[new]),
            "null_pct": round(df[new].null_count() / max(len(df), 1) * 100, 1),
        }
        for old, new in rename_map.items()
    ]
    return df, col_meta


async def _create_table_and_insert(
    conn: asyncpg.Connection,
    table_name: str,
    df: pl.DataFrame,
    col_meta: list[dict],
) -> None:
    """CREATE TABLE then bulk-insert all rows via COPY.

    Detected types like ``currency`` and ``date``/``datetime`` (when sniffed
    from a string column) carry semantic meaning but the raw values are still
    text on disk — e.g. ``₹1,234.56``. We can't insert those into a
    DOUBLE PRECISION column directly. So during the initial ingestion we
    store text-sniffed columns as TEXT and let the optional cleaning step
    re-create the table with the proper type after parsing the values.
    """

    def _storage_type(meta: dict) -> str:
        """How to physically store this column on disk during initial ingest."""
        inferred = meta["inferred_type"]
        # Native polars-typed columns can be stored at their inferred type.
        # Sniffed-from-text classifications keep TEXT until cleaning runs —
        # this prevents asyncpg copy errors when raw values contain currency
        # symbols, commas, or other non-numeric characters.
        is_native = meta.get("native_dtype", False)
        if inferred in ("number", "currency", "date", "datetime") and not is_native:
            return "TEXT"
        return _pg_type(inferred)

    col_defs = ", ".join(
        f'"{m["name"]}" {_storage_type(m)}' for m in col_meta
    )
    await conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({col_defs})")

    col_names = [m["name"] for m in col_meta]
    rows: list[tuple[Any, ...]] = []
    for row in df.to_dicts():
        record = []
        for m in col_meta:
            val = row.get(m["name"])
            inferred = m["inferred_type"]
            is_native = m.get("native_dtype", False)
            if val is None:
                record.append(None)
            elif inferred == "boolean":
                if is_native:
                    record.append(bool(val))
                else:
                    record.append(str(val).strip().lower() in ("yes", "true", "1", "y", "t"))
            elif inferred in ("number", "integer", "float") and is_native:
                try:
                    record.append(float(val))
                except (ValueError, TypeError):
                    record.append(None)
            elif inferred in ("date", "datetime") and is_native:
                if isinstance(val, (date, datetime)):
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


# ---------------------------------------------------------------------------
# Preamble and footer detection
# ---------------------------------------------------------------------------


def _detect_table_start(rows: list[tuple], min_fill_ratio: float = 0.5) -> int:
    """Scan rows top-to-bottom, return index of first row where >= 50% columns filled.
    Skips preamble rows like bank name, account info, etc.
    Returns 0 if file looks clean from row 1."""
    if not rows:
        return 0
    total_cols = max(len(r) for r in rows)
    if total_cols == 0:
        return 0
    threshold = max(2, int(total_cols * min_fill_ratio))
    for i, row in enumerate(rows):
        non_empty = sum(
            1 for cell in row
            if cell is not None and str(cell).strip() != ""
        )
        if non_empty >= threshold:
            return i
    return 0


def _detect_table_end(rows: list[tuple], min_fill_ratio: float = 0.5) -> int:
    """Scan rows bottom-to-top, return exclusive end index of last real data row.
    Trims trailing empty rows and footer notes.
    Returns len(rows) if nothing to trim."""
    if not rows:
        return 0
    total_cols = max(len(r) for r in rows)
    if total_cols == 0:
        return 0
    threshold = max(2, int(total_cols * min_fill_ratio))
    end_idx = len(rows)
    for i in range(len(rows) - 1, -1, -1):
        non_empty = sum(
            1 for cell in rows[i]
            if cell is not None and str(cell).strip() != ""
        )
        if non_empty >= threshold:
            end_idx = i + 1
            break
    return end_idx


# ---------------------------------------------------------------------------
# Format-specific parsers  →  polars DataFrame
# ---------------------------------------------------------------------------


def _parse_csv(file_path: str) -> tuple[pl.DataFrame, list[str]]:
    warnings: list[str] = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        raw_rows = [tuple(line.strip().split(",")) for line in all_lines]
        skip_rows = _detect_table_start(raw_rows)
        # Trim footer from bottom
        end_idx = _detect_table_end(raw_rows)
        trimmed = len(raw_rows) - end_idx
        if skip_rows > 0:
            warnings.append(f"Preamble detected: skipped {skip_rows} row(s) before the table header.")
        if trimmed > 0:
            warnings.append(f"Footer detected: trimmed {trimmed} row(s) after the table.")
        try:
            df = pl.read_csv(
                file_path, infer_schema_length=10000, ignore_errors=True,
                skip_rows=skip_rows, n_rows=(end_idx - skip_rows) if (skip_rows > 0 or trimmed > 0) else None,
            )
        except Exception as e:
            warnings.append(f"CSV parse warning: {e}")
            df = pl.read_csv(file_path, infer_schema_length=0, skip_rows=skip_rows)
    except Exception as e:
        warnings.append(f"CSV parse warning: {e}")
        df = pl.read_csv(file_path, infer_schema_length=10000, ignore_errors=True)
    return df, warnings


def _parse_xlsx(file_path: str) -> tuple[pl.DataFrame, list[str]]:
    """Parse an XLSX. Tries to preserve numeric/date types where openpyxl
    already gave us python-native values, then falls back to text-mode
    parsing if Polars chokes on mixed types within a column.
    """
    warnings: list[str] = []
    try:
        import openpyxl

        wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not rows:
            return pl.DataFrame(), ["Empty workbook"]

        # Detect and skip preamble rows
        table_start = _detect_table_start(rows)
        if table_start > 0:
            warnings.append(f"Preamble detected: skipped {table_start} row(s) before the table header.")
            rows = rows[table_start:]

        if not rows:
            return pl.DataFrame(), ["No data rows found after skipping preamble"]

        # Detect and trim footer rows
        table_end = _detect_table_end(rows)
        if table_end < len(rows):
            trimmed = len(rows) - table_end
            warnings.append(f"Footer detected: trimmed {trimmed} row(s) after the table.")
            rows = rows[:table_end]

        headers = [
            str(h).strip() if h is not None else f"col_{i}"
            for i, h in enumerate(rows[0])
        ]

        # Try the rich path first: feed openpyxl's typed values to Polars
        # column-by-column so ints/floats/dates stay native. This means
        # `_infer_type` sees the real polars dtype for native columns and
        # only falls back to text-sniffing where xlsx itself stored strings.
        try:
            data_rows = rows[1:]
            cols: dict[str, list] = {h: [] for h in headers}
            for row in data_rows:
                for i, cell in enumerate(row):
                    cols[headers[i]].append(cell)
            df = pl.DataFrame(cols, infer_schema_length=10000, strict=False)
            return df, warnings
        except Exception as e_native:
            warnings.append(
                f"XLSX rich-type parse failed, falling back to text mode: {e_native}"
            )
            # Fallback: serialise everything as quoted CSV and re-parse with
            # Polars in text-only mode, then let the sniffer do its best.
            csv_lines = [",".join(f'"{c}"' for c in headers)]
            for row in rows[1:]:
                vals = []
                for cell in row:
                    if cell is None:
                        vals.append("")
                    else:
                        s = str(cell).replace('"', '""')
                        vals.append(f'"{s}"')
                csv_lines.append(",".join(vals))
            csv_data = "\n".join(csv_lines)
            df = pl.read_csv(
                io.StringIO(csv_data),
                infer_schema_length=10000,
                ignore_errors=True,
            )
    except Exception as e:
        warnings.append(f"XLSX parse warning: {e}")
        df = pl.read_excel(file_path, engine="openpyxl")
    return df, warnings


def _parse_pdf(file_path: str) -> tuple[pl.DataFrame, list[str]]:
    """
    Extract tables from a digital (non-scanned) PDF using pdfplumber.
    Merges all tables across all pages into one DataFrame.
    Bank statements and Tally-exported PDFs work well here.
    """
    import pdfplumber

    warnings: list[str] = []
    all_rows: list[dict] = []
    headers: list[str] = []

    with pdfplumber.open(file_path) as pdf:
        for page_num, page in enumerate(pdf.pages, 1):
            tables = page.extract_tables()
            for tbl in tables:
                if not tbl:
                    continue
                if not headers:
                    # First table header becomes the column names
                    headers = [
                        str(h).strip() if h else f"col_{i}"
                        for i, h in enumerate(tbl[0])
                    ]
                    data_start = 1
                else:
                    data_start = 0
                    # If this page table has same column count, use it
                    if len(tbl[0]) != len(headers):
                        warnings.append(
                            f"Page {page_num}: table column count mismatch, skipping"
                        )
                        continue

                for row in tbl[data_start:]:
                    if all(
                        cell is None or str(cell).strip() == "" for cell in row
                    ):
                        continue
                    all_rows.append(
                        {
                            headers[i]: (
                                str(cell).strip() if cell is not None else None
                            )
                            for i, cell in enumerate(row)
                        }
                    )

    if not all_rows:
        warnings.append(
            "No tables found in PDF — the PDF may be scanned or have no extractable tables"
        )
        return pl.DataFrame(), warnings

    df = pl.from_dicts(all_rows)
    return df, warnings


def _parse_tally_xml(file_path: str) -> tuple[pl.DataFrame, list[str]]:
    """
    Parse Tally Prime / Tally ERP 9 XML exports.

    Tally XML follows this structure:
      <ENVELOPE>
        <BODY>
          <EXPORTDATA>
            <REQUESTDATA>
              <TALLYMESSAGE>
                <VOUCHER>   (or LEDGER / STOCKITEM etc.)
                  <DATE>...</DATE>
                  <PARTYLEDGERNAME>...</PARTYLEDGERNAME>
                  ...
                </VOUCHER>
              </TALLYMESSAGE>

    We discover the repeating element automatically and flatten
    its direct children + first-level sub-elements into columns.
    """
    from lxml import etree

    warnings: list[str] = []

    tree = etree.parse(file_path)
    root = tree.getroot()

    # Find TALLYMESSAGE nodes (standard Tally export wrapper)
    messages = root.findall(".//TALLYMESSAGE")
    if not messages:
        warnings.append(
            "No <TALLYMESSAGE> elements found — treating whole XML as flat records"
        )
        messages = [root]

    rows: list[dict] = []
    for msg in messages:
        for child in msg:
            record: dict[str, Any] = {"_element": child.tag}
            for elem in child:
                # Flatten one level deep; skip nested lists
                if len(elem) == 0:
                    record[elem.tag] = (elem.text or "").strip()
                else:
                    # Nested element: join child text
                    record[elem.tag] = " | ".join(
                        (e.text or "").strip() for e in elem if e.text
                    )
            if len(record) > 1:  # skip empty records
                rows.append(record)

    if not rows:
        return pl.DataFrame(), ["No data rows parsed from XML"]

    df = pl.from_dicts(rows, infer_schema_length=len(rows))
    return df, warnings


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


async def ingest_dataframe(
    conn: asyncpg.Connection,
    df: pl.DataFrame,
) -> dict:
    """Ingest a pre-built Polars DataFrame into a new datasets table."""
    if df.is_empty():
        return {
            "table_name": None,
            "row_count": 0,
            "columns": [],
            "warnings": ["DataFrame is empty"],
            "pii_detected": False,
            "pii_summary": None,
        }

    df, col_meta = _normalise_df(df)
    table_id = uuid.uuid4().hex
    table_name = f"datasets.ds_{table_id}"
    await _create_table_and_insert(conn, table_name, df, col_meta)

    # PII scan (CPU-bound, runs in executor if called from async context)
    from app.pii_detector import scan_dataframe
    pii_result = scan_dataframe(df)

    return {
        "table_name": table_name,
        "row_count": len(df),
        "columns": col_meta,
        "warnings": [],
        "pii_detected": pii_result["pii_detected"],
        "pii_summary": pii_result,
    }


async def ingest_file(
    conn: asyncpg.Connection,
    file_path: str,
    file_type: str,
) -> dict:
    """
    Parse *file_path* according to *file_type* and load it into a new
    PostgreSQL table.  Returns metadata dict.
    """
    # 1. Parse to DataFrame
    parsers = {
        "csv": _parse_csv,
        "xlsx": _parse_xlsx,
        "pdf": _parse_pdf,
        "xml": _parse_tally_xml,
    }
    if file_type not in parsers:
        raise ValueError(f"Unsupported file type: {file_type}")

    # Parsing (Polars CSV/XLSX read) is CPU-bound — run in thread to free event loop
    loop = asyncio.get_event_loop()
    df, warnings = await loop.run_in_executor(
        None, parsers[file_type], file_path
    )

    if df.is_empty():
        return {
            "table_name": None,
            "row_count": 0,
            "columns": [],
            "warnings": warnings or ["File produced no data rows"],
        }

    # 2. Normalise column names (CPU-bound)
    df, col_meta = await loop.run_in_executor(None, _normalise_df, df)

    # 3. Choose table name  datasets.ds_<hex>
    table_id = uuid.uuid4().hex
    table_name = f"datasets.ds_{table_id}"

    # 4. Create table + insert
    await _create_table_and_insert(conn, table_name, df, col_meta)

    # PII scan
    from app.pii_detector import scan_dataframe
    pii_result = scan_dataframe(df)

    return {
        "table_name": table_name,
        "row_count": len(df),
        "columns": col_meta,
        "warnings": warnings,
        "pii_detected": pii_result["pii_detected"],
        "pii_summary": pii_result,
    }

