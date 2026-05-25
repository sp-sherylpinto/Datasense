# Data View — Natural Language Query (AI)

**Date:** 2026-03-23
**Status:** Approved

---

## Overview

Add an Ollama-powered natural language query bar to the Data View tab. Users type a plain-English question about their dataset; the system generates SQL, executes it, and shows results with a streamed AI explanation in a modal overlay — without leaving the Data View tab.

---

## Data Flow

1. User types a question in the bottom bar and submits
2. `POST /ai/sql-assist` — existing endpoint; payload `{prompt, tables: [{name: table_name, columns: [...]}]}`
3. `POST /workbench/query` — existing endpoint; body includes `{sql, limit: 200}`. Note: the backend only injects `LIMIT 200` when the generated SQL has no existing LIMIT clause. If the AI includes its own LIMIT (e.g. "top 10"), that limit wins. The 200-row cap is a safety net for open-ended queries, not a hard override.
4. Modal opens immediately with SQL + results table; `nlLoading` is set to `false` at this point so the user can submit another question while the explanation streams
5. `POST /ai/explain-query` — new SSE streaming endpoint; explanation streams into the modal below the table, consumed via `fetch` + `ReadableStream` (same pattern as the existing `explain_job` consumption elsewhere in the app, **not** `EventSource` which only supports GET)

---

## Backend

### New function — `ai.py`

```
explain_query_result(sql: str, columns: list[str], rows: list[dict]) -> AsyncGenerator[str, None]
```

- Accepts `rows` as `list[dict]` (same format as `workbench/query` returns)
- Truncates defensively to the first 10 rows before building the prompt, regardless of how many rows the caller sends
- Prompt includes: the SQL, column names, and the sample rows formatted as a small table
- Streams a plain-English explanation (~200 words) of what the results show
- Uses the same Ollama streaming pattern as `explain_job` (`httpx` stream + `aiter_lines`)
- `num_predict` cap: 400 tokens
- Emits `data: [DONE]\n\n` as the final SSE frame (same sentinel as existing endpoints)

### New endpoint — `main.py`

```
POST /ai/explain-query
Body: { sql: str, columns: list[str], rows: list[dict] }
Returns: StreamingResponse (text/event-stream)
Auth: required (Depends(get_current_user))
```

- No database access
- Calls `explain_query_result` and streams tokens as `data: <token>\n\n` frames
- Emits `data: [DONE]\n\n` on completion

---

## Frontend

All changes are inside the existing `DataView` component in `src/App.tsx`. No new component files. Note: `DataView` is already a large component; if it grows unwieldy, the modal JSX may be extracted to a co-located sub-component, but this is not required upfront.

### Bottom bar

- Rendered below the data table, always visible when `file.table_name` is set (the fully-qualified `datasets.ds_<hex32>` name)
- Hidden entirely when `file.table_name` is absent — no error shown
- Text input + "Ask" button
- While `nlLoading` is `true`: button shows spinner, input is disabled
- Inline errors (bar-level) shown as small red text below the input

### Modal

Opens once SQL + results are ready (step 3 complete). Three stacked sections:

1. **SQL block** — monospace, auto-expanded when `nlResults` is `null` (error state) so the user can see the SQL that caused the failure; collapsed by default when results are present, with a "Show SQL" toggle
2. **Results table** — up to 200 rows with column headers; shows error message instead when `workbench/query` failed
3. **Explanation** — streams in below the table; shows "Explaining…" spinner until first token arrives; shows "Explanation unavailable" on stream failure or empty stream; discards the `[DONE]` sentinel token and does not render it

### Loading states

- `nlLoading` is `true` from submit until the modal opens (covers steps 2–3)
- `nlLoading` is set to `false` when the modal opens, before the explanation stream starts
- This allows the user to submit a new question while an explanation is still streaming in the modal

### New state in `DataView`

| State var | Type | Purpose |
|---|---|---|
| `nlQuery` | `string` | Current input value |
| `nlLoading` | `boolean` | True during sql_assist + workbench/query (steps 2–3 only) |
| `nlError` | `string \| null` | Bar-level error (sql_assist failures) |
| `nlModal` | `boolean` | Modal open/closed |
| `nlSql` | `string` | Generated SQL (shown in modal SQL block) |
| `nlResults` | `{ columns: string[], data: any[] } \| null` | Query results; null on workbench error |
| `nlQueryError` | `string \| null` | Workbench/query error message (shown inside modal) |
| `nlExplanation` | `string` | Accumulated streamed explanation tokens |

**Reset on new submission:** All `nl*` state except `nlQuery` is reset at the start of step 2 (on submit). `nlExplanation` is reset to `''` at submit time. If a previous explanation stream is still in flight when a new submission begins, it is abandoned — the reader is not explicitly cancelled, but leftover tokens are silently dropped because the state has already been cleared and the modal re-opens with fresh content.

---

## Error Handling

| Failure point | Behaviour |
|---|---|
| `sql_assist` fails or returns non-SELECT (both surface as HTTP 503) | Bar error: *"Couldn't generate a query — try rephrasing"*; no modal |
| `workbench/query` fails (bad SQL, HTTP 400) | Modal opens; SQL block auto-expanded; error message shown; no results, no explanation |
| `explain-query` stream fails or returns empty | Modal stays open with results; explanation section shows *"Explanation unavailable"* |
| `[DONE]` sentinel received | Discarded — not rendered in `nlExplanation` |
| Dataset has no `table_name` | Bar hidden entirely |
| Empty result set (0 rows returned) | Modal opens normally; explanation receives context that 0 rows matched |

---

## Out of Scope

- Saving or exporting NL query results
- Query history
- Editing the generated SQL before running
- Datasets without a PostgreSQL table (bar simply not rendered)
