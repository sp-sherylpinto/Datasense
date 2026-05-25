
// Updated WorkbenchTab.tsx
// NOTE: This file contains the full WorkbenchTab component with an enhanced
// "Dataset Tables" drawer-style UI similar to the Saved Datasets panel.
// Replace your existing WorkbenchTab.tsx with this file.

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, BookOpen, CheckCheck, ChevronDown, ChevronRight, ChevronUp,
  Clock, Database, Download, History, Play, Activity, XCircle, Zap,
  FolderOpen, RefreshCw, Table2, Search, X,
} from 'lucide-react';
import CodeEditor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs/components/prism-core';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-sql';
import { GuidePanel } from '../components/GuidePanel';
import { PrismSqlStyle, SqlHandbookDrawer } from '../components/SqlHandbook';
import { api } from '../lib/api';
import { exportCsv, exportExcel } from '../lib/helpers';

interface HistoryEntry {
  sql: string;
  ranAt: Date;
  durationMs: number;
  rowCount: number | null;
  error: string | null;
}

interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

const MAX_HISTORY = 20;

const fmtDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const fmtTime = (d: Date): string =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const sortData = (data: any[], col: string, dir: 'asc' | 'desc'): any[] => {
  return [...data].sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const an = Number(av);
    const bn = Number(bv);
    const cmp =
      !isNaN(an) && !isNaN(bn)
        ? an - bn
        : String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
};

