import { useEffect, useState } from 'react';
import { AlertTriangle, Settings, History, Zap, Search, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '../../components/Card';
import { GuidePanel } from '../../components/GuidePanel';
import { OutlierResult } from '../../components/results/OutlierResult';
import { AiInsightPanel } from '../../components/AiInsightPanel';
import type { FileMetadata, JobStatus } from '../../lib/types';

interface Props {
  file: FileMetadata;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, JobStatus>;
}

export const AnomaliesTab = ({ file, startJob, jobs }: Props) => {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [showInsights, setShowInsights] = useState(true);

  useEffect(() => {
    setSelectedCols(prev => prev.filter(c => file.columns?.includes(c)));
  }, [file.columns]);

  const cols = file.columns || [];

  const toggleColumn = (col: string) => {
    setSelectedCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const runEnsemble = () => {
    if (!selectedCols.length) {
      alert('Please select at least one numeric column');
      return;
    }
    startJob('run_isolation_forest', { columns: selectedCols, contamination: 0.05 });
  };

  const runZScore = () => {
    const col = selectedCols[0];
    if (!col) {
      alert('Please select at least one column for Z-Score analysis');
      return;
    }
    startJob('run_outliers', { column: col });
  };

  const allJobs = Object.values(jobs).filter(j => 
    j?.task_name === 'run_outliers' || j?.task_name === 'run_isolation_forest'
  );
  
  const latestCompletedJob = allJobs
    .filter(j => j?.status === 'completed')
    .slice(-1)[0];

  return (
    <div className="space-y-6">
      <GuidePanel
        tabId="outliers"
        icon={<AlertTriangle size={15} />}
        title="Statistical Anomaly Detection"
        description="Uses Isolation Forest + Local Outlier Factor ensemble to detect unusual records across multiple dimensions."
        whenToUse={[
          'Detecting unusually large or small transactions',
          'Finding data entry errors',
          'Pre-audit screening for high-risk items',
        ]}
        steps={[
          'Select numeric columns',
          'Run Ensemble Scan',
          'Review rows with high anomaly scores',
        ]}
        tip="Rows flagged in multiple columns are more suspicious."
      />

      {/* Configuration */}
      <Card title="Anomaly Detection Configuration" icon={Settings}>
        <div className="space-y-4">
          <div className="p-4 bg-info/5 border border-info/20 rounded-xl text-sm">
            Select multiple numeric columns for multi-dimensional anomaly detection.
          </div>

          <div className="space-y-3">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider">
              Select Numeric Columns ({selectedCols.length} selected)
            </label>

            <div className="border border-border rounded-xl p-3 max-h-64 overflow-y-auto bg-sub/30">
              {cols.length === 0 ? (
                <p className="text-tx3 text-center py-8">No columns available</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cols.map(col => (
                    <label
                      key={col}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-sub rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCols.includes(col)}
                        onChange={() => toggleColumn(col)}
                        className="accent-acc w-4 h-4"
                      />
                      <span className="font-mono text-sm text-tx truncate">{col}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={runEnsemble}
              disabled={!selectedCols.length}
              className="btn btn-acc flex items-center gap-2 disabled:opacity-50"
            >
              <Zap size={16} />
              Run Ensemble Scan (IF + LOF)
            </button>

            <button
              onClick={runZScore}
              disabled={selectedCols.length === 0}
              className="btn btn-ghost flex items-center gap-2 disabled:opacity-50"
            >
              Run Z-Score (Single Column)
            </button>
          </div>
        </div>
      </Card>

      {/* Detection Results */}
      <Card title="Detection Results" icon={AlertTriangle}>
        {latestCompletedJob ? (
          <div className="space-y-8">
            <OutlierResult
              jobId={latestCompletedJob.id}
              column={latestCompletedJob.task_params?.column || 
                     latestCompletedJob.task_params?.columns?.[0] || ''}
              method={latestCompletedJob.task_name === 'run_isolation_forest' 
                ? 'IF + LOF Ensemble' 
                : 'Z-Score'}
            />

            {/* Beautiful Insights Section like Benford */}
            <div className="border border-border rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowInsights(!showInsights)}
                className="w-full px-6 py-4 bg-sub hover:bg-sub/80 flex items-center justify-between font-medium"
              >
                <div className="flex items-center gap-3">
                  <Lightbulb className="text-amber-500" size={20} />
                  Key Insights & Audit Recommendations
                </div>
                {showInsights ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>

              {showInsights && (
                <div className="p-6 space-y-5 text-[13px]">
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-medium">
                    Significant Deviation - Investigate
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <strong>Recommended Actions</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Sample high-risk records for manual vouching</li>
                        <li>Investigate round number patterns</li>
                        <li>Review transactions with high anomaly scores</li>
                        <li>Check for duplicate or fabricated entries</li>
                      </ul>
                    </div>
                    <div>
                      <strong>Red Flags</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Multiple records with very high anomaly scores</li>
                        <li>Clusters of round amounts (ending in 000, etc.)</li>
                        <li>Unusual concentration in specific columns</li>
                        <li>Duplicate entries across selected columns</li>
                      </ul>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <AiInsightPanel jobId={latestCompletedJob.id} />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-20 text-center">
            <div className="bg-sub/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-tx3">
              <Search size={28} />
            </div>
            <p className="text-tx3">No results yet. Run a scan above to generate insights.</p>
          </div>
        )}
      </Card>

      {/* Scan History */}
      <Card title="Scan History" icon={History}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allJobs.length === 0 ? (
            <div className="col-span-full text-center py-12 text-tx3">
              No previous scans found.
            </div>
          ) : (
            allJobs.reverse().map(job => (
              <div key={job.id} className="p-4 rounded-xl border border-border bg-sub/30 hover:bg-sub/50 transition-all">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[11px] font-mono text-tx2">#{job.id.slice(0, 8)}</span>
                  <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                    job.status === 'completed' ? 'bg-ok/10 text-ok' : 
                    job.status === 'failed' ? 'bg-err/10 text-err' : 'bg-warn/10 text-warn'
                  }`}>
                    {job.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-sm">
                  {job.task_name === 'run_isolation_forest' ? 'Ensemble Scan' : 'Z-Score'}
                </div>
                <div className="text-xs text-tx3 mt-1 font-mono truncate">
                  {job.task_params?.columns?.join(', ') || job.task_params?.column || 'N/A'}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};