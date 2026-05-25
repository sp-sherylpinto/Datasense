import React, { useState } from 'react';
import { Zap, BarChart3 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { AiInsightPanel } from '../components/AiInsightPanel';
import { api } from '../lib/api';

interface Props {
  file: any;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, any>;
}

const RATIO_COLUMNS = [
  { key: 'period_col', label: 'Period Column (optional)' },
  { key: 'revenue_col', label: 'Revenue' },
  { key: 'cogs_col', label: 'COGS' },
  { key: 'gross_profit_col', label: 'Gross Profit' },
  { key: 'net_income_col', label: 'Net Income' },
  { key: 'ebit_col', label: 'EBIT' },
  { key: 'interest_expense_col', label: 'Interest Expense' },
  { key: 'current_assets_col', label: 'Current Assets' },
  { key: 'current_liabilities_col', label: 'Current Liabilities' },
  { key: 'inventory_col', label: 'Inventory' },
  { key: 'total_assets_col', label: 'Total Assets' },
  { key: 'total_debt_col', label: 'Total Debt' },
  { key: 'equity_col', label: 'Equity' },
];

export const RatiosTab: React.FC<Props> = ({ file, startJob, jobs }) => {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [results, setResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  const allRatioJobs = Object.values(jobs).filter((j: any) => j?.task_name === 'run_ratios');
  const latestJob = allRatioJobs.filter((j: any) => j?.status === 'completed').slice(-1)[0] as any;
  const runningJob = allRatioJobs.find((j: any) => j?.status === 'pending' || j?.status === 'running') as any;
  const failedJob = !runningJob && !latestJob ? allRatioJobs.slice(-1)[0] as any : undefined;

  React.useEffect(() => {
    if (!latestJob?.id) return;
    setLoadingResults(true);
    api.post('/query', { job_id: latestJob.id, sql: 'SELECT * FROM RESULT_TABLE' })
      .then(r => setResults(r.data?.data || []))
      .catch(() => {})
      .finally(() => setLoadingResults(false));
  }, [latestJob?.id]);

  const cols: string[] = file?.columns || [];
  const isMultiPeriod = results.length > 1 && results.some(r => r.period != null);

  const ratioKeys = results.length > 0
    ? Object.keys(results[0]).filter(k => k !== 'period' && results[0][k] != null)
    : [];

  const LINE_COLORS = ['#9a3324', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c'];

  const submit = () => {
    startJob('run_ratios', { ...mapping });
  };

  return (
    <div className="space-y-5">
      <div className="bg-surf border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={15} className="text-acc" />
          <span className="text-[13px] font-semibold text-tx">Financial Ratios</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {RATIO_COLUMNS.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">{label}</label>
              <select value={mapping[key] || ''} onChange={e => setMapping(prev => ({ ...prev, [key]: e.target.value }))} className="w-full bg-sub border border-border rounded-lg px-3 py-2 text-[12px] text-tx">
                <option value="">— select —</option>
                {cols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button onClick={submit} disabled={!file || !!runningJob} className="btn btn-acc flex items-center gap-2">
          <Zap size={14} /> {runningJob ? 'Running...' : 'Compute Ratios'}
        </button>
        {runningJob && <p className="text-[11px] text-tx3 animate-pulse">Computing ratios…</p>}
        {failedJob?.error_message && <p className="text-[11px] text-err">Job failed: {failedJob.error_message.split('\n').slice(-2).join(' ')}</p>}
      </div>

      {latestJob && !loadingResults && results.length > 0 && (
        <div className="space-y-4">
          {isMultiPeriod ? (
            <div className="bg-surf border border-border rounded-xl p-5">
              <div className="text-[12px] font-semibold text-tx mb-3">Ratio Trends</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={results}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="period" tick={{ fill: 'var(--color-tx3)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--color-tx3)', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--color-surf)', borderColor: 'var(--color-border)', borderRadius: '8px', fontSize: '11px' }} />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    {ratioKeys.slice(0, 9).map((key, i) => (
                      <Line key={key} type="monotone" dataKey={key} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="bg-surf border border-border rounded-xl p-5">
              <div className="text-[12px] font-semibold text-tx mb-3">Ratio Scorecard</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {ratioKeys.map(key => (
                  <div key={key} className="bg-sub/30 rounded-lg p-3 border border-border">
                    <div className="text-[10px] font-mono text-tx3 uppercase tracking-wider mb-1">{key.replace(/_/g, ' ')}</div>
                    <div className="text-[18px] font-bold text-tx">{results[0][key] ?? '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <AiInsightPanel jobId={latestJob.id} />
        </div>
      )}
    </div>
  );
};
