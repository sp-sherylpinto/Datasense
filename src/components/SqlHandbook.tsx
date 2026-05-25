import React from 'react';
import { XCircle } from 'lucide-react';

const HANDBOOK_SECTIONS = [
  {
    id: 'intro', title: 'Introduction',
    content: `SQL (Structured Query Language) is the universal language for querying data stored in tables. In DataSense Pro, every file you upload becomes a table in the \`datasets\` schema. You query it the same way you'd query any database.\n\nAll tables follow this naming pattern:\n\n  datasets.ds_<hex_id>\n\nThe left panel in SQL Workbench lists your datasets with their friendly file names. Click any dataset to auto-fill the table name into the editor.`,
    code: null,
  },
  {
    id: 'select', title: 'SELECT Basics',
    content: 'Retrieve rows from a table. `*` means all columns.',
    code: `-- All columns, all rows\nSELECT *\nFROM datasets.ds_abc123;\n\n-- Specific columns only\nSELECT date, vendor, amount\nFROM datasets.ds_abc123\nLIMIT 100;`,
  },
  {
    id: 'where', title: 'WHERE — Filtering',
    content: 'Filter rows using conditions. Combine with AND / OR.',
    code: `-- Single condition\nSELECT * FROM datasets.ds_abc123\nWHERE amount > 100000;\n\n-- Multiple conditions\nSELECT * FROM datasets.ds_abc123\nWHERE amount > 100000\n  AND vendor = 'ABC Supplies';\n\n-- Range filter\nSELECT * FROM datasets.ds_abc123\nWHERE date BETWEEN '2024-01-01' AND '2024-03-31';\n\n-- Text search (case-insensitive)\nSELECT * FROM datasets.ds_abc123\nWHERE LOWER(narration) LIKE '%cash%';`,
  },
  {
    id: 'orderby', title: 'ORDER BY — Sorting',
    content: 'Sort results. DESC = highest first, ASC = lowest first (default).',
    code: `-- Largest amounts first\nSELECT * FROM datasets.ds_abc123\nORDER BY amount DESC\nLIMIT 20;\n\n-- Earliest dates first\nSELECT * FROM datasets.ds_abc123\nORDER BY date ASC;`,
  },
  {
    id: 'aggregations', title: 'Aggregations',
    content: 'Compute summary statistics across rows.',
    code: `SELECT\n  COUNT(*)           AS total_rows,\n  SUM(amount)        AS total_amount,\n  AVG(amount)        AS average_amount,\n  MIN(amount)        AS smallest,\n  MAX(amount)        AS largest\nFROM datasets.ds_abc123;`,
  },
  {
    id: 'groupby', title: 'GROUP BY & HAVING',
    content: 'Aggregate by category. HAVING filters after grouping (unlike WHERE which filters before).',
    code: `-- Spend by vendor\nSELECT vendor,\n       COUNT(*)    AS txn_count,\n       SUM(amount) AS total_spend\nFROM datasets.ds_abc123\nGROUP BY vendor\nORDER BY total_spend DESC;\n\n-- Only vendors with > 5 transactions\nSELECT vendor, COUNT(*) AS txn_count\nFROM datasets.ds_abc123\nGROUP BY vendor\nHAVING COUNT(*) > 5\nORDER BY txn_count DESC;`,
  },
  {
    id: 'joins', title: 'Joining Datasets',
    content: 'Combine two uploaded datasets on a common column.',
    code: `-- Match transactions to master vendor list\nSELECT t.date, t.amount, t.vendor, v.category\nFROM datasets.ds_abc123  AS t   -- transactions\nJOIN datasets.ds_def456  AS v   -- vendor master\n  ON LOWER(t.vendor) = LOWER(v.name);\n\n-- LEFT JOIN keeps all rows from left table\n-- even when there's no match on the right\nSELECT t.*, v.category\nFROM datasets.ds_abc123 t\nLEFT JOIN datasets.ds_def456 v\n  ON t.vendor_id = v.id;`,
  },
  {
    id: 'text', title: 'Text Functions',
    content: 'Clean and transform text columns.',
    code: `SELECT\n  UPPER(vendor)                    AS vendor_upper,\n  LOWER(narration)                 AS narration_lower,\n  TRIM(account_name)               AS trimmed,\n  LENGTH(description)              AS desc_length,\n  SUBSTRING(reference, 1, 8)       AS ref_prefix,\n  REPLACE(pan, ' ', '')            AS pan_clean,\n  CONCAT(first_name,' ',last_name) AS full_name\nFROM datasets.ds_abc123;`,
  },
  {
    id: 'dates', title: 'Date Functions',
    content: 'Extract parts of dates and calculate differences.',
    code: `SELECT\n  date,\n  EXTRACT(YEAR  FROM date::date) AS yr,\n  EXTRACT(MONTH FROM date::date) AS mo,\n  EXTRACT(DOW   FROM date::date) AS day_of_week, -- 0=Sun\n  TO_CHAR(date::date, 'Mon YYYY') AS period,\n  DATE_TRUNC('month', date::date) AS month_start,\n  NOW()::date - date::date        AS days_ago\nFROM datasets.ds_abc123;`,
  },
  {
    id: 'nulls', title: 'NULL Handling',
    content: 'NULLs are missing values. Use COALESCE to replace them with a default.',
    code: `-- Check for missing values\nSELECT COUNT(*) - COUNT(amount) AS missing_amounts\nFROM datasets.ds_abc123;\n\n-- Replace NULL with 0\nSELECT COALESCE(amount, 0) AS safe_amount\nFROM datasets.ds_abc123;\n\n-- Filter only missing rows\nSELECT * FROM datasets.ds_abc123\nWHERE vendor IS NULL OR amount IS NULL;`,
  },
  {
    id: 'subqueries', title: 'Subqueries & CTEs',
    content: 'Break complex queries into readable steps using CTEs (WITH clauses).',
    code: `-- CTE: name a sub-result, then query it\nWITH monthly_totals AS (\n  SELECT\n    DATE_TRUNC('month', date::date) AS month,\n    SUM(amount) AS total\n  FROM datasets.ds_abc123\n  GROUP BY 1\n)\nSELECT month, total,\n       total - LAG(total) OVER (ORDER BY month) AS mom_change\nFROM monthly_totals\nORDER BY month;`,
  },
  {
    id: 'audit', title: 'Audit Toolkit',
    content: 'Ready-to-use queries for common audit and fraud-detection patterns. Replace the table name with your dataset.',
    queries: [
      { label: 'Duplicate Transactions', desc: 'Same date + amount + vendor appearing more than once',
        code: `SELECT date, vendor, amount, COUNT(*) AS occurrences\nFROM datasets.ds_abc123\nGROUP BY date, vendor, amount\nHAVING COUNT(*) > 1\nORDER BY occurrences DESC;` },
      { label: 'Round Number Analysis', desc: 'Amounts divisible by 1000 — potential fabrications',
        code: `SELECT * FROM datasets.ds_abc123\nWHERE amount % 1000 = 0\n  AND amount > 0\nORDER BY amount DESC;` },
      { label: 'Just-Below-Threshold', desc: 'Payments just under approval limits (e.g. ₹49,999)',
        code: `SELECT * FROM datasets.ds_abc123\nWHERE amount BETWEEN 45000 AND 50000\nORDER BY amount DESC;` },
      { label: 'Vendor Concentration', desc: 'Which vendors received the most spend?',
        code: `SELECT vendor,\n       COUNT(*)    AS txns,\n       SUM(amount) AS total,\n       ROUND(100.0 * SUM(amount) / SUM(SUM(amount)) OVER (), 2) AS pct\nFROM datasets.ds_abc123\nGROUP BY vendor\nORDER BY total DESC\nLIMIT 20;` },
      { label: 'Missing Value Audit', desc: 'Count NULLs in every column',
        code: `SELECT\n  COUNT(*) - COUNT(date)    AS missing_date,\n  COUNT(*) - COUNT(vendor)  AS missing_vendor,\n  COUNT(*) - COUNT(amount)  AS missing_amount\nFROM datasets.ds_abc123;` },
      { label: 'Weekend Transactions', desc: 'Transactions on Saturday (6) or Sunday (0)',
        code: `SELECT * FROM datasets.ds_abc123\nWHERE EXTRACT(DOW FROM date::date) IN (0, 6)\nORDER BY date;` },
      { label: 'Period-End Spike', desc: 'Last 3 days of each month — common manipulation window',
        code: `SELECT * FROM datasets.ds_abc123\nWHERE EXTRACT(DAY FROM date::date)\n      >= EXTRACT(DAY FROM DATE_TRUNC('month', date::date)\n                         + INTERVAL '1 month - 3 days')\nORDER BY date;` },
      { label: 'Sequential Gap Check', desc: 'Find missing invoice/voucher numbers',
        code: `WITH seq AS (\n  SELECT voucher_no::int AS n,\n         LAG(voucher_no::int) OVER (ORDER BY voucher_no::int) AS prev\n  FROM datasets.ds_abc123\n)\nSELECT prev + 1 AS gap_from, n - 1 AS gap_to\nFROM seq\nWHERE n - prev > 1;` },
    ],
  },
];

