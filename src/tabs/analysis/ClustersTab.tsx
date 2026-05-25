import { useEffect, useMemo, useState } from 'react';
import { Layers, Clock, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { Card } from '../../components/Card';
import { GuidePanel } from '../../components/GuidePanel';
import { ClusterResult } from '../../components/results/ClusterResult';
import { AiInsightPanel } from '../../components/AiInsightPanel';
import { markGuideSeen } from '../../lib/guideStorage';
import type { FileMetadata, JobStatus } from '../../lib/types';

interface Props {
  file: FileMetadata;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, JobStatus>;
}

export const ClustersTab = ({ file, startJob, jobs }: Props) => {
  // ── Column filtering ──────────────────────────────────────────────────────
  // K-Means needs numeric axes — keep only number/currency columns.
  // Falls back to all columns if columnMeta isn't populated yet.
  const numericCols = useMemo(() => {
    const meta = file.columnMeta;
    if (meta && meta.length > 0) {
      const filtered = meta
        .filter(m => m.inferred_type === 'number' || m.inferred_type === 'currency')
        .map(m => m.name);
      // If fewer than 2 numeric columns found, fall back to all columns so
      // the UI isn't broken on uncleaned datasets
      return filtered.length >= 2 ? filtered : (file.columns || []);
    }
    return file.columns || [];
  }, [file.columnMeta, file.columns]);

  const usingFallback =
    !!file.columnMeta &&
    file.columnMeta.length > 0 &&
    file.columnMeta.filter(m => m.inferred_type === 'number' || m.inferred_type === 'currency').length < 2;

  const [xCol, setXCol] = useState('');
  const [yCol, setYCol] = useState('');
  const [k, setK]       = useState(3);
  const [showInsights, setShowInsights] = useState(true);

  // Auto-select first two numeric columns when the file or column list changes
  useEffect(() => {
    if (numericCols.length > 0 && (!xCol || !numericCols.includes(xCol))) {
      setXCol(numericCols[0]);
    }
    if (numericCols.length > 1 && (!yCol || !numericCols.includes(yCol))) {
      setYCol(numericCols[1]);
    }
  }, [numericCols]);

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const allJobs = Object.values(jobs).filter(j => j?.task_name === 'run_clustering');
  const latestJob = allJobs.filter(j => j?.status === 'completed').slice(-1)[0];

  useEffect(() => {
    if (latestJob) markGuideSeen('clustering');
  }, [latestJob?.id]);

  const canRun = !!xCol && !!yCol && xCol !== yCol && k >= 2;

  return (
    <div className="space-y-6">
      <GuidePanel
        tabId="clustering"
        icon={<Layers size={15} />}
        title="Cluster Analysis"
        description="Groups records using K-Means clustering on two numeric dimensions you choose. Useful for surfacing natural segments — small routine transactions vs. large irregular ones, dormant vs. active vendors, normal vs. suspicious sub-populations."
        whenToUse={[
          'Segmenting vendors or customers by transaction behaviour',
          'Identifying a sub-group of unusually large or frequent payments',
          'Exploring 2D structure in any numeric dataset',
          "Finding records that don't fit any natural cluster (isolation)",
        ]}
        steps={[
          'Pick two numeric columns to cluster on (X and Y axes)',
          'Choose number of clusters (3–5 is typical)',
          "Click Run Clustering — results appear below",
        ]}
        tip="Very small clusters (1–3 records) often contain outliers worth investigating. Try different column pairs — the segmentation pattern depends on what you measure."
      />

      {/* Configuration */}
      <Card title="Cluster Analysis Configuration" icon={Layers}>
        {usingFallback && (
          <div className="mb-4 px-4 py-2.5 bg-warn/10 border border-warn/30 rounded-lg text-[11px] text-warn font-mono">
            ⚠ Fewer than 2 numeric columns detected — showing all columns. Run Data Cleaning first for best results.
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6 items-end">
          {/* X axis */}
          <div className="flex-1 space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              X Axis <span className="normal-case text-tx3/60">— numeric</span>
            </label>
            <select
              value={xCol}
              onChange={e => setXCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20 outline-none"
            >
              <option value="">Select column…</option>
              {numericCols.map(c => {
                const meta = file.columnMeta?.find(m => m.name === c);
                return (
                  <option key={c} value={c}>
                    {c}{meta ? ` — ${meta.inferred_type}` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Y axis — hides the selected X column */}
          <div className="flex-1 space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              Y Axis <span className="normal-case text-tx3/60">— numeric</span>
            </label>
            <select
              value={yCol}
              onChange={e => setYCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20 outline-none"
            >
              <option value="">Select column…</option>
              {numericCols
                .filter(c => c !== xCol)
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

          {/* k */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              Clusters (k)
            </label>
            <input
              type="number"
              min={2}
              max={10}
              value={k}
              onChange={e => setK(Math.max(2, Math.min(10, parseInt(e.target.value) || 3)))}
              className="w-28 bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20 outline-none"
            />
          </div>

          <div>
            <button
              onClick={() => startJob('run_clustering', { x_col: xCol, y_col: yCol, k })}
              disabled={!canRun}
              className="btn btn-acc px-6 py-3 flex items-center gap-2 disabled:opacity-50"
            >
              <Layers size={16} /> Run Clustering
            </button>
          </div>
        </div>
      </Card>

      {/* Results */}
      <Card title="Cluster Results" icon={Layers}>
        {latestJob ? (
          <div className="space-y-8">
            <ClusterResult
              key={latestJob.id}
              jobId={latestJob.id}
              xLabel={latestJob.task_params?.x_col || 'X'}
              yLabel={latestJob.task_params?.y_col || 'Y'}
            />

            {/* Insights accordion — mirrors TemporalTab */}
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
                    Cluster Segmentation Analysis
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <strong>Recommended Actions</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Investigate very small clusters (1–3 records) as potential outliers</li>
                        <li>Review the largest cluster for dominant transaction patterns</li>
                        <li>Try different column pairs to reveal other segmentations</li>
                        <li>Cross-reference clusters with known entity categories</li>
                      </ul>
                    </div>
                    <div>
                      <strong>Red Flags</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Isolated singleton clusters far from the main group</li>
                        <li>Clusters that don't align with expected business segments</li>
                        <li>Unusually tight clusters suggesting duplicate or templated entries</li>
                        <li>Extreme separation between cluster centroids</li>
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
            <Layers size={48} className="mx-auto mb-4 opacity-30" />
            <p>Select two numeric columns and run Clustering to see results here.</p>
          </div>
        )}
      </Card>

      {/* Job History */}
      <Card title="Analysis History" icon={Clock}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allJobs.length === 0 ? (
            <div className="col-span-full py-12 text-center text-tx3">
              No previous clustering jobs found.
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
                <div className="mt-3 text-sm font-medium text-tx">
                  k = {job.task_params?.k ?? '?'} clusters
                </div>
                <div className="text-xs text-tx3 mt-1 font-mono">
                  {job.task_params?.x_col} × {job.task_params?.y_col}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};
