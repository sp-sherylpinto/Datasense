import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BookmarkPlus, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, ChevronsLeft, ChevronsRight, Clock, Columns3, Download, ExternalLink, Eye, EyeOff,
  FileText, Filter, GripVertical, Layers, Loader2, Plus, Settings, Table, Trash2, X, Zap,
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { GuidePanel } from '../components/GuidePanel';
import { api } from '../lib/api';
import type { CoreEngagement } from '../lib/core';
import { exportCsv, exportExcel, formatNumber, validateCell } from '../lib/helpers';
import type { AuditArea, FileMetadata, FilterOp, FilterSpec, SavedView } from '../lib/types';

interface Props {
  file: FileMetadata;
  columnMappings: Record<string, string>;
  setColumnMappings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  columnRenames: Record<string, string>;
  setColumnRenames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  columnOrder: string[];
  setColumnOrder: React.Dispatch<React.SetStateAction<string[]>>;
  handleCleanData: () => Promise<void>;
  cleaning: boolean;
  auditAreas: AuditArea[];
  engagement: CoreEngagement | null;
}

const NUMERIC_TYPES = new Set(['number', 'currency']);

// Format INR with lakh/crore commas — matches what auditors expect.
const formatINR = (n: number): string =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const toNumber = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Operator catalogue + per-type gating ──────────────────────────────────

const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'equals',
  not_equals: 'not equals',
  regex: 'matches regex',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

