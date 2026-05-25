import React, { useState } from 'react';
import { Zap, Clock } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AiInsightPanel } from '../components/AiInsightPanel';
import { api } from '../lib/api';

interface Props {
  file: any;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, any>;
}

export const AgingTab: React.FC<Props> = ({ file, startJob, jobs }) => {
  const [partyCol, setPartyCol] = useState('');
  const [amountCol, setAmountCol] = useState('');
  const [dueDateCol, setDueDateCol] = useState('');
  const [refDate, setRefDate] = useState(new Date().toISOString().split('T')[0]);
  const [bucketType, setBucketType] = useState<'debtor' | 'creditor'>('debtor');
  const [summary, setSummary] = useState<any[]>([]);
  const [detail, setDetail] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  const allAgingJobs = Object.values(jobs).filter((j: any) => j?.task_name === 'run_aging');
  const latestJob = allAgingJobs.filter((j: any) => j?.status === 'completed').slice(-1)[0] as any;
  const runningJob = allAgingJobs.find((j: any) => j?.status === 'pending' || j?.status === 'running') as any;
  const failedJob = !runningJob && !latestJob ? allAgingJobs.slice(-1)[0] as any : undefined;

  React.useEffect(() => {
    if (!latestJob?.id) return;
    setLoadingResults(true);
    Promise.all([
      api.post('/query', { job_id: latestJob.id, sql: "SELECT * FROM RESULT_TABLE WHERE result_type = 'summary'" }),
      api.post('/query', { job_id: latestJob.id, sql: "SELECT * FROM RESULT_TABLE WHERE result_type = 'detail' LIMIT 500" }),
    ])
      .then(([s, d]) => { setSummary(s.data?.data || []); setDetail(d.data?.data || []); })
      .catch(() => {})
      .finally(() => setLoadingResults(false));
  }, [latestJob?.id]);

  const cols: string[] = file?.columns || [];

  const submit = () => {
    if (!partyCol || !amountCol || !dueDateCol) { alert('Party, Amount, and Due Date columns are required'); return; }
    startJob('run_aging', {
      party_col: partyCol,
      amount_col: amountCol,
      due_date_col: dueDateCol,
      reference_date: refDate,
      bucket_type: bucketType,
    });
  };


  return (
    <div className="space-y-5">
      <div className="bg-surf border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-acc" />
          <span className="text-[13px] font-semibold text-tx">Aging Analysis</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Party Column *', val: partyCol, set: setPartyCol },
            { label: 'Amount Column *', val: amountCol, set: setAmountCol },
            { label: 'Due Date Column *', val: dueDateCol, set: setDueDateCol },
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
            <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Reference Date</label>
            <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="w-full bg-sub border border-border rounded-lg px-3 py-2 text-[12px] text-tx" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Bucket Type</label>
            <div className="flex gap-3 pt-2">
              {(['debtor', 'creditor'] as const).map(t => (
                <label key={t} className="flex items-center gap-2 text-[12px] text-tx2 cursor-pointer">
                  <input type="radio" checked={bucketType === t} onChange={() => setBucketType(t)} /> {t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <button onClick={submit} disabled={!file || !!runningJob} className="btn btn-acc flex items-center gap-2">
          <Zap size={14} /> {runningJob ? 'Running...' : 'Run Aging'}
        </button>
        {runningJob && <p className="text-[11px] text-tx3 animate-pulse">Computing aging buckets…</p>}
        {failedJob?.error_message && <p className="text-[11px] text-err">Job failed: {failedJob.error_message.split('\n').slice(-2).join(' ')}</p>}
      </div>

      {latestJob && !loadingResults && summary.length > 0 && (
        <div className="space-y-4">
          <div className="bg-surf border border-border rounded-xl p-5">
            <div className="text-[12px] font-semibold text-tx mb-3">Aging Distribution</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: 'var(--color-tx3)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--color-tx3)', fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--color-surf)', borderColor: 'var(--color-border)', borderRadius: '8px', fontSize: '11px' }} />
                  <Bar dataKey="total_amount" name="Amount (₹)" fill="var(--color-acc)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {detail.length > 0 && (
            <div className="bg-surf border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-[11px] font-mono text-tx3 uppercase">Detail Records</div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-sub/50 sticky top-0"><tr>{detail[0] && Object.keys(detail[0]).filter(k => k !== 'result_type').map(k => <th key={k} className="px-3 py-2 text-left font-mono text-tx3">{k}</th>)}</tr></thead>
                  <tbody>{detail.map((row, i) => (
                    <tr key={i} className="border-t border-border/30 hover:bg-sub/30">
                      {Object.entries(row).filter(([k]) => k !== 'result_type').map(([k, v]: [string, any]) => <td key={k} className="px-3 py-1.5 text-tx2">{String(v ?? '')}</td>)}
                    </tr>
                  ))}</tbody>
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