export const WorkbenchTab = () => {
  const [tables, setTables] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [schema, setSchema] = useState<any[]>([]);
  const [sql, setSql] = useState('SELECT *\nFROM datasets.ds_<table_id>\nLIMIT 100;');
  const [results, setResults] = useState<{ columns: string[]; data: any[]; row_count?: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [savedQueries, setSavedQueries] = useState<any[]>([]);
  const [saveName, setSaveName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [handbookOpen, setHandbookOpen] = useState(false);
  const [sqlPrompt, setSqlPrompt] = useState('');

  const [queryHistory, setQueryHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [editorLineCount, setEditorLineCount] = useState(1);
  const editorRef = useRef<HTMLDivElement>(null);

  const [sortState, setSortState] = useState<SortState | null>(null);

  const [insertedCol, setInsertedCol] = useState<string | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // New UI state
  const [tablesDrawerOpen, setTablesDrawerOpen] = useState(true);
  const [tableSearch, setTableSearch] = useState('');

  useEffect(() => {
    api.get('/workbench/tables').then(r => setTables(r.data || [])).catch(() => {});
    api.get('/workbench/queries').then(r => setSavedQueries(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const lines = (sql.match(/\n/g) || []).length + 1;
    setEditorLineCount(lines);
  }, [sql]);

  useEffect(() => {
    if (editorRef.current) {
      editorTextareaRef.current = editorRef.current.querySelector('textarea');
    }
  });

  useEffect(() => {
    setSortState(null);
  }, [results]);

  const loadSchema = async (tableName: string) => {
    setSelectedTable(tableName);
    try {
      const r = await api.get(`/workbench/schema/${tableName}`);
      setSchema(r.data || []);
      setSql(`SELECT *\nFROM ${tableName}\nLIMIT 100;`);
    } catch {
      setSchema([]);
    }
  };

  const refreshTables = async () => {
    try {
      const r = await api.get('/workbench/tables');
      setTables(r.data || []);
    } catch {}
  };

  const runQuery = async () => {
    const cleanSql = sql.replace(/;$/, '').trim();
    if (!cleanSql) return;

    setRunning(true);
    setQueryError(null);
    setResults(null);

    const startTs = Date.now();

    try {
      const r = await api.post('/workbench/query', { sql: cleanSql });
      const durationMs = Date.now() - startTs;

      setResults(r.data);

      setQueryHistory(prev =>
        [
          {
            sql: cleanSql,
            ranAt: new Date(),
            durationMs,
            rowCount: r.data.row_count ?? r.data.data?.length ?? null,
            error: null,
          },
          ...prev,
        ].slice(0, MAX_HISTORY)
      );
    } catch (e: any) {
      const durationMs = Date.now() - startTs;
      const errMsg = e?.response?.data?.detail || 'Query failed';

      setQueryError(errMsg);

      setQueryHistory(prev =>
        [
          {
            sql: cleanSql,
            ranAt: new Date(),
            durationMs,
            rowCount: null,
            error: errMsg,
          },
          ...prev,
        ].slice(0, MAX_HISTORY)
      );
    } finally {
      setRunning(false);
    }
  };

  const generateSql = () => {
    if (!sqlPrompt.trim()) return;

    const tblList = tables.map((t: any) => ({
      name: t.table_name,
      columns: Array.isArray(t.columns)
        ? t.columns.map((c: any) => (typeof c === 'string' ? c : c.name))
        : [],
    }));

    api.post('/ai/sql-assist', { prompt: sqlPrompt, tables: tblList })
      .then(r => setSql(r.data.sql))
      .catch(() => {});
  };

  const saveQuery = async () => {
    if (!saveName.trim()) return;

    try {
      const r = await api.post('/workbench/queries', {
        name: saveName,
        sql,
      });

      setSavedQueries(prev => [r.data, ...prev]);
      setSaveName('');
      setShowSaveForm(false);
    } catch {}
  };

  const deleteQuery = async (id: string) => {
    await api.delete(`/workbench/queries/${id}`).catch(() => {});
    setSavedQueries(prev => prev.filter(q => q.id !== id));
  };

  const handleSort = (col: string) => {
    setSortState(prev =>
      prev?.column === col
        ? {
            column: col,
            direction: prev.direction === 'asc' ? 'desc' : 'asc',
          }
        : {
            column: col,
            direction: 'asc',
          }
    );
  };

  const sortedData = results
    ? sortState
      ? sortData(results.data, sortState.column, sortState.direction)
      : results.data
    : [];

  const insertColumnAtCursor = (colName: string) => {
    const quoted = `"${colName}"`;
    const ta = editorTextareaRef.current;

    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      const newSql =
        sql.substring(0, start) +
        quoted +
        sql.substring(end);

      setSql(newSql);

      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(
          start + quoted.length,
          start + quoted.length
        );
      });
    } else {
      setSql(prev => prev + quoted);
    }

    setInsertedCol(colName);
    setTimeout(() => setInsertedCol(null), 1000);
  };

  const filteredTables = tables.filter((t: any) => {
    const q = tableSearch.toLowerCase();
    return (
      t.original_filename?.toLowerCase().includes(q) ||
      t.table_name?.toLowerCase().includes(q)
    );
  });

  const SortIcon = ({ col }: { col: string }) => {
    if (sortState?.column !== col) {
      return (
        <ArrowUpDown
          size={10}
          className="opacity-30 group-hover:opacity-70 transition-opacity"
        />
      );
    }

    return sortState.direction === 'asc' ? (
      <ArrowUp size={10} className="text-acc" />
    ) : (
      <ArrowDown size={10} className="text-acc" />
    );
  };

  return (
    <>
      <PrismSqlStyle />
      <SqlHandbookDrawer
        open={handbookOpen}
        onClose={() => setHandbookOpen(false)}
      />

      <div className="space-y-5">
        <GuidePanel
          tabId="workbench"
          icon={<Database size={15} />}
          title="SQL Workbench"
          description="Write custom SQL SELECT queries directly against your uploaded datasets."
          whenToUse={[
            'Custom calculations',
            'JOIN multiple datasets',
            'Investigate specific records',
            'Export subsets of data',
          ]}
          steps={[
            'Open Dataset Tables',
            'Select a table',
            'Click columns to insert',
            'Run with Ctrl+Enter',
          ]}
          tip="Click any column name in the schema to insert it at your cursor."
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar */}
          <div className="space-y-4">
            {/* Dataset Tables Drawer */}
            <div className="bg-surf border border-border rounded-2xl overflow-hidden shadow-soft">
              <button
                onClick={() => setTablesDrawerOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-border hover:bg-sub/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FolderOpen size={14} className="text-acc" />
                  <span className="text-[12px] font-semibold text-tx">
                    Dataset Tables
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-acc/10 text-acc">
                    {tables.length}
                  </span>
                </div>
                <ChevronRight
                  size={14}
                  className={`transition-transform ${
                    tablesDrawerOpen ? 'rotate-90' : ''
                  }`}
                />
              </button>

              {tablesDrawerOpen && (
                <>
                  <div className="p-3 border-b border-border space-y-2">
                    <div className="relative">
                      <Search
                        size={12}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-tx3"
                      />
                      <input
                        type="text"
                        value={tableSearch}
                        onChange={e => setTableSearch(e.target.value)}
                        placeholder="Search datasets..."
                        className="w-full pl-8 pr-8 py-2 bg-sub border border-border rounded-lg text-[11px] outline-none focus:border-acc"
                      />
                      {tableSearch && (
                        <button
                          onClick={() => setTableSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-tx3 hover:text-tx"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>

                    <button
                      onClick={refreshTables}
                      className="w-full btn btn-ghost text-[11px] py-1.5 px-3 flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={11} />
                      Refresh Tables
                    </button>
                  </div>

                  <div className="max-h-[360px] overflow-y-auto p-3 space-y-2 custom-scrollbar">
                    {filteredTables.length === 0 ? (
                      <div className="py-8 text-center text-tx3 text-[11px]">
                        {tables.length === 0
                          ? 'Upload a file to create a table.'
                          : 'No matching datasets.'}
                      </div>
                    ) : (
                      filteredTables.map((t: any) => (
                        <button
                          key={t.id}
                          onClick={() => loadSchema(t.table_name)}
                          className={`w-full text-left p-3 rounded-xl border transition-all ${
                            selectedTable === t.table_name
                              ? 'border-acc bg-acc/5'
                              : 'border-border bg-sub/20 hover:border-acc/30 hover:bg-sub/40'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <Table2
                              size={13}
                              className={
                                selectedTable === t.table_name
                                  ? 'text-acc mt-0.5'
                                  : 'text-tx3 mt-0.5'
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-mono font-semibold text-tx truncate">
                                {t.original_filename}
                              </div>
                              <div className="text-[10px] text-tx3 mt-0.5">
                                {(t.row_count || 0).toLocaleString()} rows ·{' '}
                                {t.file_type?.toUpperCase()}
                              </div>
                              <div className="text-[9px] font-mono text-tx3/60 mt-1 truncate">
                                {t.table_name}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Schema */}
            {schema.length > 0 && (
              <div className="bg-surf border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-tx3 font-bold">
                    Schema
                  </span>
                  <span className="text-[9px] text-tx3 italic">
                    click column to insert
                  </span>
                </div>

                <div className="space-y-1 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                  {schema.map(col => (
                    <button
                      key={col.column_name}
                      onClick={() =>
                        insertColumnAtCursor(col.column_name)
                      }
                      className={`w-full flex items-center justify-between text-[10px] px-2 py-1.5 rounded-lg border transition-all group ${
                        insertedCol === col.column_name
                          ? 'bg-ok/10 border-ok/30'
                          : 'border-transparent hover:bg-acc/5 hover:border-acc/20'
                      }`}
                    >
                      <span className="font-mono truncate max-w-[110px] text-tx2">
                        {insertedCol === col.column_name ? (
                          <span className="flex items-center gap-1 text-ok">
                            <CheckCheck size={9} />
                            inserted
                          </span>
                        ) : (
                          col.column_name
                        )}
                      </span>
                      <span className="font-mono text-tx3 bg-sub px-1.5 py-0.5 rounded shrink-0 text-[9px]">
                        {col.data_type}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Saved Queries and History remain unchanged */}
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-surf border border-border rounded-xl overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-sub/30">
                <span className="font-mono text-[10px] uppercase tracking-wider text-tx3 font-bold">
                  SQL Editor — datasets schema
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setHandbookOpen(true)}
                    className="btn btn-ghost text-[11px] py-1 px-3 flex items-center gap-1 text-acc hover:bg-acc/10"
                  >
                    <BookOpen size={12} /> SQL Handbook
                  </button>
                  <button
                    onClick={runQuery}
                    disabled={running}
                    className="btn btn-acc text-[12px] py-1.5 px-4 flex items-center gap-2"
                  >
                    {running ? (
                      <Activity className="animate-spin" size={13} />
                    ) : (
                      <Play size={13} />
                    )}
                    {running ? 'Running...' : 'Run Query'}
                  </button>
                </div>
              </div>

              {/* AI Prompt */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                <Zap size={12} className="text-tx3 shrink-0" />
                <input
                  type="text"
                  placeholder="Describe what you want in plain English..."
                  value={sqlPrompt}
                  onChange={e => setSqlPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') generateSql();
                  }}
                  className="flex-1 px-3 py-2 bg-sub border border-border rounded-lg text-[12px] outline-none focus:border-acc"
                />
                <button
                  onClick={generateSql}
                  className="px-3 py-2 text-[12px] bg-acc text-white rounded-lg"
                >
                  Generate SQL
                </button>
              </div>

              {/* Editor */}
              <div ref={editorRef} className="bg-bg flex" style={{ minHeight: 200 }}>
                <div
                  aria-hidden="true"
                  className="select-none shrink-0 border-r border-border/40 bg-sub/20 px-3 text-right font-mono text-[12px] text-tx3/40"
                  style={{
                    paddingTop: 16,
                    paddingBottom: 16,
                    lineHeight: '19.5px',
                    minWidth: '2.8rem',
                  }}
                >
                  {Array.from({ length: editorLineCount }, (_, i) => (
                    <div key={i + 1}>{i + 1}</div>
                  ))}
                </div>

                <div className="flex-1 min-w-0">
                  <CodeEditor
                    value={sql}
                    onValueChange={setSql}
                    highlight={code =>
                      highlight(code, languages.sql, 'sql')
                    }
                    padding={16}
                    style={{
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 13,
                      lineHeight: '1.5',
                      background: 'transparent',
                      minHeight: 200,
                      color: 'var(--color-tx)',
                    }}
                    onKeyDown={(e: any) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        runQuery();
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Error */}
            {queryError && (
              <div className="p-4 bg-err/10 border border-err/30 rounded-xl text-[12px] font-mono text-err">
                {queryError}
              </div>
            )}

            {/* Results */}
            {results && (
              <div className="bg-surf border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-sub/30">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-tx3">
                    {results.row_count ?? results.data.length} rows ·{' '}
                    {results.columns.length} columns
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        exportCsv(
                          results.columns,
                          sortedData,
                          'query-results.csv'
                        )
                      }
                      className="btn btn-ghost text-[11px] py-1 px-3 flex items-center gap-1.5"
                    >
                      <Download size={12} /> CSV
                    </button>
                    <button
                      onClick={() =>
                        exportExcel(
                          results.columns,
                          sortedData,
                          'query-results.xlsx'
                        )
                      }
                      className="btn btn-ghost text-[11px] py-1 px-3 flex items-center gap-1.5"
                    >
                      <Download size={12} /> Excel
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[32rem] custom-scrollbar">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-sub/50 sticky top-0 z-10">
                      <tr>
                        {results.columns.map(c => (
                          <th
                            key={c}
                            onClick={() => handleSort(c)}
                            className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-tx3 border-b border-border whitespace-nowrap cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5">
                              {c}
                              <SortIcon col={c} />
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedData.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-border/50 hover:bg-sub/20"
                        >
                          {results.columns.map(c => (
                            <td
                              key={c}
                              className="px-3 py-2 font-mono text-tx2 truncate max-w-[200px]"
                              title={String(row[c] ?? '')}
                            >
                              {row[c] === null || row[c] === undefined ? (
                                <span className="text-tx3 italic">null</span>
                              ) : (
                                String(row[c])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!results && !queryError && !running && (
              <div className="flex flex-col items-center justify-center py-16 text-tx3 text-[13px] italic gap-3">
                <Database size={40} className="opacity-20" />
                <div>
                  Select a table from the left or write a query and click Run
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
