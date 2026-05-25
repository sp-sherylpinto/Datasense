import * as XLSX from 'xlsx';

export type ColType = 'text' | 'number' | 'date' | 'datetime' | 'currency' | 'boolean';

const COL_TYPE_SET: ReadonlySet<ColType> = new Set(['text', 'number', 'date', 'datetime', 'currency', 'boolean']);

// Keywords that strongly suggest a monetary / financial column
const CURRENCY_KEYWORDS = /amount|price|cost|fee|charge|salary|revenue|profit|loss|tax|total|balance|payment|invoice|credit|debit|fare|rent|premium|commission|value|worth|gross|net|vat|gst|tds|deduction|allowance|bonus|expense|budget|forecast/i;

// Keywords that look numeric but are NOT monetary (IDs, counts, ranks…)
const ID_LIKE_KEYWORDS = /(?:^|_)(?:id|code|pin|zip|no|num|rank|count|qty|quantity|age|score|index|flag|seq|serial|ref|year|month|day|hour|minute|version|level|tier|priority)(?:$|_)/i;

/**
 * Coerce backend `inferred_type` strings into the UI-aligned set.
 * Handles Polars types (Int64, Float64, Utf8, Boolean, Date, Datetime[μs])
 * and DuckDB types (INTEGER, VARCHAR, TIMESTAMP, DECIMAL, etc.)
 *
 * When the backend returns "number" for a column whose name looks monetary
 * (amount, cost, fee, etc.) we promote it to "currency" so the UI shows
 * the correct type without requiring a re-clean.
 */
export const normaliseColType = (
  t: string | undefined | null,
  colName?: string,
): ColType => {
  if (!t) return 'text';
  const raw   = String(t).trim();
  const lower = raw.toLowerCase();

  // Already a valid UI type
  if (COL_TYPE_SET.has(lower as ColType)) {
    // "number" may be monetary — upgrade based on column name
    if (lower === 'number' && colName) {
      const n = colName.toLowerCase().replace(/[\s-]/g, '_');
      if (CURRENCY_KEYWORDS.test(n) && !ID_LIKE_KEYWORDS.test(n)) return 'currency';
    }
    return lower as ColType;
  }

  // Legacy / Polars labels
  if (lower === 'integer' || lower === 'float') {
    if (colName) {
      const n = colName.toLowerCase().replace(/[\s-]/g, '_');
      if (CURRENCY_KEYWORDS.test(n) && !ID_LIKE_KEYWORDS.test(n)) return 'currency';
    }
    return 'number';
  }
  if (lower === 'utf8' || lower === 'string') return 'text';

  // Integer types
  if (/^u?int(8|16|32|64)?$/.test(lower)) return 'number';
  if (/^(integer|bigint|smallint|tinyint|hugeint|int2|int4|int8|serial|int)$/.test(lower)) return 'number';

  // Float / Decimal types
  if (/^float(32|64)?$/.test(lower) || /^(double(\s+precision)?|real|numeric|decimal|money)/.test(lower)) {
    if (colName) {
      const n = colName.toLowerCase().replace(/[\s-]/g, '_');
      if (CURRENCY_KEYWORDS.test(n) && !ID_LIKE_KEYWORDS.test(n)) return 'currency';
    }
    return 'number';
  }

  // Text types
  if (/^(varchar|char|text|bpchar|name)/.test(lower)) return 'text';

  // Boolean
  if (/^bool(ean)?$/.test(lower)) return 'boolean';

  // Date
  if (/^date$/.test(lower)) return 'date';

  // Datetime / Timestamp
  if (/^(datetime|timestamp)/.test(lower)) return 'datetime';

  // Duration / Interval / Categorical / Null → text
  if (/^(duration|interval|list|struct|object|null|unknown|categorical)/.test(lower)) return 'text';

  return 'text';
};

/**
 * Infer column type from the column name alone using keyword matching.
 */