const OPS_BY_TYPE: Record<string, FilterOp[]> = {
  text:     ['contains', 'not_contains', 'equals', 'not_equals', 'regex', 'is_empty', 'is_not_empty'],
  number:   ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  currency: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  date:     ['equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  datetime: ['equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  boolean:  ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
};

const OPS_NEED_VALUE: Set<FilterOp> = new Set([
  'contains', 'not_contains', 'equals', 'not_equals', 'regex',
  'gt', 'gte', 'lt', 'lte', 'between',
]);

const OPS_NEED_VALUE2: Set<FilterOp> = new Set(['between']);

// ─── SQL builder for filter stack ───────────────────────────────────────────

const escSql = (v: string) => v.replace(/'/g, "''");

const parseNum = (v?: string): number | null => {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const isValidIsoDate = (v?: string): boolean => {
  if (!v) return false;
  const d = new Date(v);
  return Number.isFinite(d.getTime());
};

function clauseFor(f: FilterSpec, type: string): string | null {
  const col = `"${f.column}"`;
  const textCol = `CAST(${col} AS VARCHAR)`;
  const isNumeric = type === 'number' || type === 'currency';
  const isDate = type === 'date' || type === 'datetime';

  if (f.op === 'is_empty') return `(${col} IS NULL OR ${textCol} = '')`;
  if (f.op === 'is_not_empty') return `(${col} IS NOT NULL AND ${textCol} <> '')`;

  if (OPS_NEED_VALUE.has(f.op) && (f.value == null || f.value === '')) return null;
  if (OPS_NEED_VALUE2.has(f.op) && (f.value2 == null || f.value2 === '')) return null;

  if (f.op === 'contains') return `${textCol} ILIKE '%${escSql(f.value!)}%'`;
  if (f.op === 'not_contains') return `${textCol} NOT ILIKE '%${escSql(f.value!)}%'`;
  if (f.op === 'regex') return `${textCol} ~ '${escSql(f.value!)}'`;

  if (f.op === 'equals') {
    if (isNumeric) {
      const n = parseNum(f.value); if (n == null) return null;
      return `(${col})::numeric = ${n}`;
    }
    if (isDate && isValidIsoDate(f.value)) return `(${col})::timestamp = '${escSql(f.value!)}'::timestamp`;
    return `${textCol} = '${escSql(f.value!)}'`;
  }
  if (f.op === 'not_equals') {
    if (isNumeric) {
      const n = parseNum(f.value); if (n == null) return null;
      return `(${col})::numeric <> ${n}`;
    }
    if (isDate && isValidIsoDate(f.value)) return `(${col})::timestamp <> '${escSql(f.value!)}'::timestamp`;
    return `${textCol} <> '${escSql(f.value!)}'`;
  }
  if (f.op === 'gt' || f.op === 'gte' || f.op === 'lt' || f.op === 'lte') {
    const sym = f.op === 'gt' ? '>' : f.op === 'gte' ? '>=' : f.op === 'lt' ? '<' : '<=';
    if (isDate && isValidIsoDate(f.value)) return `(${col})::timestamp ${sym} '${escSql(f.value!)}'::timestamp`;
    const n = parseNum(f.value); if (n == null) return null;
    return `(${col})::numeric ${sym} ${n}`;
  }
  if (f.op === 'between') {
    if (isDate && isValidIsoDate(f.value) && isValidIsoDate(f.value2)) {
      return `(${col})::timestamp BETWEEN '${escSql(f.value!)}'::timestamp AND '${escSql(f.value2!)}'::timestamp`;
    }
    const a = parseNum(f.value); const b = parseNum(f.value2);
    if (a == null || b == null) return null;
    return `(${col})::numeric BETWEEN ${a} AND ${b}`;
  }
  return null;
}

function buildWhere(filters: FilterSpec[], colTypes: Record<string, string>): string {
  const parts = filters
    .map(f => clauseFor(f, colTypes[f.column] || 'text'))
    .filter((c): c is string => Boolean(c));
  return parts.length === 0 ? '' : ' WHERE ' + parts.join(' AND ');
}

const filterIsComplete = (f: FilterSpec): boolean => {
  if (!f.column) return false;
  if (f.op === 'is_empty' || f.op === 'is_not_empty') return true;
  if (OPS_NEED_VALUE2.has(f.op)) return Boolean(f.value && f.value2);
  if (OPS_NEED_VALUE.has(f.op)) return Boolean(f.value);
  return false;
};

const filtersEqual = (a: FilterSpec[], b: FilterSpec[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].column !== b[i].column) return false;
    if (a[i].op !== b[i].op) return false;
    if ((a[i].value || '') !== (b[i].value || '')) return false;
    if ((a[i].value2 || '') !== (b[i].value2 || '')) return false;
  }
  return true;
};

export const DataViewTab = ({
  file,
  columnMappings, setColumnMappings,
  columnRenames, setColumnRenames,
  columnOrder, setColumnOrder,
  handleCleanData, cleaning,
  auditAreas,
  engagement,
}: Props) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filters, setFilters] = useState<FilterSpec[]>([]);
  const [debouncedFilters, setDebouncedFilters] = useState<FilterSpec[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const [viewColumns, setViewColumns] = useState<string[] | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<SavedView | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveAreaCode, setSaveAreaCode] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const viewsRef = useRef<HTMLDivElement>(null);

  // Filter Memory
  const [showFilterLibrary, setShowFilterLibrary] = useState(false);
  const [savedFilters, setSavedFilters] = useState<any[]>([]);
  const [suggestedFilters, setSuggestedFilters] = useState<any[]>([]);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const whereClause = useMemo(
    () => buildWhere(debouncedFilters, columnMappings),
    [debouncedFilters, columnMappings]
  );
  const filterActive = whereClause.length > 0;

  const effectiveColumns = useMemo(() => {
    if (!viewColumns) return columnOrder;
    const inDataset = new Set(columnOrder);
    return viewColumns.filter(c => inDataset.has(c));
  }, [viewColumns, columnOrder]);
  const columnsHidden = viewColumns
    ? Math.max(0, columnOrder.length - effectiveColumns.length)
    : 0;

  const viewDirty = useMemo(() => {
    if (!currentView) return false;
    if (!filtersEqual(filters, currentView.filters || [])) return true;
    const cvSort = currentView.sort;
    if (!cvSort && (sortBy || sortOrder !== 'asc')) return true;
    if (cvSort && (cvSort.column !== sortBy || cvSort.direction !== sortOrder)) return true;
    const cvCols = currentView.columns || null;
    const a = cvCols ? cvCols.join('|') : '';
    const b = viewColumns ? viewColumns.join('|') : '';
    if (a !== b) return true;
    return false;
  }, [filters, sortBy, sortOrder, currentView, viewColumns]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node)) {
        setViewsOpen(false);
      }
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) {
        setColumnsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchAllRows = async (useFilter: boolean): Promise<any[]> => {
    const tableName = (file as any)?.table_name;
    const orderClause = sortBy ? ` ORDER BY "${sortBy}" ${sortOrder}` : '';
    if (tableName) {
      const where = useFilter ? whereClause : '';
      const sql = `SELECT * FROM ${tableName}${where}${orderClause}`;
      const res = await api.post('/workbench/query', { sql });
      return res.data.data || [];
    }
    const f0 = useFilter ? debouncedFilters.find(filterIsComplete) : undefined;
    const res = await api.get('/data', {
      params: {
        file_path: file.file_path,
        limit: 10_000_000,
        offset: 0,
        sort_by: sortBy,
        sort_order: sortOrder,
        filter_col: f0 ? f0.column : undefined,
        filter_val: f0 ? (f0.value || '') : undefined,
        filter_regex: f0 ? f0.op === 'regex' : false,
      },
    });
    return res.data.data || [];
  };

  const runExport = async (format: 'csv' | 'xlsx', useFilter: boolean) => {
    const key = `${format}-${useFilter ? 'filtered' : 'all'}`;
    setExporting(key);
    setExportMenuOpen(false);
    try {
      const rows = await fetchAllRows(useFilter);
      const headers = effectiveColumns.map(c => columnRenames[c] || c);
      const renamed = rows.map(row => {
        const out: Record<string, any> = {};
        effectiveColumns.forEach(col => {
          out[columnRenames[col] || col] = row[col];
        });
        return out;
      });
      const baseName = (file.name || 'dataset').replace(/\.[^/.]+$/, '');
      const suffix = useFilter ? '-filtered' : '';
      const filename = `${baseName}${suffix}.${format}`;
      if (format === 'csv') exportCsv(headers, renamed, filename);
      else exportExcel(headers, renamed, filename);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(null);
    }
  };

  const columnsWithErrors = useMemo(() => {
    const errors = new Set<string>();
    data.forEach(row => {
      effectiveColumns.forEach(col => {
        if (!validateCell(row[col], columnMappings[col] || 'text')) {
          errors.add(col);
        }
      });
    });
    return errors;
  }, [data, effectiveColumns, columnMappings]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const tableName = (file as any)?.table_name;
        if (tableName) {
          const orderClause = sortBy ? ` ORDER BY "${sortBy}" ${sortOrder}` : '';
          const sql = `SELECT * FROM ${tableName}${whereClause}${orderClause} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
          const countSql = `SELECT COUNT(*) AS cnt FROM ${tableName}${whereClause}`;
          const [dataRes, countRes] = await Promise.all([
            api.post('/workbench/query', { sql }),
            api.post('/workbench/query', { sql: countSql }),
          ]);
          setData(dataRes.data.data || []);
          setTotalCount(countRes.data.data?.[0]?.cnt || 0);
        } else {
          const f0 = debouncedFilters.find(filterIsComplete);
          const res = await api.get('/data', {
            params: {
              file_path: file.file_path,
              limit: pageSize,
              offset: (page - 1) * pageSize,
              sort_by: sortBy,
              sort_order: sortOrder,
              filter_col: f0 ? f0.column : undefined,
              filter_val: f0 ? (f0.value || '') : undefined,
              filter_regex: f0 ? f0.op === 'regex' : false,
            },
          });
          setData(res.data.data || []);
          setTotalCount(res.data.total_count || 0);
        }
      } catch (err) {
        console.error('Failed to fetch data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [file.file_path, (file as any)?.table_name, page, sortBy, sortOrder, debouncedFilters, whereClause, pageSize]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/views');
        if (!cancelled) setSavedViews(r.data || []);
      } catch (err) {
        if (!file.dataset_id) { setSavedViews([]); return; }
        try {
          const r2 = await api.get(`/datasets/${file.dataset_id}/views`);
          if (!cancelled) setSavedViews(r2.data || []);
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [file.dataset_id]);

  useEffect(() => {
    setFilters([]);
    setDebouncedFilters([]);
    setCurrentView(null);
    setSortBy(null);
    setSortOrder('asc');
    setViewColumns(null);
    setSavedFilters([]);
    setSuggestedFilters([]);
    if (!file.dataset_id) return;
    loadSavedFilters();
    loadFilterSuggestions();
  }, [file.dataset_id]);

  const firstNumericColumn = useMemo(() => {
    return columnOrder.find(c => NUMERIC_TYPES.has(columnMappings[c] || 'text')) || null;
  }, [columnOrder, columnMappings]);

  const performanceMateriality = useMemo(() => toNumber(engagement?.materiality_performance), [engagement]);
  const overallMateriality     = useMemo(() => toNumber(engagement?.materiality_planning),    [engagement]);

  const addFilter = () => {
    const firstCol = columnOrder[0] || '';
    const type = columnMappings[firstCol] || 'text';
    const ops = OPS_BY_TYPE[type] || OPS_BY_TYPE.text;
    setFilters(prev => [...prev, { column: firstCol, op: ops[0], value: '' }]);
    setShowFilters(true);
  };

  const addNumericThresholdFilter = (op: FilterOp, value: number, _label: string) => {
    if (!firstNumericColumn) return;
    setFilters(prev => [...prev, {
      column: firstNumericColumn,
      op,
      value: String(value),
    }]);
    setShowFilters(true);
  };
  const updateFilter = (i: number, patch: Partial<FilterSpec>) => {
    setFilters(prev => prev.map((f, idx) => {
      if (idx !== i) return f;
      const next = { ...f, ...patch };
      if (patch.column && patch.column !== f.column) {
        const t = columnMappings[patch.column] || 'text';
        const ops = OPS_BY_TYPE[t] || OPS_BY_TYPE.text;
        if (!ops.includes(next.op)) next.op = ops[0];
      }
      return next;
    }));
  };
  const removeFilter = (i: number) => {
    setFilters(prev => prev.filter((_, idx) => idx !== i));
  };
  const clearAllFilters = () => {
    setFilters([]);
    setCurrentView(null);
    setViewColumns(null);
  };

  const toggleColumn = (col: string) => {
    setViewColumns(prev => {
      const current = prev ?? [...columnOrder];
      if (current.includes(col)) {
        return current.filter(c => c !== col);
      }
      const next = [...current, col];
      return columnOrder.filter(c => next.includes(c));
    });
  };
  const showAllColumns = () => setViewColumns(null);
  const hideAllColumns = () => setViewColumns([]);

  const loadView = (v: SavedView) => {
    setFilters(v.filters || []);
    if (v.sort) {
      setSortBy(v.sort.column);
      setSortOrder(v.sort.direction);
    } else {
      setSortBy(null);
      setSortOrder('asc');
    }
    setViewColumns(v.columns ?? null);
    setCurrentView(v);
    setViewsOpen(false);
    setPage(1);
    setShowFilters((v.filters || []).length > 0);
  };

  const openSaveModal = () => {
    setSaveName('');
    setSaveDescription('');
    setSaveAreaCode(file.audit_area_code || '');
    setSaveModalOpen(true);
  };

  const saveAsNewView = async () => {
    if (!file.dataset_id || !saveName.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        name: saveName.trim(),
        filters: filters.filter(filterIsComplete),
        sort: sortBy ? { column: sortBy, direction: sortOrder } : null,
        columns: viewColumns,
      };
      if (saveDescription.trim()) payload.description = saveDescription.trim();
      if (saveAreaCode) payload.audit_area_code = saveAreaCode;
      const r = await api.post(`/datasets/${file.dataset_id}/views`, payload);
      const v: SavedView = r.data;
      setSavedViews(prev => [v, ...prev]);
      setCurrentView(v);
      setSaveModalOpen(false);
    } catch (err) {
      console.error('Failed to save view', err);
    } finally {
      setSaving(false);
    }
  };

  const updateCurrentView = async () => {
    if (!currentView) return;
    try {
      const r = await api.patch(`/views/${currentView.id}`, {
        filters: filters.filter(filterIsComplete),
        sort: sortBy ? { column: sortBy, direction: sortOrder } : null,
        columns: viewColumns,
      });
      const v: SavedView = r.data;
      setSavedViews(prev => prev.map(x => x.id === v.id ? v : x));
      setCurrentView(v);
    } catch (err) {
      console.error('Failed to update view', err);
    }
  };

  const deleteView = async (id: string) => {
    try {
      await api.delete(`/views/${id}`);
      setSavedViews(prev => prev.filter(v => v.id !== id));
      if (currentView?.id === id) setCurrentView(null);
    } catch (err) {
      console.error('Failed to delete view', err);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const handleSort = (col: string) => {
    if (sortBy === col) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortOrder('asc'); }
    setPage(1);
  };

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...columnOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;
    setColumnOrder(newOrder);
  };

  // ── Filter Memory ────────────────────────────────────────────────────────

  const loadSavedFilters = async () => {
    try {
      const datasetType = (file as any).dataset_type || 'general';
      const response = await api.get('/filter-templates', {
        params: { dataset_type: datasetType },
      });
      const data = Array.isArray(response.data) ? response.data : response.data?.data || [];
      setSavedFilters(data);
    } catch (error) {
      console.error('Failed to load filters:', error);
      setSavedFilters([]);
    }
  };

  const loadFilterSuggestions = () => {
    if (!(file as any).dataset_id) {
      setSuggestedFilters([]);
      return;
    }
    const cols = file.columns || [];
    const suggestions: any[] = [];
    if (cols.length > 0) {
      suggestions.push({
        name: 'Non-empty rows',
        description: 'Exclude rows with missing values',
        filters: [{ column: cols[0], op: 'is_not_empty', value: '' }]
      });
    }
    setSuggestedFilters(suggestions);
  };

  const applySavedFilter = (template: any) => {
    try {
      if (template.filters && Array.isArray(template.filters)) {
        setFilters(template.filters);
      }
      const sb = template.sortBy ?? template.sort_by ?? null;
      const so = template.sortOrder ?? template.sort_order ?? 'asc';
      const vc = template.viewColumns ?? template.view_columns ?? null;
      if (sb) setSortBy(sb);
      if (so) setSortOrder(so as 'asc' | 'desc');
      if (vc && Array.isArray(vc)) setViewColumns(vc);
      setShowFilterLibrary(false);
      setShowFilters(true);
      setPage(1);
    } catch (error) {
      console.error('Error applying filter:', error);
    }
  };

  const saveFilterAsTemplate = async (name: string, description?: string) => {
    try {
      const completeFilters = filters.filter(filterIsComplete);
      const response = await api.post('/filter-templates', {
        name: name.trim(),
        description: description?.trim() || undefined,
        filters: completeFilters,
        dataset_type: (file as any).dataset_type || 'general',
        sort_by: sortBy || null,
        sort_order: sortOrder || 'asc',
        view_columns: viewColumns,
      });
      const newFilter = response.data?.data ?? response.data;
      if (newFilter) {
        setSavedFilters(prev => [newFilter, ...prev]);
      }
    } catch (error) {
      console.error('Save filter failed:', error);
      throw error;
    }
  };

  return (
    <div className="space-y-5">
      <GuidePanel
        tabId="dataview"
        icon={<Table size={15} />}
        title="Data Explorer"
        description="Browse, sort, and filter your raw dataset row by row. Use this tab to get comfortable with the data structure, spot obvious quality issues, and verify specific records before or after analysis."
        whenToUse={[
          "First look at a newly uploaded dataset — understand what's in it",
          'Verifying specific records flagged by Benford or Anomaly analysis',
          'Checking that column names are correctly mapped after upload',
          'Confirming the data looks right after a cleaning job',
        ]}
        steps={[
          'Data loads automatically when a dataset is active',
          'Click any column header to sort ascending/descending',
          'Use the filter input to search for a specific value',
          'Drag column headers (grip icon) to reorder — this also affects export order',
        ]}
        tip="Look for columns where numbers appear as text (left-aligned), dates in inconsistent formats, or columns with mostly empty cells. These need to be fixed in the Data Source tab before running analyses — garbage in, garbage out."
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surf p-4 rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-acc/10 rounded-lg text-acc">
            <Table size={18} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-tx">Dataset Explorer</div>
            <div className="text-[11px] text-tx3 font-mono uppercase tracking-wider">Total Records: {formatNumber(totalCount)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`btn flex items-center gap-2 text-[12px] ${showConfig ? 'btn-acc' : 'btn-ghost'}`}
          >
            <Settings size={14} />
            {showConfig ? 'Hide Config' : 'Manage Columns'}
          </button>

          <div className="h-6 w-px bg-border mx-1" />

          <button
            onClick={() => { if (filters.length === 0) addFilter(); else setShowFilters(s => !s); }}
            className={`btn flex items-center gap-2 text-[12px] ${filterActive ? 'btn-acc' : 'btn-ghost'}`}
          >
            <Filter size={14} />
            Filters
            {filters.length > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${filterActive ? 'bg-white/20' : 'bg-acc/10 text-acc'}`}>
                {filters.length}
              </span>
            )}
            <ChevronDown size={12} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          <button
            onClick={() => { loadFilterSuggestions(); loadSavedFilters(); setShowFilterLibrary(true); }}
            className="btn btn-ghost flex items-center gap-1.5 text-[12px]"
            title="Quick filters and saved filter templates"
          >
            <Layers size={13} /> Filter Library
            {savedFilters.length > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-acc/10 text-acc">
                {savedFilters.length}
              </span>
            )}
          </button>

          <div ref={columnsRef} className="relative">
            <button
              onClick={() => setColumnsOpen(o => !o)}
              className={`btn flex items-center gap-2 text-[12px] ${columnsHidden > 0 ? 'btn-acc' : 'btn-ghost'}`}
            >
              <Columns3 size={14} />
              Columns
              {columnOrder.length > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${columnsHidden > 0 ? 'bg-white/20' : 'bg-acc/10 text-acc'}`}>
                  {effectiveColumns.length}/{columnOrder.length}
                </span>
              )}
              <ChevronDown size={12} className={`transition-transform ${columnsOpen ? 'rotate-180' : ''}`} />
            </button>
            {columnsOpen && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-tx3 bg-sub/50 border-b border-border flex items-center justify-between">
                  <span>Visible Columns</span>
                  <div className="flex items-center gap-2 normal-case">
                    <button
                      onClick={showAllColumns}
                      className="text-[10px] text-tx3 hover:text-tx flex items-center gap-1"
                    >
                      <Eye size={10} /> All
                    </button>
                    <button
                      onClick={hideAllColumns}
                      className="text-[10px] text-tx3 hover:text-err flex items-center gap-1"
                    >
                      <EyeOff size={10} /> None
                    </button>
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {columnOrder.length === 0 && (
                    <div className="px-4 py-4 text-[11px] text-tx3 italic text-center">No columns</div>
                  )}
                  {columnOrder.map(col => {
                    const visible = effectiveColumns.includes(col);
                    return (
                      <button
                        key={col}
                        onClick={() => toggleColumn(col)}
                        className={`w-full text-left px-3 py-1.5 transition-colors flex items-center gap-2 ${visible ? 'text-tx2 hover:bg-sub/40' : 'text-tx3 hover:bg-sub/40'}`}
                      >
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => {}}
                          className="accent-acc"
                        />
                        <span className="text-[11px] font-mono truncate flex-1">{columnRenames[col] || col}</span>
                      </button>
                    );
                  })}
                </div>
                {columnsHidden > 0 && (
                  <div className="px-4 py-2 text-[10px] font-mono text-tx3 bg-sub/30 border-t border-border">
                    {columnsHidden} hidden · view will save this selection
                  </div>
                )}
              </div>
            )}
          </div>

          <div ref={viewsRef} className="relative">
            <button
              onClick={() => setViewsOpen(o => !o)}
              className={`btn flex items-center gap-2 text-[12px] ${currentView ? 'btn-acc' : 'btn-ghost'}`}
            >
              <Layers size={14} />
              {currentView ? (
                <span className="truncate max-w-[160px]">{currentView.name}{viewDirty ? ' •' : ''}</span>
              ) : 'Views'}
              {savedViews.length > 0 && !currentView && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-acc/10 text-acc">
                  {savedViews.length}
                </span>
              )}
              <ChevronDown size={12} className={`transition-transform ${viewsOpen ? 'rotate-180' : ''}`} />
            </button>
            {viewsOpen && (
              <div className="absolute top-full right-0 mt-2 w-80 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-tx3 bg-sub/50 border-b border-border flex items-center justify-between">
                  <span>Saved Views</span>
                  <span>{savedViews.length}</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {savedViews.length === 0 && (
                    <div className="px-4 py-6 text-[11px] text-tx3 italic text-center">No saved views yet</div>
                  )}
                  {savedViews.map(v => {
                    const isActive = currentView?.id === v.id;
                    return (
                      <div key={v.id} className={`group flex items-start gap-2 px-3 py-2 transition-colors ${isActive ? 'bg-acc/5' : 'hover:bg-sub/40'}`}>
                        <button
                          onClick={() => loadView(v)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            {v.audit_area_code && (
                              <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-acc/10 text-acc">
                                {v.audit_area_code.includes(':') ? v.audit_area_code.split(':')[1] : v.audit_area_code}
                              </span>
                            )}
                            <span className={`text-[12px] font-semibold truncate ${isActive ? 'text-acc' : 'text-tx'}`}>{v.name}</span>
                          </div>
                          {v.description && (
                            <div className="text-[10px] text-tx3 mt-0.5 truncate">{v.description}</div>
                          )}
                          <div className="text-[9px] font-mono text-tx3 mt-0.5">
                            {v.filters?.length || 0} filter{(v.filters?.length || 0) === 1 ? '' : 's'}
                            {v.sort && <> · sorted</>}
                            {v.columns && <> · {v.columns.length} cols</>}
                          </div>
                        </button>
                        <button
                          onClick={() => deleteView(v.id)}
                          title="Delete view"
                          className="p-1 rounded text-tx3 opacity-0 group-hover:opacity-100 hover:text-err hover:bg-err/10 transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-border">
                  <button
                    onClick={() => { setViewsOpen(false); openSaveModal(); }}
                    disabled={!file.dataset_id}
                    className="w-full px-4 py-2.5 text-[12px] text-acc hover:bg-acc/5 text-left flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <BookmarkPlus size={13} /> Save current as view...
                  </button>
                  {currentView && viewDirty && (
                    <button
                      onClick={() => { updateCurrentView(); setViewsOpen(false); }}
                      className="w-full px-4 py-2.5 text-[12px] text-tx2 hover:bg-sub/40 text-left flex items-center gap-2 border-t border-border"
                    >
                      <Activity size={13} /> Update "{currentView.name}"
                    </button>
                  )}
                  {currentView && (
                    <a
                      href={`https://vouch.varma.ai/?import_view=${encodeURIComponent(currentView.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setViewsOpen(false)}
                      className="w-full px-4 py-2.5 text-[12px] text-tx2 hover:bg-sub/40 text-left flex items-center gap-2 border-t border-border"
                    >
                      <ExternalLink size={13} /> Send to VouchPaper...
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-border mx-1" />

          <div ref={exportMenuRef} className="relative">
            <button
              onClick={() => setExportMenuOpen(o => !o)}
              disabled={exporting !== null}
              className={`btn btn-ghost flex items-center gap-2 text-[12px] ${exporting !== null ? 'opacity-60 cursor-wait' : ''}`}
            >
              {exporting !== null ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting !== null ? 'Exporting...' : 'Export'}
              <ChevronDown size={12} className={`transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {exportMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-tx3 bg-sub/50 border-b border-border">
                  All Data ({formatNumber((file as any)?.row_count_approx || totalCount)} rows)
                </div>
                <button onClick={() => runExport('csv', false)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-tx2 hover:bg-sub/60 hover:text-tx transition-colors text-left">
                  <FileText size={14} className="text-tx3" /> CSV
                </button>
                <button onClick={() => runExport('xlsx', false)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-tx2 hover:bg-sub/60 hover:text-tx transition-colors text-left">
                  <Table size={14} className="text-tx3" /> Excel
                </button>
                <div className={`px-4 py-2 text-[10px] font-mono uppercase tracking-wider bg-sub/50 border-b border-t border-border ${filterActive ? 'text-tx3' : 'text-tx3/50'}`}>
                  Filtered Data {filterActive ? `(${formatNumber(totalCount)} rows)` : '(no filter active)'}
                </div>
                <button onClick={() => runExport('csv', true)} disabled={!filterActive} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-tx2 hover:bg-sub/60 hover:text-tx transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                  <FileText size={14} className="text-tx3" /> CSV
                </button>
                <button onClick={() => runExport('xlsx', true)} disabled={!filterActive} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-tx2 hover:bg-sub/60 hover:text-tx transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                  <Table size={14} className="text-tx3" /> Excel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-surf border border-border rounded-xl p-4 shadow-soft space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Filter size={14} className="text-acc" />
                  <h3 className="text-[12px] font-bold text-tx">Filters</h3>
                  <span className="text-[10px] font-mono text-tx3">All conditions are AND-ed together</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {(performanceMateriality !== null || overallMateriality !== null) && (
                    <>
                      <span className="text-[9px] font-mono uppercase tracking-wider text-tx3 ml-1">SA320</span>
                      {performanceMateriality !== null && (
                        <button
                          onClick={() => addNumericThresholdFilter('gt', performanceMateriality, 'PM')}
                          disabled={!firstNumericColumn}
                          title={firstNumericColumn ? `Add filter: ${firstNumericColumn} > ${performanceMateriality}` : 'No numeric column to filter on'}
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-info/10 text-info border border-info/20 hover:bg-info/15 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                          <Plus size={9} /> &gt; PM {formatINR(performanceMateriality)}
                        </button>
                      )}
                      {overallMateriality !== null && (
                        <button
                          onClick={() => addNumericThresholdFilter('gt', overallMateriality, 'OM')}
                          disabled={!firstNumericColumn}
                          title={firstNumericColumn ? `Add filter: ${firstNumericColumn} > ${overallMateriality}` : 'No numeric column to filter on'}
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-acc/10 text-acc border border-acc/30 hover:bg-acc/15 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                          <Plus size={9} /> &gt; OM {formatINR(overallMateriality)}
                        </button>
                      )}
                      <span className="h-4 w-px bg-border mx-1" />
                    </>
                  )}
                  {filters.length > 0 && (
                    <button onClick={clearAllFilters} className="text-[11px] text-tx3 hover:text-err transition-colors">
                      Clear all
                    </button>
                  )}
                  <button onClick={addFilter} className="btn btn-ghost flex items-center gap-1.5 text-[11px]">
                    <Plus size={12} /> Add filter
                  </button>
                </div>
              </div>

              {filters.length === 0 && (
                <div className="text-[11px] text-tx3 italic py-2">No filters. Click <span className="text-tx2">Add filter</span> to start narrowing the data.</div>
              )}

              {filters.map((f, i) => {
                const t = columnMappings[f.column] || 'text';
                const ops = OPS_BY_TYPE[t] || OPS_BY_TYPE.text;
                const needsValue = OPS_NEED_VALUE.has(f.op);
                const needsValue2 = OPS_NEED_VALUE2.has(f.op);
                const inputType = (t === 'number' || t === 'currency') ? 'number' : (t === 'date' ? 'date' : t === 'datetime' ? 'datetime-local' : 'text');
                return (
                  <div key={i} className="flex items-center gap-2 bg-sub/30 border border-border rounded-lg p-2">
                    <span className="text-[10px] font-mono text-tx3 px-1">{i === 0 ? 'WHERE' : 'AND'}</span>
                    <select
                      value={f.column}
                      onChange={e => updateFilter(i, { column: e.target.value })}
                      className="flex-1 min-w-0 px-2 py-1.5 bg-surf border border-border rounded text-[11px] outline-none focus:border-acc"
                    >
                      {columnOrder.map(c => (
                        <option key={c} value={c}>{columnRenames[c] || c}</option>
                      ))}
                    </select>
                    <select
                      value={f.op}
                      onChange={e => updateFilter(i, { op: e.target.value as FilterOp })}
                      className="px-2 py-1.5 bg-surf border border-border rounded text-[11px] outline-none focus:border-acc"
                    >
                      {ops.map(op => (
                        <option key={op} value={op}>{OP_LABELS[op]}</option>
                      ))}
                    </select>
                    {needsValue && (
                      <input
                        type={inputType}
                        value={f.value || ''}
                        onChange={e => updateFilter(i, { value: e.target.value })}
                        placeholder={f.op === 'regex' ? 'pattern' : 'value'}
                        className="w-40 px-2 py-1.5 bg-surf border border-border rounded text-[11px] outline-none focus:border-acc"
                      />
                    )}
                    {needsValue2 && (
                      <>
                        <span className="text-[10px] font-mono text-tx3">and</span>
                        <input
                          type={inputType}
                          value={f.value2 || ''}
                          onChange={e => updateFilter(i, { value2: e.target.value })}
                          placeholder="value"
                          className="w-40 px-2 py-1.5 bg-surf border border-border rounded text-[11px] outline-none focus:border-acc"
                        />
                      </>
                    )}
                    <button
                      onClick={() => removeFilter(i)}
                      title="Remove filter"
                      className="p-1 rounded text-tx3 hover:text-err hover:bg-err/10 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConfig && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-surf border border-border rounded-xl p-6 shadow-soft space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[14px] font-bold text-tx">Column Configuration</h3>
                  <p className="text-[11px] text-tx3">Rename, reorder, and change data types for your dataset.</p>
                </div>
                <button
                  onClick={handleCleanData}
                  disabled={cleaning}
                  className={`btn btn-acc flex items-center gap-2 ${cleaning ? 'opacity-50 cursor-wait' : ''}`}
                >
                  {cleaning ? <Activity className="animate-spin" size={14} /> : <Zap size={14} />}
                  {cleaning ? 'Processing...' : 'Apply & Clean Dataset'}
                </button>
              </div>

              <Reorder.Group axis="y" values={columnOrder} onReorder={setColumnOrder} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {columnOrder.map((col, index) => (
                  <Reorder.Item key={col} value={col} className="p-4 bg-sub/30 rounded-xl border border-border space-y-3 cursor-grab active:cursor-grabbing">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="text-tx3/40"><GripVertical size={16} /></div>
                        <div className="flex flex-col gap-1">
                          <button onClick={(e) => { e.stopPropagation(); moveColumn(index, 'up'); }} disabled={index === 0} className="p-1 hover:bg-surf rounded disabled:opacity-20"><ArrowUp size={10} /></button>
                          <button onClick={(e) => { e.stopPropagation(); moveColumn(index, 'down'); }} disabled={index === columnOrder.length - 1} className="p-1 hover:bg-surf rounded disabled:opacity-20"><ArrowDown size={10} /></button>
                        </div>
                        <span className="text-[10px] font-mono text-tx3">#{index + 1}</span>
                        {columnsWithErrors.has(col) && (
                          <div className="text-err animate-pulse" title="Data quality issues detected in this column"><AlertTriangle size={14} /></div>
                        )}
                      </div>
                      <input
                        type="text"
                        value={columnRenames[col] || col}
                        onChange={(e) => setColumnRenames(prev => ({ ...prev, [col]: e.target.value }))}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="flex-1 bg-surf border border-border rounded px-2 py-1 text-[12px] font-semibold text-tx outline-none focus:border-acc"
                        placeholder="Rename column..."
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[10px] text-tx3 uppercase tracking-wider">Type</span>
                      <select
                        value={columnMappings[col] || 'text'}
                        onChange={(e) => setColumnMappings(prev => ({ ...prev, [col]: e.target.value }))}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="bg-surf border border-border rounded px-2 py-1 text-[11px] text-tx outline-none focus:border-acc"
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="datetime">DateTime</option>
                        <option value="currency">Currency</option>
                        <option value="boolean">Boolean</option>
                      </select>
                    </div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="border border-border rounded-xl overflow-hidden bg-surf shadow-soft overflow-x-auto relative min-h-[300px]">
        {loading && (
          <div className="absolute inset-0 bg-surf/50 backdrop-blur-[1px] flex items-center justify-center z-10">
            <Clock className="animate-spin text-acc" size={24} />
          </div>
        )}
        <table className="w-full text-left border-collapse">
          <thead className="bg-sub/50 border-b border-border">
            <tr>
              {effectiveColumns.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className={`px-4 py-3 font-mono text-[10px] uppercase tracking-wider font-bold cursor-pointer hover:bg-sub/80 transition-colors group ${
                    columnsWithErrors.has(col) ? 'text-err bg-err/5' : 'text-tx3'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {columnRenames[col] || col}
                    {columnsWithErrors.has(col) && <AlertTriangle size={10} className="text-err" />}
                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                      <ArrowUp size={8} className={sortBy === col && sortOrder === 'asc' ? 'text-acc' : 'text-tx3'} />
                      <ArrowDown size={8} className={sortBy === col && sortOrder === 'desc' ? 'text-acc' : 'text-tx3'} />
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="relative">
            {data.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-sub/20 transition-colors">
                {effectiveColumns.map(col => {
                  const val = row[col];
                  const type = columnMappings[col] || 'text';
                  const isValid = validateCell(val, type);
                  return (
                    <td
                      key={col}
                      className={`px-4 py-3 font-mono text-[11px] truncate max-w-[200px] relative group/cell ${
                        !isValid ? 'bg-err/5 text-err' : 'text-tx2'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {val?.toString() || '-'}
                        {!isValid && (
                          <div className="text-err shrink-0">
                            <AlertTriangle size={12} />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-err text-white text-[10px] rounded opacity-0 group-hover/cell:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20 shadow-lg">
                              Invalid {type} format
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {data.length === 0 && !loading && (
              <tr>
                <td colSpan={effectiveColumns.length || 1} className="px-4 py-12 text-center text-tx3 text-[13px] italic">
                  No records found matching your criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-2">
        <div className="text-[11px] text-tx3 font-medium">
          Showing <span className="text-tx font-bold">{(page - 1) * pageSize + 1}</span> to{' '}
          <span className="text-tx font-bold">{Math.min(page * pageSize, totalCount)}</span> of{' '}
          <span className="text-tx font-bold">{formatNumber(totalCount)}</span> records
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => setPage(1)} disabled={page === 1} className="p-2 rounded-lg border border-border hover:bg-sub disabled:opacity-30 transition-all"><ChevronsLeft size={14} /></button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-border hover:bg-sub disabled:opacity-30 transition-all"><ChevronLeft size={14} /></button>

          <div className="flex items-center gap-1 px-2">
            <span className="text-[11px] font-mono text-tx3">Page</span>
            <input
              type="number"
              value={page}
              onChange={(e) => {
                const p = parseInt(e.target.value);
                if (p > 0 && p <= totalPages) setPage(p);
              }}
              className="w-12 text-center bg-sub border border-border rounded py-1 text-[11px] font-bold outline-none"
            />
            <span className="text-[11px] font-mono text-tx3 text-nowrap">of {totalPages}</span>
          </div>

          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-border hover:bg-sub disabled:opacity-30 transition-all"><ChevronRight size={14} /></button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="p-2 rounded-lg border border-border hover:bg-sub disabled:opacity-30 transition-all"><ChevronsRight size={14} /></button>
        </div>
      </div>

      {saveModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !saving && setSaveModalOpen(false)}>
          <div
            className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <BookmarkPlus size={14} className="text-acc" />
                <span className="text-[13px] font-semibold text-tx">Save as View</span>
              </div>
              <button onClick={() => setSaveModalOpen(false)} disabled={saving} className="text-tx3 hover:text-tx transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Name</label>
                <input
                  type="text"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="e.g. Q4 fixed-asset additions"
                  autoFocus
                  className="w-full mt-1 px-3 py-2 bg-sub border border-border rounded-lg text-[12px] text-tx outline-none focus:ring-2 focus:ring-acc/20"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Description (optional)</label>
                <input
                  type="text"
                  value={saveDescription}
                  onChange={e => setSaveDescription(e.target.value)}
                  placeholder="What this slice shows"
                  className="w-full mt-1 px-3 py-2 bg-sub border border-border rounded-lg text-[12px] text-tx outline-none focus:ring-2 focus:ring-acc/20"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Audit area (optional)</label>
                <select
                  value={saveAreaCode}
                  onChange={e => setSaveAreaCode(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-sub border border-border rounded-lg text-[12px] text-tx outline-none focus:ring-2 focus:ring-acc/20"
                >
                  <option value="">—</option>
                  {(['general', 'bank', 'nbfc', 'insurance'] as const).flatMap(v => {
                    const inV = auditAreas.filter(a => a.vertical === v);
                    if (inV.length === 0) return [];
                    return [
                      <optgroup key={v} label={v === 'general' ? 'General — AS / Ind AS' : v[0].toUpperCase() + v.slice(1)}>
                        {inV.map(a => (
                          <option key={a.id} value={a.id}>{a.code} · {a.title}</option>
                        ))}
                      </optgroup>,
                    ];
                  })}
                </select>
              </div>
              <div className="text-[10px] font-mono text-tx3 bg-sub/30 rounded p-2">
                Will save: <span className="text-tx2">{filters.filter(filterIsComplete).length}</span> filter{filters.filter(filterIsComplete).length === 1 ? '' : 's'}
                {sortBy && <> · sorted by <span className="text-tx2">{sortBy}</span> {sortOrder}</>}
                {viewColumns && <> · <span className="text-tx2">{effectiveColumns.length}/{columnOrder.length}</span> cols</>}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setSaveModalOpen(false)}
                disabled={saving}
                className="btn btn-ghost text-[12px]"
              >
                Cancel
              </button>
              <button
                onClick={saveAsNewView}
                disabled={saving || !saveName.trim()}
                className="btn btn-acc text-[12px] flex items-center gap-1.5"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <BookmarkPlus size={12} />}
                {saving ? 'Saving...' : 'Save view'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unified Filter Library Panel ─────────────────────────────── */}
      {showFilterLibrary && (
        <UnifiedFilterLibrary
          file={file}
          filters={filters}
          filterIsComplete={filterIsComplete}
          sortBy={sortBy}
          sortOrder={sortOrder}
          viewColumns={viewColumns}
          effectiveColumns={effectiveColumns}
          columnOrder={columnOrder}
          savedFilters={Array.isArray(savedFilters) ? savedFilters : []}
          setSavedFilters={setSavedFilters}
          suggestedFilters={Array.isArray(suggestedFilters) ? suggestedFilters : []}
          applySavedFilter={applySavedFilter}
          saveFilterAsTemplate={saveFilterAsTemplate}
          onClose={() => setShowFilterLibrary(false)}
        />
      )}
    </div>
  );
};

// ── Unified Filter Library Component ─────────────────────────────────────────
interface UnifiedFilterLibraryProps {
  file: any;
  filters: any[];
  filterIsComplete: (f: any) => boolean;
  sortBy: string | null;
  sortOrder: string;
  viewColumns: string[] | null;
  effectiveColumns: string[];
  columnOrder: string[];
  savedFilters: any[];
  setSavedFilters: React.Dispatch<React.SetStateAction<any[]>>;
  suggestedFilters: any[];
  applySavedFilter: (t: any) => void;
  saveFilterAsTemplate: (name: string, desc?: string) => Promise<void>;
  onClose: () => void;
}

const UnifiedFilterLibrary = ({
  file, filters, filterIsComplete, sortBy, sortOrder, viewColumns,
  effectiveColumns, columnOrder, savedFilters, setSavedFilters,
  suggestedFilters, applySavedFilter, saveFilterAsTemplate, onClose,
}: UnifiedFilterLibraryProps) => {
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [justApplied, setJustApplied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'quick' | 'saved'>('quick');

  const activeFilterCount = filters.filter(filterIsComplete).length;
  const datasetType = (file as any).dataset_type || 'general';

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      await saveFilterAsTemplate(saveName.trim(), saveDesc.trim());
      setSaveName('');
      setSaveDesc('');
      setShowSaveForm(false);
      setActiveTab('saved');
    } catch {
      alert('Failed to save filter template. Please check the console for details.');
    } finally {
      setSaving(false);
    }
  };

  const handleApply = (t: any) => {
    applySavedFilter(t);
    if (t.id) {
      setJustApplied(t.id);
      setTimeout(() => setJustApplied(null), 1500);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/filter-templates/${id}`);
    } catch (error) {
      console.error('Delete failed:', error);
    }
    setSavedFilters(prev => prev.filter((x: any) => x.id !== id));
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surf border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Layers size={15} className="text-acc" />
            <span className="text-[14px] font-semibold text-tx">Filter Library</span>
          </div>
          <button onClick={onClose} className="text-tx3 hover:text-tx transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 px-5 pt-3 pb-0 shrink-0">
          <button
            onClick={() => setActiveTab('quick')}
            className={`flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-t-xl border-b-2 transition-all ${
              activeTab === 'quick'
                ? 'border-acc text-acc font-semibold'
                : 'border-transparent text-tx3 hover:text-tx'
            }`}
          >
            <Zap size={12} /> Quick Filters
          </button>
          <button
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-t-xl border-b-2 transition-all ${
              activeTab === 'saved'
                ? 'border-acc text-acc font-semibold'
                : 'border-transparent text-tx3 hover:text-tx'
            }`}
          >
            <Layers size={12} /> Saved Templates
            {savedFilters.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-acc/10 text-acc font-bold">
                {savedFilters.length}
              </span>
            )}
          </button>
        </div>

        <div className="h-px bg-border shrink-0" />

        {/* ── Quick Filters Tab ── */}
        {activeTab === 'quick' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <p className="text-[11px] text-tx3">
              One-click filters auto-generated from your dataset columns. Click any to apply instantly.
            </p>
            {suggestedFilters.length === 0 ? (
              <div className="py-10 text-center text-tx3 text-[12px]">
                No quick filters available — make sure your columns are mapped to the correct types in Data Source.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {suggestedFilters.map((f: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => handleApply(f)}
                    className="w-full text-left px-4 py-3 rounded-xl border border-border bg-sub/20 hover:border-acc hover:bg-acc/5 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] font-semibold text-tx group-hover:text-acc transition-colors">{f.name}</p>
                      <span className="text-[10px] text-acc opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Zap size={10} /> Apply
                      </span>
                    </div>
                    {f.description && (
                      <p className="text-[10px] text-tx3 mt-0.5">{f.description}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Saved Templates Tab ── */}
        {activeTab === 'saved' && (
          <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
            {/* Save current filters form */}
            <div className="px-5 py-3 border-b border-border shrink-0 bg-sub/10">
              {!showSaveForm ? (
                <button
                  onClick={() => setShowSaveForm(true)}
                  disabled={activeFilterCount === 0}
                  className="w-full flex items-center gap-2 text-[12px] font-medium text-acc hover:text-acc/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={13} />
                  {activeFilterCount > 0
                    ? `Save current ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} as template`
                    : 'Apply filters first to save them as a template'}
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-acc uppercase tracking-wider">Save as Template</span>
                    <button onClick={() => { setShowSaveForm(false); setSaveName(''); setSaveDesc(''); }} className="text-tx3 hover:text-tx">
                      <X size={13} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    <input
                      autoFocus
                      type="text"
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      placeholder="Template name (e.g. High-value transactions)"
                      className="w-full px-3 py-2 text-[12px] bg-bg border border-border rounded-xl text-tx placeholder:text-tx3 focus:outline-none focus:border-acc"
                      onKeyDown={e => e.key === 'Enter' && !saving && saveName.trim() && handleSave()}
                    />
                    <input
                      type="text"
                      value={saveDesc}
                      onChange={e => setSaveDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full px-3 py-2 text-[12px] bg-bg border border-border rounded-xl text-tx placeholder:text-tx3 focus:outline-none focus:border-acc"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-tx3 font-mono bg-sub/50 rounded-lg px-2 py-1">
                      {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
                      {sortBy && ` · sorted by ${sortBy}`}
                      {viewColumns && ` · ${effectiveColumns.length}/${columnOrder.length} cols`}
                      {' · '}<span className="text-tx2">{datasetType}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setShowSaveForm(false); setSaveName(''); setSaveDesc(''); }}
                        className="text-[11px] text-tx3 hover:text-tx px-3 py-1.5"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving || !saveName.trim()}
                        className="btn btn-acc text-[11px] py-1.5 px-4 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Saved templates list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {savedFilters.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Layers size={28} className="mx-auto text-tx3 opacity-30" />
                  <p className="text-[13px] font-semibold text-tx">No saved templates yet</p>
                  <p className="text-[11px] text-tx3">Apply some filters then click "Save current filters" above</p>
                </div>
              ) : (
                <>
                  {savedFilters.filter(f => (f.datasetType ?? f.dataset_type) === datasetType).length > 0 && (
                    <p className="text-[9px] font-mono uppercase tracking-wider text-tx3 px-1 pb-1">
                      This dataset type — {datasetType}
                    </p>
                  )}
                  {savedFilters.filter(f => (f.datasetType ?? f.dataset_type) === datasetType).map((f: any) => (
                    <div key={f.id} className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-acc/20 bg-acc/5 hover:border-acc/40 transition-all">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-tx truncate">{f.name}</p>
                        <p className="text-[10px] text-tx3 mt-0.5">
                          {f.filters?.length || 0} filter{(f.filters?.length || 0) !== 1 ? 's' : ''}
                          {(f.sortBy ?? f.sort_by) && ` · sorted by ${f.sortBy ?? f.sort_by}`}
                          {(f.usageCount ?? f.use_count) > 0 && ` · used ${f.usageCount ?? f.use_count}×`}
                        </p>
                        {f.description && <p className="text-[10px] text-tx3 italic mt-0.5">{f.description}</p>}
                      </div>
                      <button
                        onClick={() => handleApply(f)}
                        className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border transition-all shrink-0 ${
                          justApplied === f.id
                            ? 'bg-ok/10 border-ok/30 text-ok'
                            : 'border-acc/30 bg-acc/10 text-acc hover:bg-acc/20'
                        }`}
                      >
                        {justApplied === f.id ? <><Activity size={10} /> Applied!</> : <><Zap size={10} /> Apply</>}
                      </button>
                      <button
                        onClick={() => handleDelete(f.id)}
                        className="p-1.5 text-tx3 hover:text-err hover:bg-err/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}

                  {savedFilters.filter(f => (f.datasetType ?? f.dataset_type) !== datasetType).length > 0 && (
                    <p className="text-[9px] font-mono uppercase tracking-wider text-tx3 px-1 pt-3 pb-1">
                      Other dataset types
                    </p>
                  )}
                  {savedFilters.filter(f => (f.datasetType ?? f.dataset_type) !== datasetType).map((f: any) => (
                    <div key={f.id} className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-sub/10 hover:border-border2 transition-all opacity-60 hover:opacity-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-tx truncate">{f.name}</p>
                        <p className="text-[10px] text-tx3 mt-0.5">
                          {f.filters?.length || 0} filters · <span className="italic">{f.datasetType ?? f.dataset_type}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => handleApply(f)}
                        className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-border text-tx2 hover:border-acc hover:text-acc transition-all shrink-0"
                      >
                        <Zap size={10} /> Apply
                      </button>
                      <button
                        onClick={() => handleDelete(f.id)}
                        className="p-1.5 text-tx3 hover:text-err hover:bg-err/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-sub/10 shrink-0">
          <p className="text-[10px] text-tx3">
            Templates are saved per dataset type and reusable across all your datasets.
          </p>
        </div>
      </div>
    </div>
  );
};
