import React, { useState } from 'react';
import { Zap, FileText } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AiInsightPanel } from '../components/AiInsightPanel';
import { api } from '../lib/api';

interface Props {
  file: any;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, any>;
}

export const JeTestTab: React.FC<Props> = ({ file, startJob, jobs }) => {
  const [dateCol, setDateCol] = useState('');
  const [amountCol, setAmountCol] = useState('');
  const [accountCol, setAccountCol] = useState('');
  const [preparerCol, setPreparerCol] = useState('');
  const [narrationCol, setNarrationCol] = useState('');
  const [threshold, setThreshold] = useState(100000);
  const [results, setResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  const allJeJobs = Object.values(jobs).filter((j: any) => j?.task_name === 'run_je_test');
  const latestJob = allJeJobs.filter((j: any) => j?.status === 'completed').slice(-1)[0] as any;
  const runningJob = allJeJobs.find((j: any) => j?.status === 'pending' || j?.status === 'running') as any;
  const failedJob = !runningJob && !latestJob ? allJeJobs.slice(-1)[0] as any : undefined;

  React.useEffect(() => {
    if (!latestJob?.id) return;
    setLoadingResults(true);
    api.post('/query', { job_id: latestJob.id, sql: "SELECT * FROM RESULT_TABLE WHERE is_flagged = true ORDER BY flag_count DESC LIMIT 500" })
      .then(r => setResults(r.data?.data || []))
      .catch(() => {})
      .finally(() => setLoadingResults(false));
  }, [latestJob?.id]);

  const cols: string[] = file?.columns || [];

  const flagCounts: Record<string, number> = {};
  results.forEach((row: any) => {
    if (row.flags) {
      row.flags.split(',').forEach((f: string) => {
        const key = f.trim();
        if (key) flagCounts[key] = (flagCounts[key] || 0) + 1;
      });
    }
  });
  const chartData = Object.entries(flagCounts).map(([name, count]) => ({ name, count }));

  const submit = () => {
    if (!dateCol || !amountCol || !accountCol) { alert('Date, Amount, and Account columns are required'); return; }
    startJob('run_je_test', {
      date_col: dateCol,
      amount_col: amountCol,
      account_col: accountCol,
      preparer_col: preparerCol || null,
      narration_col: narrationCol || null,
      large_amount_threshold: threshold,
    });
  };

  return (
    <div className="space-y-5">
      <div className="bg-surf border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-acc" />
          <span className="text-[13px] font-semibold text-tx">Journal Entry Testing</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Date Column *', val: dateCol, set: setDateCol },
            { label: 'Amount Column *', val: amountCol, set: setAmountCol },
            { label: 'Account Column *', val: accountCol, set: setAccountCol },
            { label: 'Preparer (optional)', val: preparerCol, set: setPreparerCol },
            { label: 'Narration (optional)', val: narrationCol, set: setNarrationCol },
          ].map(({ label, val, set }) => (
            <div key={label} className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">{label}</label>
              <select value={val} onChange={e => set(e.target.value)} className="w-full bg-sub border border-border rounded-lg px-3 py-2 text-[12px] text-tx">
                <option value="">— select —</option>
                {cols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Large Amount Threshold (₹)</label>
            <input type="number" value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-full bg-sub border border-border rounded-lg px-3 py-2 text-[12px] text-tx" />
          </div>
        </div>
        <button onClick={submit} disabled={!file || !!runningJob} className="btn btn-acc flex items-center gap-2">
          <Zap size={14} /> {runningJob ? 'Running...' : 'Run JE Test'}
        </button>
        {runningJob && <p className="text-[11px] text-tx3 animate-pulse">Analysing journal entries…</p>}
        {failedJob?.error_message && <p className="text-[11px] text-err">Job failed: {failedJob.error_message.split('\n').slice(-2).join(' ')}</p>}
      </div>

      {latestJob && (
        <div className="space-y-4">
          {chartData.length > 0 && (
            <div className="bg-surf border border-border rounded-xl p-5">
              <div className="text-[12px] font-semibold text-tx mb-3">Flag Breakdown ({results.length} flagged entries)</div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--color-tx3)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--color-tx3)', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--color-surf)', borderColor: 'var(--color-border)', borderRadius: '8px', fontSize: '11px' }} />
                    <Bar dataKey="count" fill="var(--color-acc)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {loadingResults ? (
            <div className="text-[12px] text-tx3 animate-pulse p-4">Loading flagged entries...</div>
          ) : results.length > 0 && (
            <div className="bg-surf border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-[11px] font-mono text-tx3 uppercase">Flagged Entries ({results.length})</div>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-[11px]">
                  <thead className="bg-sub/50">
                    <tr>{results[0] && Object.keys(results[0]).map(k => <th key={k} className="px-3 py-2 text-left font-mono text-tx3">{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {results.map((row: any, i: number) => (
                      <tr key={i} className="border-t border-border/30 hover:bg-sub/30">
                        {Object.values(row).map((v: any, j: number) => <td key={j} className="px-3 py-1.5 text-tx2">{String(v ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <AiInsightPanel jobId={latestJob.id} />
        </div>
      )}
    </div>
  );
};
