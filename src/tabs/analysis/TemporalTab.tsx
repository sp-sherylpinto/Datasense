import { useEffect, useState, useMemo } from 'react';
import { Activity, Zap, Calendar, TrendingUp, Lightbulb, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { Card } from '../../components/Card';
import { GuidePanel } from '../../components/GuidePanel';
import { TimeSeriesResult } from '../../components/results/TimeSeriesResult';
import { AiInsightPanel } from '../../components/AiInsightPanel';
import { JobStatusCard } from '../../components/JobStatusCard';
import type { FileMetadata, JobStatus } from '../../lib/types';

interface Props {
  file: FileMetadata;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, JobStatus>;
}

export const TemporalTab = ({ file, startJob, jobs }: Props) => {
  const allCols = file.columns || [];

  const dateCols = useMemo(() =>
    allCols.filter(col => {
      const lower = col.toLowerCase();
      return lower.includes('date') || lower.includes('time') ||
             lower.includes('day')  || lower.includes('month') || lower.includes('year');
    }), [allCols]);

  const numericCols = useMemo(() =>
    allCols.filter(col => !dateCols.includes(col)), [allCols, dateCols]);

  const [dateCol, setDateCol] = useState<string>('');
  const [valCol,  setValCol]  = useState<string>('');
  const [showInsights, setShowInsights] = useState(true);

  useEffect(() => {
    if (dateCols.length > 0 && !dateCols.includes(dateCol)) setDateCol(dateCols[0]);
    if (numericCols.length > 0 && !numericCols.includes(valCol)) setValCol(numericCols[0]);
  }, [dateCols, numericCols, dateCol, valCol]);

  const availableValCols = numericCols.filter(col => col !== dateCol);

  const allJobs = Object.values(jobs).filter(j =>
    j?.task_name === 'run_timeseries' || j?.task_name === 'run_forecast'
  );

  const latestJob = allJobs.filter(j => j?.status === 'completed').slice(-1)[0];

  const runAnalysis = () => {
    if (!dateCol || !valCol) return;
    startJob('run_timeseries', { date_col: dateCol, val_col: valCol });
  };

  const runForecast = () => {
    if (!dateCol || !valCol) return;
    startJob('run_forecast', { date_col: dateCol, val_col: valCol, periods: 30 });
  };

  return (
    <div className="space-y-6">
      <GuidePanel
        tabId="timeseries"
        icon={<Activity size={15} />}
        title="Temporal Analysis"
        description="Analyze trends, seasonality, and anomalies over time in your dataset."
        whenToUse={[
          'Sales, expense, or payment trends over time',
          'Detecting period-end anomalies',
          'Understanding seasonality and forecasting',
        ]}
        steps={['Select Date column', 'Select Value column', 'Run Trend Analysis or Forecast']}
        tip="Look for unusual spikes near month/year ends or sudden trend changes."
      />

      {/* Configuration */}
      <Card title="Temporal Analysis Configuration" icon={Activity}>
        <div className="flex flex-col md:flex-row gap-6 items-end">
          <div className="flex-1 space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider flex items-center gap-2">
              <Calendar size={14} /> Date Column
            </label>
            <select value={dateCol} onChange={e => setDateCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20">
              <option value="">Select Date Column...</option>
              {dateCols.map(col => <option key={col} value={col}>{col}</option>)}
            </select>
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp size={14} /> Value Column
            </label>
            <select value={valCol} onChange={e => setValCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20">
              <option value="">Select Value Column...</option>
              {availableValCols.map(col => <option key={col} value={col}>{col}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={runAnalysis} disabled={!dateCol || !valCol}
              className="btn btn-ghost px-6 py-3 disabled:opacity-50">
              Analyze Trend
            </button>
            <button onClick={runForecast} disabled={!dateCol || !valCol}
              className="btn btn-acc px-6 py-3 flex items-center gap-2 disabled:opacity-50">
              <Zap size={16} /> Forecast (30 days)
            </button>
          </div>
        </div>
      </Card>

      {/* Results + Insights */}
      <Card title="Time Series Results" icon={Activity}>
        {latestJob ? (
          <div className="space-y-8">
            <TimeSeriesResult
              jobId={latestJob.id}
              dateCol={latestJob.task_params?.date_col || ''}
              valCol={latestJob.task_params?.val_col || ''}
            />

            <div className="border border-border rounded-2xl overflow-hidden">
              <button onClick={() => setShowInsights(!showInsights)}
                className="w-full px-6 py-4 bg-sub hover:bg-sub/80 flex items-center justify-between font-medium">
                <div className="flex items-center gap-3">
                  <Lightbulb className="text-amber-500" size={20} />
                  Key Insights & Audit Recommendations
                </div>
                {showInsights ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              {showInsights && (
                <div className="p-6 space-y-5 text-[13px]">
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 font-medium">
                    Trend & Seasonality Analysis
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <strong>Recommended Actions</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Investigate sudden spikes or drops in trend</li>
                        <li>Check for month-end / year-end anomalies</li>
                        <li>Review forecast accuracy</li>
                        <li>Look for seasonal patterns</li>
                      </ul>
                    </div>
                    <div>
                      <strong>Red Flags</strong>
                      <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                        <li>Unexpected volatility or breaks in trend</li>
                        <li>Missing data in critical periods</li>
                        <li>Unusual seasonal deviations</li>
                        <li>Sharp changes from historical pattern</li>
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
            <Activity size={48} className="mx-auto mb-4 opacity-30" />
            <p>Run a temporal analysis or forecast to see results and insights here.</p>
          </div>
        )}
      </Card>

      {/* Job History — fixed: use Clock icon not undefined History */}
      <Card title="Analysis History" icon={Clock}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allJobs.length === 0 ? (
            <div className="col-span-full py-12 text-center text-tx3">
              No previous temporal analyses found.
            </div>
          ) : (
            allJobs.slice().reverse().map(job => (
              <div key={job.id} className="p-4 border border-border rounded-xl bg-sub/30 hover:bg-sub/50 transition-all">
                <div className="flex justify-between items-start">
                  <span className="font-mono text-xs text-tx2">#{job.id.slice(0, 8)}</span>
                  <span className={`text-xs px-3 py-1 rounded-full ${
                    job.status === 'completed' ? 'bg-ok/10 text-ok border border-ok/20' : 'bg-warn/10 text-warn border border-warn/20'
                  }`}>
                    {job.status === 'completed' ? '✓ Complete' : job.status.toUpperCase()}
                  </span>
                </div>
                <div className="mt-3 text-sm font-medium">
                  {job.task_name === 'run_forecast' ? 'Forecast' : 'Trend Analysis'}
                </div>
                <div className="text-xs text-tx3 mt-1">
                  {job.task_params?.date_col} × {job.task_params?.val_col}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};