export const inferTypeFromColumnName = (colName: string): ColType | null => {
  const lower = colName.toLowerCase().replace(/[\s_-]/g, '');

  // Currency — must contain these specific finance words
  if (/^(amount|price|cost|fee|salary|revenue|profit|loss|tax|balance|payment|invoice|credit|debit|rent|premium|commission|budget|expenditure|expense|charges|total)$|^(amount|price|cost|fee|salary|revenue|profit|loss|tax|balance|payment|invoice|credit|debit|rent|premium|commission)(s|in|out|paid|received|due|net|gross|total)?$/.test(lower)
    || /(amount|price|cost|fee|salary|revenue|profit|loss|tax|balance|payment|invoice|credit|debit)/.test(lower))
    return 'currency';

  // Datetime — must have both date and time indicators
  if (/(datetime|timestamp|createdat|updatedat|modifiedat|lastseen|lastlogin)/.test(lower))
    return 'datetime';

  // Date — specific date words, NOT period/month/year which are often numeric
  if (/^(date|dob|birthdate|joindate|expirydate|maturitydate|duedate|startdate|enddate|postingdate|valuedate|transactiondate|invoicedate)$/.test(lower)
    || /(^date|date$|^dob$|birthdate|joindate|expirydate|duedate|postingdate|valuedate)/.test(lower))
    return 'date';

  // Boolean — specific boolean column name patterns
  if (/^(is[a-z]|has[a-z]|can[a-z]|was[a-z])/.test(lower)
    || /^(active|enabled|verified|approved|flagged|deleted|archived|published|locked)$/.test(lower))
    return 'boolean';

  // Number — specific numeric concepts, NOT "number" as a word in phrases like "phone_number"
  if (/^(age|count|qty|quantity|rank|score|rating|level|priority|sequence|serialno|srno)$/.test(lower)
    || /(^count|^qty|^quantity|^age$|^rank$|^score$)/.test(lower))
    return 'number';

  return null;
};

/**
 * Detect column type using a priority system:
 * 1. Backend inferred_type (if provided and non-text)
 * 2. Column name keyword matching
 * 3. Sample data analysis (scans first 100 rows)
 * 4. Fallback → text
 */
export const detectColumnType = (
  colName: string,
  backendType: string | undefined,
  sampleRows: any[] = [],
): ColType => {
  // 1. Trust backend if it returned a non-text type
  if (backendType) {
    const normalised = normaliseColType(backendType, colName);
    if (normalised !== 'text') return normalised;
  }

  // 2. Column name hints
  const nameHint = inferTypeFromColumnName(colName);
  if (nameHint) return nameHint;

  // 3. Sample data analysis
  if (sampleRows.length > 0) {
    const sample = sampleRows.slice(0, 100);
    const values = sample
      .map(row => row?.[colName])
      .filter(v => v !== null && v !== undefined && String(v).trim() !== '');

    if (values.length === 0) return 'text';

    const counts = { currency: 0, date: 0, datetime: 0, boolean: 0, number: 0 };
    const currencyRe = /^[$£€₹¥][\d,]+(\.\d+)?$|^[\d,]+(\.\d+)?[$£€₹¥]$|^[\d,]+(\.\d+)?\s*(USD|INR|EUR|GBP)$/i;
    const dateRe = /^\d{4}-\d{2}-\d{2}$|^\d{2}[\/\-]\d{2}[\/\-]\d{4}$|^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    const datetimeRe = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
    // Only word-form booleans — not 1/0 which are valid numbers
    const boolRe = /^(true|false|yes|no|t|f|y|n)$/i;

    values.forEach(v => {
      const s = String(v).trim();
      if (boolRe.test(s))                             { counts.boolean++;  return; }
      if (currencyRe.test(s))                         { counts.currency++; return; }
      if (datetimeRe.test(s))                         { counts.datetime++; return; }
      if (dateRe.test(s))                             { counts.date++;     return; }
      if (!isNaN(Number(s.replace(/,/g, ''))) && s !== '') { counts.number++; return; }
    });

    const total = values.length;
    const threshold = 0.75; // 75% of values must match (raised from 70%)

    if (counts.boolean  / total >= threshold) return 'boolean';
    if (counts.currency / total >= threshold) return 'currency';
    if (counts.datetime / total >= threshold) return 'datetime';
    if (counts.date     / total >= threshold) return 'date';
    if (counts.number   / total >= threshold) return 'number';
  }

  return 'text';
};

export const formatNumber = (val: number | undefined | null) => {
  if (val === undefined || val === null) return '0';
  return val.toLocaleString();
};

export const validateCell = (value: any, type: string) => {
  if (value === null || value === undefined || value === '') return true;
  const strVal = value.toString().trim();

  switch (type) {
    case 'number':
      return !isNaN(Number(strVal.replace(/,/g, '')));
    case 'date':
    case 'datetime':
      return !isNaN(Date.parse(strVal));
    case 'currency':
      return !isNaN(Number(strVal.replace(/[$,£€]/g, '').replace(/,/g, '')));
    case 'boolean': {
      const lower = strVal.toLowerCase();
      return ['true', 'false', '1', '0', 'yes', 'no', 't', 'f'].includes(lower);
    }
    default:
      return true;
  }
};

export const exportCsv = (columns: string[], data: Record<string, any>[], filename: string) => {
  const escape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = [columns.join(','), ...data.map(row => columns.map(c => escape(row[c])).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportExcel = (columns: string[], data: Record<string, any>[], filename: string) => {
  const ws = XLSX.utils.json_to_sheet(data, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Results');
  XLSX.writeFile(wb, filename);
};
