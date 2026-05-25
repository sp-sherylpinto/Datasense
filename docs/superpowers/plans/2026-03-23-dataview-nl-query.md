# Data View — Natural Language Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Ollama-powered natural language query bar to the Data View tab that generates SQL from plain English, executes it, and shows results + a streamed AI explanation in a modal overlay.

**Architecture:** Three sequential API calls orchestrated in the frontend: `POST /ai/sql-assist` (existing) → `POST /workbench/query` (existing, limit 200) → `POST /ai/explain-query` (new SSE endpoint). All changes are in two files: a new `explain_query_result` function added to `app/ai.py`, a new endpoint added to `app/main.py`, and new state + JSX added inside the existing `DataView` component in `src/App.tsx`.

**Tech Stack:** Python 3.12, FastAPI, httpx (async SSE streaming), React 18, TypeScript, Tailwind CSS, lucide-react icons, fetch + ReadableStream for SSE consumption.

---

## File Map

| File | Change |
|---|---|
| `app/ai.py` | Add `explain_query_result()` function after the existing `explain_job` function |
| `app/main.py` | Add `POST /ai/explain-query` endpoint after the existing `POST /ai/explain/{job_id}` endpoint |
| `src/App.tsx` | Add NL query state + bottom bar + modal inside the `DataView` component (starts at line ~871) |

No new files are created.

---

## Task 1: Backend — `explain_query_result` function in `ai.py`

**Files:**
- Modify: `app/ai.py` — add new async generator function after line 295 (end of `explain_job`)

**Context:** `ai.py` already has `explain_job` which streams explanations from a Parquet file. This new function does the same but accepts inline data (SQL + columns + rows) instead of a file path. Study the `explain_job` function (lines 262–295) and the Ollama streaming pattern before writing this.

- [ ] **Step 1: Add `explain_query_result` to `app/ai.py`**

Add this function immediately after the closing of `explain_job` (after line 295):

```python
async def explain_query_result(
    sql: str,
    columns: list[str],
    rows: list[dict],
) -> AsyncGenerator[str, None]:
    """Stream a plain-English explanation of an ad-hoc query result."""
    sample = rows[:10]  # defensive truncation — keep prompt small for 1.5b model
    col_str = ", ".join(columns)
    rows_str = "\n".join(
        "  " + ", ".join(str(row.get(c, "")) for c in columns)
        for row in sample
    )
    prompt = (
        "You are an audit data analyst assistant. A user ran the following SQL query "
        "against their dataset and got these results. Explain what the data shows in "
        "clear, plain English suitable for a CA firm. Be specific about numbers. "
        "Keep the response under 200 words.\n\n"
        f"SQL:\n{sql}\n\n"
        f"Columns: {col_str}\n"
        f"Sample rows ({len(sample)} of {len(rows)} total):\n{rows_str}\n\n"
        "Explain the key findings and what they mean."
    )

    try:
        _timeout = httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=_timeout) as client:
            async with client.stream(
                "POST",
                f"{settings.OLLAMA_URL}/api/generate",
                json={
                    "model": _MODEL,
                    "prompt": prompt,
                    "stream": True,
                    "options": {"num_predict": 400},
                },
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("response", "")
                        if token:
                            yield token
                        if chunk.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue
    except Exception as e:
        log.exception("explain_query_result: Ollama stream failed")
        yield f"\n[AI service error: {e}]"
```

- [ ] **Step 2: Also add `explain_query_result` to the imports section**

At the top of `app/main.py`, find the line:
```python
from app.ai import classify_dataset, sql_assist, explain_job
```
Change it to:
```python
from app.ai import classify_dataset, sql_assist, explain_job, explain_query_result
```

- [ ] **Step 3: Commit**

```bash
git add app/ai.py app/main.py
git commit -m "feat: add explain_query_result function to ai.py"
```

---

## Task 2: Backend — `POST /ai/explain-query` endpoint in `main.py`

**Files:**
- Modify: `app/main.py` — add new endpoint after the existing `POST /ai/explain/{job_id}` endpoint (after line ~690)

**Context:** The existing `ai_explain` endpoint (lines 661–690) is the pattern to follow. This new endpoint is simpler — no DB lookup, just accept body params and stream. The `event_stream()` inner function pattern and `StreamingResponse` call are identical.

