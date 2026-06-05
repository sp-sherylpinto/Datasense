import { useState } from 'react';
import {
  GitCompare, ChevronDown, CheckCircle2, XCircle,
  AlertCircle, ArrowRight, FileText, Rows, Columns,
  TrendingUp, TrendingDown, Minus, RefreshCw
} from 'lucide-react';
import { api } from '../lib/api';
import type { FileMetadata, SavedDataset } from '../lib/types';

interface Props {
  file: FileMetadata;
  savedDatasets: SavedDataset[];
}

interface CompareResult {
  datasetA: { name: string; rows: number; cols: string[] };
  datasetB: { name: string; rows: number; cols: string[] };
  onlyInA: string[];
  onlyInB: string[];
  common: string[];
  rowDiff: number;
  rowDiffPct: number;
  columnStats: Array<{
    col: string;
    typeA: string;
    typeB: string;
    typeMismatch: boolean;
    nullPctA?: number;
    nullPctB?: number;
  }>;
}

/** Normalise column name for comparison: lowercase + underscores */
const norm = (s: string) =>
  s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '_');

/**
 * Safely parse columns from API response.
 * The API may return columns as:
 *   1. Already-parsed array of objects: [{name: "invoice_number", ...}]
 *   2. JSON string:                     "[{\"name\": \"invoice_number\", ...}]"
 *   3. Array of plain strings:          ["invoice_number", ...]
 *   4. null / undefined
 * Returns always: string[] of column names
 */
const parseColumns = (raw: any): string[] => {
  if (!raw) return [];

  // If it's a string, try to JSON.parse it first
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // plain comma-separated? unlikely but handle
      return raw.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.map((c: any) => {
    if (typeof c === 'string') return c;
    if (c && typeof c === 'object') return c.name || c.original_name || '';
    return '';
  }).filter(Boolean);
};

/**
 * Safely parse column metadata (for type & null_pct lookup).
 * Returns array of {name, inferred_type, null_pct} objects.
 */
const parseMeta = (raw: any): Array<{name: string; inferred_type?: string; user_type?: string; null_pct?: number}> => {
  if (!raw) return [];

  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.filter((c: any) => c && typeof c === 'object');
};