export const PrismSqlStyle = () => (
  <style>{`
    .token.keyword { color: var(--color-acc); font-weight: 600; }
    .token.operator { color: var(--color-acc); }
    .token.string { color: #22863a; }
    .token.number { color: #005cc5; }
    .token.comment { color: var(--color-tx3); font-style: italic; }
    .token.punctuation { color: var(--color-tx2); }
    .token.function { color: var(--color-info); }
  `}</style>
);

export const SqlHandbookDrawer = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [activeSection, setActiveSection] = React.useState('intro');
  const section = HANDBOOK_SECTIONS.find(s => s.id === activeSection) || HANDBOOK_SECTIONS[0];

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative ml-auto h-full w-full max-w-4xl flex shadow-2xl border-l border-border"
           style={{ background: 'var(--color-surf, #faf8f5)' }}>

        <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto"
             style={{ background: '#1c1410', color: '#e8d5b0' }}>
          <div className="px-4 py-4 border-b border-white/10">
            <div className="text-[11px] font-mono text-[#e8d5b0]/50 uppercase tracking-widest mb-1">DataSense Pro</div>
            <div className="text-base font-semibold" style={{ fontFamily: '"Cormorant Garamond", serif', color: '#e8d5b0' }}>
              SQL Handbook
            </div>
          </div>
          <nav className="py-3 space-y-0.5 px-2">
            {HANDBOOK_SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full text-left px-3 py-2 rounded text-[11px] transition-colors ${
                  activeSection === s.id
                    ? 'bg-[#9a3324] text-white font-medium'
                    : 'text-[#e8d5b0]/70 hover:bg-white/10 hover:text-[#e8d5b0]'
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surf flex-shrink-0">
            <h2 className="text-lg text-tx" style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 600 }}>
              {section.title}
            </h2>
            <button onClick={onClose} className="text-tx3 hover:text-tx transition-colors p-1">
              <XCircle size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <p className="text-sm text-tx2 leading-relaxed whitespace-pre-line">{section.content}</p>

            {'code' in section && section.code && (
              <div className="rounded-lg overflow-hidden border border-border">
                <div className="flex items-center justify-between px-4 py-2 bg-[#1c1410]">
                  <span className="font-mono text-[10px] text-[#e8d5b0]/50 uppercase tracking-wider">SQL</span>
                  <button
                    onClick={() => copyCode(section.code!)}
                    className="font-mono text-[10px] text-[#e8d5b0]/60 hover:text-[#e8d5b0] transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre className="px-4 py-3 text-[12px] font-mono leading-relaxed overflow-x-auto"
                     style={{ background: '#241a14', color: '#e8d5b0' }}>
                  {section.code}
                </pre>
              </div>
            )}

            {'queries' in section && section.queries && section.queries.map((q, i) => (
              <div key={i} className="rounded-lg overflow-hidden border border-border">
                <div className="px-4 py-3 border-b border-border bg-sub/50">
                  <div className="font-semibold text-sm text-tx">{q.label}</div>
                  <div className="text-[11px] text-tx3 mt-0.5">{q.desc}</div>
                </div>
                <div className="relative">
                  <div className="flex items-center justify-between px-4 py-2 bg-[#1c1410]">
                    <span className="font-mono text-[10px] text-[#e8d5b0]/50 uppercase tracking-wider">SQL</span>
                    <button
                      onClick={() => copyCode(q.code)}
                      className="font-mono text-[10px] text-[#e8d5b0]/60 hover:text-[#e8d5b0] transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="px-4 py-3 text-[12px] font-mono leading-relaxed overflow-x-auto"
                       style={{ background: '#241a14', color: '#e8d5b0' }}>
                    {q.code}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