- [ ] **Step 1: Add the endpoint to `app/main.py`**

Insert this block immediately after the closing of `ai_explain` (after line ~690, before the `ai_sql_assist` function):

```python
@app.post("/ai/explain-query")
async def ai_explain_query(
    sql: str = Body(..., embed=True),
    columns: list[str] = Body(..., embed=True),
    rows: list[dict] = Body(..., embed=True),
    user: str = Depends(get_current_user),
):
    """Stream a plain-English explanation of an ad-hoc query result."""
    async def event_stream():
        async for token in explain_query_result(sql, columns, rows):
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 2: Verify the app starts clean**

```bash
docker compose build data_analytics --no-cache 2>&1 | tail -5
docker compose up -d data_analytics 2>&1 | tail -5
docker logs data_analytics --tail 5
```

Expected last line: `INFO: Application startup complete.`

- [ ] **Step 3: Smoke-test the new endpoint**

```bash
curl -s -X POST http://localhost:8000/ai/explain-query \
  -H "Content-Type: application/json" \
  -H "X-API-Token: dev-token" \
  -d '{"sql":"SELECT customer_name, SUM(assessable_value) FROM datasets.ds_test GROUP BY 1","columns":["customer_name","sum"],"rows":[{"customer_name":"Acme","sum":100000}]}' \
  --no-buffer | head -5
