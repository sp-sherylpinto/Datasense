import { useEffect, useState } from 'react';
import { BarChart3, Settings, History, Play, Activity } from 'lucide-react';
import { Card } from '../../components/Card';
import { GuidePanel } from '../../components/GuidePanel';
import { BenfordResult } from '../../components/results/BenfordResult';
import { AiInsightPanel } from '../../components/AiInsightPanel';
import type { FileMetadata, JobStatus } from '../../lib/types';

interface Props {
  file: FileMetadata;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, JobStatus>;
}

export const BenfordTab = ({ file, startJob, jobs }: Props) => {
  const [column, setColumn] = useState<string>(() => file.columns?.[0] || '');

  useEffect(() => {
    if (!column || !file.columns?.includes(column)) {
      setColumn(file.columns?.[0] || '');
    }
  }, [file.columns, column]);

  const benfordJobs = Object.values(jobs).filter(j => j?.task_name === 'run_benford');
  const latestJob = benfordJobs
    .filter(j => j?.status === 'completed')
    .slice(-1)[0];

  return (
    <div className="space-y-6">
      <GuidePanel
        tabId="benford"
        icon={<BarChart3 size={15} />}
        title="Benford's Law Analysis"
        description="Tests whether the leading digits of numbers in your dataset follow Benford's Law — the statistical principle that digit '1' appears ~30% of the time in natural data."
        whenToUse={[
          'Audit of invoice amounts, payment values, or journal entries',
          'Any large numeric dataset spanning multiple orders of magnitude',
          'Initial fraud screening on financial records',
        ]}
        steps={[
          'Select a numeric column',
          'Click Execute Analysis',
          'Compare bars against the Benford reference line',
        ]}
        tip="Significant deviations, especially spikes on digits 5, 6, or 9, are strong red flags for potential manipulation."
      />

      {/* Configuration */}
      <Card title="Analysis Configuration" icon={Settings}>
        <div className="flex flex-col md:flex-row items-end gap-6">
          <div className="flex-1 space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">Target Column</label>
            <select
              value={column}
              onChange={e => setColumn(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-4 py-2.5 text-[13px] focus:ring-2 focus:ring-acc/20 outline-none"
            >
              {file.columns?.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => column && startJob('run_benford', { column })}
            disabled={!column}
            className="btn btn-acc px-8 py-2.5 disabled:opacity-50 flex items-center gap-2"
          >
            <Play size={14} />
            Execute Analysis
          </button>
        </div>
      </Card>

      {/* Main Results Area */}
      <Card title="Analysis Results" icon={BarChart3}>
        {latestJob ? (
          <div className="space-y-6">
            <BenfordResult jobId={latestJob.id} column={latestJob.task_params?.column} />
            <AiInsightPanel jobId={latestJob.id} />
          </div>
        ) : (
          <div className="py-20 text-center">
            <div className="bg-sub/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-tx3">
              <Activity size={28} />
            </div>
            <p className="text-tx3 text-[14px]">No results yet.<br />Select a column and run the analysis.</p>
          </div>
        )}
      </Card>

      {/* Job History */}
      <Card title="Job History" icon={History}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {benfordJobs.length === 0 ? (
            <div className="col-span-full text-center py-8 text-tx3 text-sm">
              No previous jobs found.
            </div>
          ) : (
            benfordJobs
              .reverse()
              .map(job => (
                <div
                  key={job.id}
                  className="p-4 rounded-xl border border-border bg-sub/30 hover:bg-sub/50 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-mono text-tx2">#{job.id.slice(0, 8)}</span>
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      job.status === 'completed' ? 'bg-ok/10 text-ok' : 
                      job.status === 'running' ? 'bg-warn/10 text-warn' : 'bg-muted text-tx3'
                    }`}>
                      {job.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-tx">
                    Column: <span className="font-mono">{job.task_params?.column || 'N/A'}</span>
                  </div>
                </div>
              ))
          )}
        </div>
      </Card>
    </div>
  );
};