export const CompareTab = ({ file, savedDatasets }: Props) => {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const otherDatasets = savedDatasets.filter(d => d.id !== file.dataset_id);
  const selectedDataset = otherDatasets.find(d => d.id === selectedDatasetId);

  const runCompare = async () => {
    if (!selectedDatasetId || !file.dataset_id) return;
    setComparing(true);
    setError(null);
    setResult(null);

    try {
      // Fetch BOTH datasets from API to get full metadata including inferred_type
      // file.columnMeta may be empty if loaded fresh — API always has the full data
      const [dsARes, dsBRes] = await Promise.all([
        file.dataset_id ? api.get(`/datasets/${file.dataset_id}`) : Promise.resolve({ data: null }),
        api.get(`/datasets/${selectedDatasetId}`),
      ]);
      const dsA = dsARes.data;
      const dsB = dsBRes.data;

      // ── Safely extract column NAME lists ────────────────────────────────
      // Dataset A: prefer API columns, fall back to file.columns
      const colsA: string[] = dsA?.columns
        ? parseColumns(dsA.columns)
        : Array.isArray(file.columns) ? file.columns : [];

      // Dataset B: columns from API
      const colsB: string[] = parseColumns(dsB.columns);

      // ── Normalised maps for comparison ──────────────────────────────────
      const normA = new Map<string, string>(); // normKey → original name in A
      const normB = new Map<string, string>(); // normKey → original name in B
      colsA.forEach(c => normA.set(norm(c), c));
      colsB.forEach(c => normB.set(norm(c), c));

      const onlyInA = colsA.filter(c => !normB.has(norm(c)));
      const onlyInB = colsB.filter(c => !normA.has(norm(c)));
      const common  = colsA.filter(c =>  normB.has(norm(c)));

      const rowsA = file.row_count ?? file.row_count_approx ?? 0;
      const rowsB = dsB.row_count ?? 0;
      const rowDiff = rowsB - rowsA;
      const rowDiffPct = rowsA > 0 ? Math.round((rowDiff / rowsA) * 100) : 0;

      // ── Safely extract metadata for type & null_pct ─────────────────────
      // Use API data for both — guaranteed to have inferred_type
      const metaA = parseMeta(dsA?.columns ?? file.columnMeta);
      const metaB = parseMeta(dsB.columns);

      // Build a norm-keyed lookup map for fast access
      // This handles any case-sensitivity or spacing differences in column names
      const typeMapA = new Map<string, string>();
      const nullMapA = new Map<string, number>();
      metaA.forEach((m: any) => {
        const key = norm(m?.name || '');
        if (key) {
          typeMapA.set(key, m?.user_type || m?.inferred_type || 'unknown');
          if (m?.null_pct != null) nullMapA.set(key, m.null_pct);
        }
      });

      const typeMapB = new Map<string, string>();
      const nullMapB = new Map<string, number>();
      metaB.forEach((m: any) => {
        const key = norm(m?.name || '');
        if (key) {
          typeMapB.set(key, m?.user_type || m?.inferred_type || 'unknown');
          if (m?.null_pct != null) nullMapB.set(key, m.null_pct);
        }
      });

      const columnStats = common.map(col => {
        const key = norm(col);
        const typeA = typeMapA.get(key) || 'unknown';
        const typeB = typeMapB.get(key) || 'unknown';
        return {
          col,
          typeA,
          typeB,
          typeMismatch: typeA !== typeB && typeA !== 'unknown' && typeB !== 'unknown',
          nullPctA: nullMapA.get(norm(col)),
          nullPctB: nullMapB.get(norm(col)),
        };
      });

      setResult({
        datasetA: { name: file.name, rows: rowsA, cols: colsA },
        datasetB: { name: dsB.original_filename, rows: rowsB, cols: colsB },
        onlyInA,
        onlyInB,
        common,
        rowDiff,
        rowDiffPct,
        columnStats,
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to load dataset for comparison.');
    } finally {
      setComparing(false);
    }
  };

  const rowDiffColor = (diff: number) =>
    diff === 0 ? 'text-tx2' : diff > 0 ? 'text-ok' : 'text-err';

  const rowDiffIcon = (diff: number) =>
    diff === 0 ? <Minus size={14} /> : diff > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="bg-surf border border-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-1">
          <GitCompare size={20} className="text-acc" />
          <h2 className="text-[15px] font-semibold text-tx">Dataset Comparison</h2>
        </div>
        <p className="text-[12px] text-tx3 ml-8">
          Compare the currently loaded dataset against any other dataset in your library.
          Find column differences, row count changes, and type mismatches instantly.
        </p>
      </div>

      {/* Selection row */}
      <div className="bg-surf border border-border rounded-2xl p-5">
        <div className="flex flex-wrap gap-4 items-end">

          {/* Dataset A */}
          <div className="flex-1 min-w-[200px] space-y-1.5">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              Dataset A (Current)
            </label>
            <div className="w-full bg-sub border border-border rounded-lg px-3 py-2 text-[12px] text-tx flex items-center gap-2">
              <FileText size={13} className="text-acc flex-shrink-0" />
              <span className="truncate font-medium">{file.name}</span>
              <span className="ml-auto text-tx3 text-[11px] font-mono whitespace-nowrap">
                {(file.row_count ?? 0).toLocaleString()} rows
              </span>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex-shrink-0 pb-2">
            <ArrowRight size={18} className="text-tx3" />
          </div>

          {/* Dataset B */}
          <div className="flex-1 min-w-[200px] space-y-1.5 relative">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              Dataset B (Compare With)
            </label>
            <button
              onClick={() => setDropdownOpen(o => !o)}
              className={`w-full flex items-center justify-between bg-sub border rounded-lg px-3 py-2 text-[12px] transition-all ${
                selectedDatasetId ? 'border-acc text-tx' : 'border-border text-tx3 hover:border-acc'
              }`}
            >
              <span className="truncate">
                {selectedDataset
                  ? selectedDataset.original_filename
                  : otherDatasets.length === 0
                  ? 'No other datasets available'
                  : 'Select a dataset...'}
              </span>
              <ChevronDown size={13} className={`flex-shrink-0 ml-1 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && otherDatasets.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-surf border border-border rounded-xl shadow-xl z-50 overflow-hidden max-h-60 overflow-y-auto">
                {otherDatasets.map(ds => (
                  <button
                    key={ds.id}
                    onClick={() => {
                      setSelectedDatasetId(ds.id);
                      setDropdownOpen(false);
                      setResult(null);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-[12px] hover:bg-sub transition-colors flex items-center justify-between gap-3 ${
                      ds.id === selectedDatasetId ? 'bg-acc/10 text-acc' : 'text-tx'
                    }`}
                  >
                    <span className="truncate">{ds.original_filename}</span>
                    <span className="text-[11px] text-tx3 font-mono whitespace-nowrap flex-shrink-0">
                      {(ds.row_count ?? 0).toLocaleString()} rows
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compare button */}
          <button
            onClick={runCompare}
            disabled={!selectedDatasetId || comparing}
            className="btn btn-acc px-5 py-2 text-[12px] flex items-center gap-2 disabled:opacity-50 flex-shrink-0"
          >
            {comparing
              ? <><RefreshCw size={14} className="animate-spin" /> Comparing...</>
              : <><GitCompare size={14} /> Compare</>}
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 text-err text-[12px] bg-err/5 border border-err/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surf border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-tx3 text-[11px] font-mono mb-1">
                <Rows size={12} /> ROWS — A
              </div>
              <div className="text-[22px] font-bold text-tx">{result.datasetA.rows.toLocaleString()}</div>
              <div className="text-[11px] text-tx3 truncate mt-0.5">{result.datasetA.name}</div>
            </div>

            <div className="bg-surf border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-tx3 text-[11px] font-mono mb-1">
                <Rows size={12} /> ROWS — B
              </div>
              <div className="text-[22px] font-bold text-tx">{result.datasetB.rows.toLocaleString()}</div>
              <div className="text-[11px] text-tx3 truncate mt-0.5">{result.datasetB.name}</div>
            </div>

            <div className="bg-surf border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-tx3 text-[11px] font-mono mb-1">
                <TrendingUp size={12} /> ROW DIFF
              </div>
              <div className={`text-[22px] font-bold flex items-center gap-1 ${rowDiffColor(result.rowDiff)}`}>
                {rowDiffIcon(result.rowDiff)}
                {result.rowDiff > 0 ? '+' : ''}{result.rowDiff.toLocaleString()}
              </div>
              <div className="text-[11px] text-tx3 mt-0.5">
                {result.rowDiff === 0 ? 'Same row count' : `${Math.abs(result.rowDiffPct)}% ${result.rowDiff > 0 ? 'more' : 'fewer'} in B`}
              </div>
            </div>

            <div className="bg-surf border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-tx3 text-[11px] font-mono mb-1">
                <Columns size={12} /> COMMON COLS
              </div>
              <div className="text-[22px] font-bold text-tx">{result.common.length}</div>
              <div className="text-[11px] text-tx3 mt-0.5">
                of {result.datasetA.cols.length} / {result.datasetB.cols.length} total
              </div>
            </div>
          </div>

          {/* Column differences */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-surf border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-acc flex-shrink-0" />
                <span className="text-[12px] font-semibold text-tx">Only in Dataset A</span>
                <span className="ml-auto text-[11px] font-mono text-tx3 bg-sub px-2 py-0.5 rounded-full">
                  {result.onlyInA.length}
                </span>
              </div>
              {result.onlyInA.length === 0 ? (
                <p className="text-[11px] text-tx3 italic">No unique columns</p>
              ) : (
                <div className="space-y-1">
                  {result.onlyInA.map(col => (
                    <div key={col} className="flex items-center gap-2 text-[12px] text-tx bg-acc/5 border border-acc/15 rounded-lg px-3 py-1.5">
                      <XCircle size={12} className="text-acc flex-shrink-0" />
                      <span className="font-mono">{col}</span>
                      <span className="ml-auto text-[10px] text-tx3">missing in B</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-surf border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-warn flex-shrink-0" />
                <span className="text-[12px] font-semibold text-tx">Only in Dataset B</span>
                <span className="ml-auto text-[11px] font-mono text-tx3 bg-sub px-2 py-0.5 rounded-full">
                  {result.onlyInB.length}
                </span>
              </div>
              {result.onlyInB.length === 0 ? (
                <p className="text-[11px] text-tx3 italic">No unique columns</p>
              ) : (
                <div className="space-y-1">
                  {result.onlyInB.map(col => (
                    <div key={col} className="flex items-center gap-2 text-[12px] text-tx bg-warn/5 border border-warn/15 rounded-lg px-3 py-1.5">
                      <XCircle size={12} className="text-warn flex-shrink-0" />
                      <span className="font-mono">{col}</span>
                      <span className="ml-auto text-[10px] text-tx3">new in B</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Common column detail table */}
          {result.common.length > 0 && (
            <div className="bg-surf border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <CheckCircle2 size={15} className="text-ok" />
                <span className="text-[13px] font-semibold text-tx">Common Columns Detail</span>
                <span className="ml-auto text-[11px] text-tx3 font-mono">
                  {result.columnStats.filter(c => c.typeMismatch).length} type mismatch{result.columnStats.filter(c => c.typeMismatch).length !== 1 ? 'es' : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-sub/50 border-b border-border">
                      <th className="text-left px-4 py-2.5 font-mono text-[10px] text-tx3 uppercase tracking-wider">Column</th>
                      <th className="text-left px-4 py-2.5 font-mono text-[10px] text-tx3 uppercase tracking-wider">Type in A</th>
                      <th className="text-left px-4 py-2.5 font-mono text-[10px] text-tx3 uppercase tracking-wider">Type in B</th>
                      <th className="text-left px-4 py-2.5 font-mono text-[10px] text-tx3 uppercase tracking-wider">Null% A</th>
                      <th className="text-left px-4 py-2.5 font-mono text-[10px] text-tx3 uppercase tracking-wider">Null% B</th>
                      <th className="text-left px-4 py-2.5 font-mono text-[10px] text-tx3 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.columnStats.map(stat => (
                      <tr key={stat.col} className={`hover:bg-sub/30 transition-colors ${stat.typeMismatch ? 'bg-err/5' : ''}`}>
                        <td className="px-4 py-2.5 font-mono text-tx">{stat.col}</td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded-md bg-acc/10 text-acc text-[11px] font-mono">{stat.typeA}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono ${stat.typeMismatch ? 'bg-err/10 text-err' : 'bg-acc/10 text-acc'}`}>
                            {stat.typeB}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-tx3">{stat.nullPctA != null ? `${stat.nullPctA}%` : '—'}</td>
                        <td className="px-4 py-2.5 text-tx3">{stat.nullPctB != null ? `${stat.nullPctB}%` : '—'}</td>
                        <td className="px-4 py-2.5">
                          {stat.typeMismatch ? (
                            <span className="flex items-center gap-1.5 text-err text-[11px]">
                              <AlertCircle size={11} /> Type mismatch
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-ok text-[11px]">
                              <CheckCircle2 size={11} /> Match
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Verdict */}
          <div className={`rounded-xl border p-4 flex items-start gap-3 ${
            result.onlyInA.length === 0 && result.onlyInB.length === 0
            && result.columnStats.every(c => !c.typeMismatch) && result.rowDiff === 0
              ? 'bg-ok/5 border-ok/20'
              : 'bg-warn/5 border-warn/20'
          }`}>
            {result.onlyInA.length === 0 && result.onlyInB.length === 0
            && result.columnStats.every(c => !c.typeMismatch) && result.rowDiff === 0 ? (
              <>
                <CheckCircle2 size={16} className="text-ok mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[12px] font-semibold text-ok">Datasets are structurally identical</p>
                  <p className="text-[11px] text-tx3 mt-0.5">Same columns, same types, same row count. No differences detected.</p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle size={16} className="text-warn mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[12px] font-semibold text-warn">Differences found</p>
                  <p className="text-[11px] text-tx3 mt-0.5">
                    {[
                      result.onlyInA.length > 0 && `${result.onlyInA.length} column(s) missing in B`,
                      result.onlyInB.length > 0 && `${result.onlyInB.length} new column(s) in B`,
                      result.columnStats.filter(c => c.typeMismatch).length > 0 && `${result.columnStats.filter(c => c.typeMismatch).length} type mismatch(es)`,
                      result.rowDiff !== 0 && `${Math.abs(result.rowDiff).toLocaleString()} row difference`,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </>
            )}
          </div>

        </div>
      )}

      {/* Empty state */}
      {!result && !comparing && !error && (
        <div className="bg-surf border border-border rounded-2xl py-20 text-center">
          <GitCompare size={48} className="mx-auto mb-4 text-tx3 opacity-30" />
          <p className="text-tx3 text-[13px]">Select a dataset above and click Compare</p>
          <p className="text-tx3/60 text-[11px] mt-1">
            Compare columns, row counts, data types and null percentages
          </p>
        </div>
      )}

    </div>
  );
};