```

Expected: lines starting with `data: ` followed by `data: [DONE]`

- [ ] **Step 4: Commit**

```bash
git add app/main.py
git commit -m "feat: add POST /ai/explain-query SSE endpoint"
```

---

## Task 3: Frontend — NL query state and bottom bar in `DataView`

**Files:**
- Modify: `src/App.tsx` — inside the `DataView` component (starts at line ~871)

**Context:** The `DataView` component is a large function component. Its `return` statement starts at line ~975. The data table and pagination are rendered inside a `<div className="space-y-6">` wrapper. You will:
1. Add 8 new state variables near the top of the component (after the existing `useState` calls, around line ~904)
2. Add a `handleNlQuery` async function after the existing `handleSort` / `moveColumn` functions (around line ~973)
3. Add the bottom bar JSX at the end of the returned JSX, just before the closing `</div>` of the outermost wrapper

**Existing API pattern to follow:** The workbench tab (search for `api.post('/ai/sql-assist'`) shows how `sql-assist` is called. The `AiInsightPanel` component at `src/components/AiInsightPanel.tsx` shows the exact `fetch` + `ReadableStream` SSE consumption pattern — copy it closely.

- [ ] **Step 1: Add new state variables to `DataView`**

Find the block of `useState` calls near line 892 (after `const [showConfig, setShowConfig] = useState(false);`) and add:

```typescript
const [nlQuery, setNlQuery] = useState('');
const [nlLoading, setNlLoading] = useState(false);
const [nlError, setNlError] = useState<string | null>(null);
const [nlModal, setNlModal] = useState(false);
const [nlSql, setNlSql] = useState('');
const [nlResults, setNlResults] = useState<{ columns: string[], data: any[] } | null>(null);
const [nlQueryError, setNlQueryError] = useState<string | null>(null);
const [nlExplanation, setNlExplanation] = useState('');
const [nlShowSql, setNlShowSql] = useState(false);
```

- [ ] **Step 2: Add `handleNlQuery` function**

Add this function after `moveColumn` (around line ~973), before the `return` statement:

```typescript
const API_TOKEN = (import.meta.env.VITE_API_AUTH_TOKEN || 'dev-token').trim();

const handleNlQuery = async () => {
  if (!nlQuery.trim() || nlLoading) return;

  // Reset all NL state on each new submission
  setNlLoading(true);
  setNlError(null);
  setNlModal(false);
  setNlSql('');
  setNlResults(null);
  setNlQueryError(null);
  setNlExplanation('');
  setNlShowSql(false);

  // Step 1: Generate SQL
  let generatedSql = '';
  try {
    const cols = (file as any).columnMeta
      ? (file as any).columnMeta.map((c: any) => c.name)
      : file.columns;
    const r = await api.post('/ai/sql-assist', {
      prompt: nlQuery,
      tables: [{ name: (file as any).table_name, columns: cols }],
    });
    generatedSql = r.data.sql;
    setNlSql(generatedSql);
  } catch {
    setNlError("Couldn't generate a query — try rephrasing");
    setNlLoading(false);
    return;
  }

  // Step 2: Execute SQL
  let resultColumns: string[] = [];
  let resultData: any[] = [];
  try {
    const r = await api.post('/workbench/query', { sql: generatedSql, limit: 200 });
    resultColumns = r.data.columns || [];
    resultData = r.data.data || [];
    setNlResults({ columns: resultColumns, data: resultData });
    setNlQueryError(null);
  } catch (e: any) {
    setNlQueryError(e?.response?.data?.detail || 'Query failed');
    setNlResults(null);
  }

  // Open modal — nlLoading goes false here so user can submit another query
  setNlModal(true);
  setNlLoading(false);

  // Step 3: Stream explanation (only if we have results)
  if (resultData.length === 0 && !nlQueryError) {
    setNlExplanation('No rows returned — nothing to explain.');
    return;
  }
  try {
    const resp = await fetch('/ai/explain-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': API_TOKEN },
      body: JSON.stringify({ sql: generatedSql, columns: resultColumns, rows: resultData.slice(0, 10) }),
    });
    if (!resp.ok || !resp.body) {
      setNlExplanation('Explanation unavailable.');
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const token = line.slice(6);
          if (token === '[DONE]') break;
          setNlExplanation(prev => prev + token);
        }
      }
    }
  } catch {
    setNlExplanation('Explanation unavailable.');
  }
};
```

- [ ] **Step 3: Add the bottom bar JSX**

In the `return` block of `DataView`, find the closing `</div>` of the outermost `<div className="space-y-6">` wrapper (around line ~1290, after pagination). Insert the bottom bar before that closing `</div>`:

```tsx
{/* NL Query Bar — only shown when the dataset has a PostgreSQL table */}
{(file as any).table_name && (
  <div className="bg-surf border border-border rounded-xl p-3 shadow-sm">
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 px-2 py-1 bg-acc/10 text-acc rounded-md text-[11px] font-semibold whitespace-nowrap">
        <Sparkles size={11} /> AI
      </span>
      <input
        type="text"
        value={nlQuery}
        onChange={e => setNlQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleNlQuery(); }}
        placeholder="Ask a question about this data…"
        disabled={nlLoading}
        className="flex-1 px-3 py-2 bg-sub border border-border rounded-lg text-[12px] text-tx placeholder-tx3 outline-none focus:ring-2 focus:ring-acc/20 disabled:opacity-50"
      />
      <button
        onClick={handleNlQuery}
        disabled={nlLoading || !nlQuery.trim()}
        className="px-3 py-2 text-[12px] bg-acc text-white rounded-lg hover:bg-acc/90 disabled:opacity-50 whitespace-nowrap flex items-center gap-1"
      >
        {nlLoading ? <Activity size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {nlLoading ? 'Thinking…' : 'Ask'}
      </button>
    </div>
    {nlError && <p className="mt-1 text-[11px] text-red-400 pl-1">{nlError}</p>}
  </div>
)}
```

Note: `Sparkles` is already imported from lucide-react. `Activity` is also already imported (used by the cleaning button). Verify both are in the existing import line before committing.

- [ ] **Step 4: Verify `Sparkles` and `Activity` are in the lucide-react import**

```bash
grep "Sparkles\|Activity" src/App.tsx | head -3
```

Expected: both names appear in an `import { ... } from 'lucide-react'` line. If either is missing, add it.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add NL query state and bottom bar to DataView"
```

---

## Task 4: Frontend — Results modal in `DataView`

**Files:**
- Modify: `src/App.tsx` — add modal JSX inside `DataView`, after the bottom bar

**Context:** The app already uses modals in other places (search for `fixed inset-0` in `App.tsx` to find examples). The modal must render outside the normal flow using a fixed overlay. The results table styling should match the workbench results table (search for `Results —` in `App.tsx` to find that section and copy the table classes).

- [ ] **Step 1: Add the results modal JSX**

Immediately after the bottom bar JSX (still inside the outermost `<div className="space-y-6">`), add:

```tsx
{/* NL Query Results Modal */}
{nlModal && (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setNlModal(false)}>
    <div
      className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Modal header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-acc" />
          <span className="text-[13px] font-semibold text-tx">Query Results</span>
          {nlResults && (
            <span className="text-[11px] text-tx3 font-mono">{nlResults.data.length} rows</span>
          )}
        </div>
        <button onClick={() => setNlModal(false)} className="text-tx3 hover:text-tx transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 p-5 space-y-4">
        {/* SQL block */}
        <div className="bg-sub border border-border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-tx3 hover:text-tx transition-colors"
            onClick={() => setNlShowSql(!nlShowSql)}
          >
            <span className="font-mono uppercase tracking-wider">SQL</span>
            {nlShowSql ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {(nlShowSql || !nlResults) && (
            <pre className="px-4 pb-3 text-[11px] font-mono text-tx2 overflow-x-auto whitespace-pre-wrap">{nlSql}</pre>
          )}
        </div>

        {/* Query error */}
        {nlQueryError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-[12px] text-red-400">
            {nlQueryError}
          </div>
        )}

        {/* Results table */}
        {nlResults && nlResults.data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-sub">
                  {nlResults.columns.map(col => (
                    <th key={col} className="px-3 py-2 text-left font-semibold text-tx3 uppercase tracking-wider border-b border-border whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nlResults.data.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-bg' : 'bg-sub/30'}>
                    {nlResults.columns.map(col => (
                      <td key={col} className="px-3 py-2 text-tx2 border-b border-border/50 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                        {row[col] == null ? <span className="text-tx3 italic">null</span> : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nlResults && nlResults.data.length === 0 && !nlQueryError && (
          <p className="text-[12px] text-tx3 italic">No rows returned.</p>
        )}

        {/* Explanation */}
        {(nlResults || nlQueryError) && (
          <div className="border border-border rounded-lg p-4 bg-surf">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={12} className="text-acc" />
              <span className="text-[11px] font-semibold text-tx uppercase tracking-wider">AI Explanation</span>
            </div>
            {!nlExplanation ? (
              <span className="text-[12px] text-tx3 animate-pulse">Explaining…</span>
            ) : (
              <p className="text-[12px] text-tx2 leading-relaxed whitespace-pre-wrap">{nlExplanation}</p>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: Verify `X`, `ChevronUp`, `ChevronDown` are in the lucide-react import**

```bash
grep "ChevronUp\|ChevronDown\|\" X\"" src/App.tsx | head -3
```

If any are missing, add them to the import line.

- [ ] **Step 3: Build the frontend to catch TypeScript errors**

```bash
cd /home/ubuntu/hosting/in-house-apps/data_analytics && npm run build 2>&1 | tail -20
```

Expected: `✓ built in` with no TypeScript errors. Fix any type errors before committing.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add NL query results modal to DataView"
```

---

## Task 5: Deploy and verify

**Files:** None — deploy existing changes.

- [ ] **Step 1: Rebuild both containers**

```bash
cd /home/ubuntu/hosting
docker compose build data_analytics 2>&1 | tail -5
docker compose up -d data_analytics 2>&1 | tail -5
docker logs data_analytics --tail 5
```

Expected: `INFO: Application startup complete.`

- [ ] **Step 2: Verify the endpoint is reachable**

```bash
curl -s -X POST http://localhost:8000/ai/explain-query \
  -H "Content-Type: application/json" \
  -H "X-API-Token: dev-token" \
  -d '{"sql":"SELECT 1","columns":["one"],"rows":[{"one":1}]}' \
  --no-buffer | head -3
```

Expected: `data: ` lines streaming back.

- [ ] **Step 3: End-to-end test in the browser**

1. Open the app, go to Data View tab with the Rinac dataset loaded
2. Scroll to the bottom — the AI query bar should be visible
3. Type: `top 5 customers by assessable value`
4. Press Enter or click Ask
5. Verify: modal opens with SQL, results table, and explanation streaming in
6. Type a second query while explanation is still streaming — verify the modal re-opens cleanly with fresh content

- [ ] **Step 4: Test error state**

1. Type something nonsensical: `xyzzy purple elephant`
2. Verify: bar shows inline error *"Couldn't generate a query — try rephrasing"*, no modal opens

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: DataView natural language query with AI explanation complete"
```
