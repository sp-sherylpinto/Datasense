import { useEffect, useState } from 'react';
import { Network, Clock, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { Card } from '../../components/Card';
import { GuidePanel } from '../../components/GuidePanel';
import { NetworkResult } from '../../components/results/NetworkResult';
import { AiInsightPanel } from '../../components/AiInsightPanel';
import { markGuideSeen } from '../../lib/guideStorage';
import type { FileMetadata, JobStatus } from '../../lib/types';

interface Props {
  file: FileMetadata;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, JobStatus>;
}

export const NetworkTab = ({ file, startJob, jobs }: Props) => {
  // Network does group_by(src, tgt) + count — works on any column type
  const allCols = file.columns || [];

  const [sourceCol, setSourceCol] = useState('');
  const [targetCol, setTargetCol] = useState('');
  const [showInsights, setShowInsights] = useState(true);

  // Auto-select first two columns when file changes
  useEffect(() => {
    if (allCols.length > 0 && (!sourceCol || !allCols.includes(sourceCol))) {
      setSourceCol(allCols[0]);
    }
    if (allCols.length > 1 && (!targetCol || !allCols.includes(targetCol))) {
      setTargetCol(allCols[1]);
    }
  }, [file.columns]);

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const allJobs = Object.values(jobs).filter(j => j?.task_name === 'run_network');
  const latestJob = allJobs.filter(j => j?.status === 'completed').slice(-1)[0];

  useEffect(() => {
    if (latestJob) markGuideSeen('network');
  }, [latestJob?.id]);

  const canRun = !!sourceCol && !!targetCol && sourceCol !== targetCol;

  return (
    <div className="space-y-6">
      <GuidePanel
        tabId="network"
        icon={<Network size={15} />}
        title="Network Analysis"
        description="Maps relationships between entities as an interactive force-directed graph. Reveals hidden connections — vendors sharing directors, bank accounts, or addresses with employees; circular payment chains; or shell company constellations — that are impossible to detect by scanning rows."
        whenToUse={[
          'Related-party transaction screening in audit engagements',
          'Detecting shell company networks or circular fund flows',
          'Mapping vendor–director or vendor–employee relationships',
          'Any scenario requiring you to trace connections between named entities',
        ]}
        steps={[
          'Select the Source column (e.g. Vendor Name, Payer)',
          'Select the Target column (e.g. Director, Payee, Bank Account)',
          'Click Map Network — scroll to zoom, drag nodes to explore the graph',
        ]}
        tip="Nodes with many connections (hubs) are the most analytically significant — they link otherwise unrelated entities. Tight clusters sharing multiple connections may represent related companies disguised as independent parties."
      />

      {/* Configuration */}
      <Card title="Network Analysis Configuration" icon={Network}>
        <div className="flex flex-col md:flex-row gap-6 items-end">
          {/* Source */}
          <div className="flex-1 space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              Source Column
            </label>
            <select
              value={sourceCol}
              onChange={e => setSourceCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20 outline-none"
            >
              <option value="">Select column…</option>
              {allCols.map(c => {
                const meta = file.columnMeta?.find(m => m.name === c);
                return (
                  <option key={c} value={c}>
                    {c}{meta ? ` — ${meta.inferred_type}` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Target — hides selected source */}
          <div className="flex-1 space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              Target Column
            </label>
            <select
              value={targetCol}
              onChange={e => setTargetCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20 outline-none"
            >
              <option value="">Select column…</option>
              {allCols
                .filter(c => c !== sourceCol)
                .map(c => {
                  const meta = file.columnMeta?.find(m => m.name === c);
                  return (
                    <option key={c} value={c}>
                      {c}{meta ? ` — ${meta.inferred_type}` : ''}
                    </option>
                  );
                })}
            </select>
          </div>

          <div>
            <button
              onClick={() => startJob('run_network', { src_col: sourceCol, tgt_col: targetCol })}
              disabled={!canRun}
              className="btn btn-acc px-6 py-3 flex items-center gap-2 disabled:opacity-50"
            >
              <Network size={16} /> Map Network
            </button>
          </div>
        </div>
      </Card>

      {/* Results */}
      <Card title="Network Results" icon={Network}>
        {latestJob ? (
          <div className="space-y-8">
            <NetworkResult
              key={latestJob.id}
              jobId={latestJob.id}
              sourceCol={latestJob.task_params?.src_col || latestJob.task_params?.source_col || ''}
              targetCol={latestJob.task_params?.tgt_col || latestJob.task_params?.target_col || ''}
            />

            {/* Insights accordion */}
            <div className="border border-border rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowInsights(s => !s)}
                className="w-full px-6 py-4 bg-sub hover:bg-sub/80 flex items-center justify-between font-medium transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Lightbulb className="text-amber-500" size={20} />
                  Key Insights & Audit Recommendations
                </div>
                {showInsights ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              {showInsights && (
                <div className="p-6 space-y-5 text-[13px]">
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 font-medium">
                    Entity Relationship Network Analysis
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <strong>Recommended Actions</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Investigate high-degree hub nodes connected to many counterparties</li>
                        <li>Trace circular chains — A → B → C → A — as potential fund recycling</li>
                        <li>Cross-reference clustered entities against known related-party lists</li>
                        <li>Screenshot and document suspicious subgraphs for the working file</li>
                      </ul>
                    </div>
                    <div>
                      <strong>Red Flags</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Vendors sharing directors, addresses, or bank accounts with employees</li>
                        <li>Unusually dense clusters suggesting shell company constellations</li>
                        <li>Single nodes bridging otherwise disconnected entity groups</li>
                        <li>High edge weight between two specific entities (repeated transactions)</li>
                      </ul>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-border">
                    <AiInsightPanel jobId={latestJob.id} />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-24 text-center text-tx3">
            <Network size={48} className="mx-auto mb-4 opacity-30" />
            <p>Select source and target columns then click Map Network to see results here.</p>
          </div>
        )}
      </Card>

      {/* Job History */}
      <Card title="Analysis History" icon={Clock}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allJobs.length === 0 ? (
            <div className="col-span-full py-12 text-center text-tx3">
              No previous network jobs found.
            </div>
          ) : (
            allJobs.slice().reverse().map(job => (
              <div
                key={job.id}
                className="p-4 border border-border rounded-xl bg-sub/30 hover:bg-sub/50 transition-all"
              >
                <div className="flex justify-between items-start">
                  <span className="font-mono text-xs text-tx2">#{job.id.slice(0, 8)}</span>
                  <span className={`text-xs px-3 py-1 rounded-full ${
                    job.status === 'completed' ? 'bg-ok/10 text-ok border border-ok/20'
                    : job.status === 'failed'  ? 'bg-err/10 text-err border border-err/20'
                    :                            'bg-warn/10 text-warn border border-warn/20'
                  }`}>
                    {job.status === 'completed' ? '✓ Complete'
                      : job.status === 'failed' ? '✗ Failed'
                      : job.status.toUpperCase()}
                  </span>
                </div>
                <div className="mt-3 text-sm font-medium text-tx">Network Map</div>
                <div className="text-xs text-tx3 mt-1 font-mono">
                  {job.task_params?.src_col || job.task_params?.source_col}
                  {' → '}
                  {job.task_params?.tgt_col || job.task_params?.target_col}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};
