// import { useEffect, useState, useMemo } from 'react';
// import { Activity, Zap, Calendar, TrendingUp, Lightbulb, ChevronDown, ChevronUp, Clock } from 'lucide-react';
// import { Card } from '../../components/Card';
// import { GuidePanel } from '../../components/GuidePanel';
// import { TimeSeriesResult } from '../../components/results/TimeSeriesResult';
// import { AiInsightPanel } from '../../components/AiInsightPanel';
// import { JobStatusCard } from '../../components/JobStatusCard';
// import type { FileMetadata, JobStatus } from '../../lib/types';

// interface Props {
//   file: FileMetadata;
//   startJob: (taskName: string, params?: any) => void;
//   jobs: Record<string, JobStatus>;
// }

// export const TemporalTab = ({ file, startJob, jobs }: Props) => {
//   const allCols = file.columns || [];

//   const dateCols = useMemo(() =>
//     allCols.filter(col => {
//       const lower = col.toLowerCase();
//       return lower.includes('date') || lower.includes('time') ||
//              lower.includes('day')  || lower.includes('month') || lower.includes('year');
//     }), [allCols]);

//   const numericCols = useMemo(() =>
//     allCols.filter(col => !dateCols.includes(col)), [allCols, dateCols]);

//   const [dateCol, setDateCol] = useState<string>('');
//   const [valCol,  setValCol]  = useState<string>('');
//   const [showInsights, setShowInsights] = useState(true);

//   useEffect(() => {
//     if (dateCols.length > 0 && !dateCols.includes(dateCol)) setDateCol(dateCols[0]);
//     if (numericCols.length > 0 && !numericCols.includes(valCol)) setValCol(numericCols[0]);
//   }, [dateCols, numericCols, dateCol, valCol]);

//   const availableValCols = numericCols.filter(col => col !== dateCol);

//   const allJobs = Object.values(jobs).filter(j =>
//     j?.task_name === 'run_timeseries' || j?.task_name === 'run_forecast'
//   );

//   const latestJob = allJobs.filter(j => j?.status === 'completed').slice(-1)[0];

//   const runAnalysis = () => {
//     if (!dateCol || !valCol) return;
//     startJob('run_timeseries', { date_col: dateCol, val_col: valCol });
//   };

//   const runForecast = () => {
//     if (!dateCol || !valCol) return;
//     startJob('run_forecast', { date_col: dateCol, val_col: valCol, periods: 30 });
//   };

//   return (
//     <div className="space-y-6">
//       <GuidePanel
//         tabId="timeseries"
//         icon={<Activity size={15} />}
//         title="Temporal Analysis"
//         description="Analyze trends, seasonality, and anomalies over time in your dataset."
//         whenToUse={[
//           'Sales, expense, or payment trends over time',
//           'Detecting period-end anomalies',
//           'Understanding seasonality and forecasting',
//         ]}
//         steps={['Select Date column', 'Select Value column', 'Run Trend Analysis or Forecast']}
//         tip="Look for unusual spikes near month/year ends or sudden trend changes."
//       />

//       {/* Configuration */}
//       <Card title="Temporal Analysis Configuration" icon={Activity}>
//         <div className="flex flex-col md:flex-row gap-6 items-end">
//           <div className="flex-1 space-y-2">
//             <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider flex items-center gap-2">
//               <Calendar size={14} /> Date Column
//             </label>
//             <select value={dateCol} onChange={e => setDateCol(e.target.value)}
//               className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20">
//               <option value="">Select Date Column...</option>
//               {dateCols.map(col => <option key={col} value={col}>{col}</option>)}
//             </select>
//           </div>
//           <div className="flex-1 space-y-2">
//             <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider flex items-center gap-2">
//               <TrendingUp size={14} /> Value Column
//             </label>
//             <select value={valCol} onChange={e => setValCol(e.target.value)}
//               className="w-full bg-sub border border-border rounded-lg px-4 py-3 text-[13px] focus:ring-2 focus:ring-acc/20">
//               <option value="">Select Value Column...</option>
//               {availableValCols.map(col => <option key={col} value={col}>{col}</option>)}
//             </select>
//           </div>
//           <div className="flex gap-3">
//             <button onClick={runAnalysis} disabled={!dateCol || !valCol}
//               className="btn btn-ghost px-6 py-3 disabled:opacity-50">
//               Analyze Trend
//             </button>
//             <button onClick={runForecast} disabled={!dateCol || !valCol}
//               className="btn btn-acc px-6 py-3 flex items-center gap-2 disabled:opacity-50">
//               <Zap size={16} /> Forecast (30 days)
//             </button>
//           </div>
//         </div>
//       </Card>

//       {/* Results + Insights */}
//       <Card title="Time Series Results" icon={Activity}>
//         {latestJob ? (
//           <div className="space-y-8">
//             <TimeSeriesResult
//               jobId={latestJob.id}
//               dateCol={latestJob.task_params?.date_col || ''}
//               valCol={latestJob.task_params?.val_col || ''}
//             />

//             <div className="border border-border rounded-2xl overflow-hidden">
//               <button onClick={() => setShowInsights(!showInsights)}
//                 className="w-full px-6 py-4 bg-sub hover:bg-sub/80 flex items-center justify-between font-medium">
//                 <div className="flex items-center gap-3">
//                   <Lightbulb className="text-amber-500" size={20} />
//                   Key Insights & Audit Recommendations
//                 </div>
//                 {showInsights ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
//               </button>
//               {showInsights && (
//                 <div className="p-6 space-y-5 text-[13px]">
//                   <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 font-medium">
//                     Trend & Seasonality Analysis
//                   </div>
//                   <div className="grid md:grid-cols-2 gap-6">
//                     <div>
//                       <strong>Recommended Actions</strong>
//                       <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
//                         <li>Investigate sudden spikes or drops in trend</li>
//                         <li>Check for month-end / year-end anomalies</li>
//                         <li>Review forecast accuracy</li>
//                         <li>Look for seasonal patterns</li>
//                       </ul>
//                     </div>
//                     <div>
//                       <strong>Red Flags</strong>
//                       <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
//                         <li>Unexpected volatility or breaks in trend</li>
//                         <li>Missing data in critical periods</li>
//                         <li>Unusual seasonal deviations</li>
//                         <li>Sharp changes from historical pattern</li>
//                       </ul>
//                     </div>
//                   </div>
//                   <div className="pt-4 border-t border-border">
//                     <AiInsightPanel jobId={latestJob.id} />
//                   </div>
//                 </div>
//               )}
//             </div>
//           </div>
//         ) : (
//           <div className="py-24 text-center text-tx3">
//             <Activity size={48} className="mx-auto mb-4 opacity-30" />
//             <p>Run a temporal analysis or forecast to see results and insights here.</p>
//           </div>
//         )}
//       </Card>

//       {/* Job History — fixed: use Clock icon not undefined History */}
//       <Card title="Analysis History" icon={Clock}>
//         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
//           {allJobs.length === 0 ? (
//             <div className="col-span-full py-12 text-center text-tx3">
//               No previous temporal analyses found.
//             </div>
//           ) : (
//             allJobs.slice().reverse().map(job => (
//               <div key={job.id} className="p-4 border border-border rounded-xl bg-sub/30 hover:bg-sub/50 transition-all">
//                 <div className="flex justify-between items-start">
//                   <span className="font-mono text-xs text-tx2">#{job.id.slice(0, 8)}</span>
//                   <span className={`text-xs px-3 py-1 rounded-full ${
//                     job.status === 'completed' ? 'bg-ok/10 text-ok border border-ok/20' : 'bg-warn/10 text-warn border border-warn/20'
//                   }`}>
//                     {job.status === 'completed' ? '✓ Complete' : job.status.toUpperCase()}
//                   </span>
//                 </div>
//                 <div className="mt-3 text-sm font-medium">
//                   {job.task_name === 'run_forecast' ? 'Forecast' : 'Trend Analysis'}
//                 </div>
//                 <div className="text-xs text-tx3 mt-1">
//                   {job.task_params?.date_col} × {job.task_params?.val_col}
//                 </div>
//               </div>
//             ))
//           )}
//         </div>
//       </Card>
//     </div>
//   );
// };



import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Activity, Zap, Calendar, TrendingUp, Lightbulb, ChevronDown, ChevronUp, Clock, Filter } from 'lucide-react';
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

  // Month filter state
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);

  // Ref to the Month Filter button for fixed-position calculation
  const monthBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 256 });

  useEffect(() => {
    if (dateCols.length > 0 && !dateCols.includes(dateCol)) setDateCol(dateCols[0]);
    if (numericCols.length > 0 && !numericCols.includes(valCol)) setValCol(numericCols[0]);
  }, [dateCols, numericCols, dateCol, valCol]);

  const availableValCols = numericCols.filter(col => col !== dateCol);

  const allJobs = Object.values(jobs).filter(j =>
    j?.task_name === 'run_timeseries' || j?.task_name === 'run_forecast'
  );

  const latestJob = allJobs.filter(j => j?.status === 'completed').slice(-1)[0];

  const toggleMonth = (monthIndex: number) => {
    setSelectedMonths(prev =>
      prev.includes(monthIndex)
        ? prev.filter(m => m !== monthIndex)
        : [...prev, monthIndex].sort((a, b) => a - b)
    );
  };

  const clearMonths = () => setSelectedMonths([]);

  const monthFilterLabel = () => {
    if (selectedMonths.length === 0) return 'All months';
    if (selectedMonths.length === 1) return MONTH_NAMES[selectedMonths[0]];
    if (selectedMonths.length <= 3) return selectedMonths.map(m => MONTH_NAMES[m].slice(0, 3)).join(', ');
    return `${selectedMonths.length} months selected`;
  };

  const buildParams = () => {
    const params: any = { date_col: dateCol, val_col: valCol };
    if (selectedMonths.length > 0) {
      params.filter_months = selectedMonths.map(m => m + 1);
    }
    return params;
  };

  const runAnalysis = () => {
    if (!dateCol || !valCol) return;
    startJob('run_timeseries', buildParams());
  };

  const runForecast = () => {
    if (!dateCol || !valCol) return;
    startJob('run_forecast', { ...buildParams(), periods: 30 });
  };

  // Open dropdown and calculate fixed screen position from button
  const openDropdown = useCallback(() => {
    if (monthBtnRef.current) {
      const rect = monthBtnRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(256, rect.width),
      });
    }
    setMonthDropdownOpen(o => !o);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!monthDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const dropdown = document.getElementById('month-filter-dropdown');
      if (
        monthBtnRef.current && !monthBtnRef.current.contains(e.target as Node) &&
        dropdown && !dropdown.contains(e.target as Node)
      ) {
        setMonthDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [monthDropdownOpen]);

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
        steps={['Select Date column', 'Select Value column', 'Optionally filter by month(s)', 'Run Trend Analysis or Forecast']}
        tip="Use the month filter to analyse a specific period — e.g. select March only to compare year-over-year March figures."
      />

      {/* Configuration Card */}
      <Card title="Temporal Analysis Configuration" icon={Activity}>
        <div className="flex flex-wrap gap-3 items-end">

          {/* Date Column */}
          <div className="flex-1 min-w-[130px] space-y-1.5">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar size={12} /> Date Column
            </label>
            <select value={dateCol} onChange={e => setDateCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-3 py-2 text-[12px] focus:ring-2 focus:ring-acc/20">
              <option value="">Select...</option>
              {dateCols.map(col => <option key={col} value={col}>{col}</option>)}
            </select>
          </div>

          {/* Value Column */}
          <div className="flex-1 min-w-[130px] space-y-1.5">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp size={12} /> Value Column
            </label>
            <select value={valCol} onChange={e => setValCol(e.target.value)}
              className="w-full bg-sub border border-border rounded-lg px-3 py-2 text-[12px] focus:ring-2 focus:ring-acc/20">
              <option value="">Select...</option>
              {availableValCols.map(col => <option key={col} value={col}>{col}</option>)}
            </select>
          </div>

          {/* Month Filter — optional */}
          <div className="flex-1 min-w-[130px] space-y-1.5">
            <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider flex items-center gap-1.5">
              <Filter size={12} /> Month Filter
              <span className="text-[9px] font-normal normal-case text-tx3">(optional)</span>
            </label>
            <button
              ref={monthBtnRef}
              onClick={openDropdown}
              className={`w-full flex items-center justify-between bg-sub border rounded-lg px-3 py-2 text-[12px] transition-all ${
                selectedMonths.length > 0
                  ? 'border-acc text-acc bg-acc/5'
                  : 'border-border text-tx2 hover:border-acc'
              }`}
            >
              <span className="truncate">{monthFilterLabel()}</span>
              <ChevronDown size={12} className={`flex-shrink-0 ml-1 transition-transform ${monthDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={runAnalysis} disabled={!dateCol || !valCol}
              className="btn btn-ghost px-4 py-2 text-[12px] disabled:opacity-50 whitespace-nowrap">
              Analyze Trend
            </button>
            <button onClick={runForecast} disabled={!dateCol || !valCol}
              className="btn btn-acc px-4 py-2 text-[12px] flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
              <Zap size={14} /> Forecast 30 days
            </button>
          </div>
        </div>

        {/* Active month filter indicator strip */}
        {selectedMonths.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-acc font-mono bg-acc/5 border border-acc/20 rounded-lg px-3 py-2">
            <Filter size={11} />
            Filtering to: {selectedMonths.map(m => MONTH_NAMES[m]).join(', ')}
            <button onClick={clearMonths} className="ml-auto text-tx3 hover:text-err transition-colors text-[10px]">
              ✕ Remove filter
            </button>
          </div>
        )}
      </Card>

      {/* ── Month dropdown rendered with fixed positioning ──
           This sits OUTSIDE the Card so it is never clipped by overflow:hidden */}
      {monthDropdownOpen && (
        <div
          id="month-filter-dropdown"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
          }}
          className="bg-surf border border-border rounded-xl shadow-xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-[10px] font-mono text-tx3 uppercase tracking-wider">Select months</span>
            {selectedMonths.length > 0 && (
              <button onClick={clearMonths} className="text-[10px] text-acc hover:underline">
                Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 p-2">
            {MONTH_NAMES.map((name, idx) => (
              <button
                key={idx}
                onClick={() => toggleMonth(idx)}
                className={`text-[11px] font-mono py-1.5 px-2 rounded-lg border transition-all ${
                  selectedMonths.includes(idx)
                    ? 'bg-acc text-white border-acc'
                    : 'border-border text-tx2 hover:border-acc hover:text-acc'
                }`}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>

          <div className="px-3 py-2 border-t border-border">
            <p className="text-[9px] text-tx3 font-mono">
              {selectedMonths.length === 0
                ? 'No filter — entire dataset will be analysed'
                : `Analysing ${selectedMonths.length} month${selectedMonths.length > 1 ? 's' : ''} only`}
            </p>
            <button
              onClick={() => setMonthDropdownOpen(false)}
              className="mt-1.5 w-full text-[11px] py-1 rounded-lg bg-acc text-white hover:bg-acc/90 transition-all"
            >
              Done
            </button>
          </div>
        </div>
      )}

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

      {/* Job History */}
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
                {job.task_params?.filter_months && job.task_params.filter_months.length > 0 && (
                  <div className="text-xs text-acc mt-1 font-mono">
                    Months: {job.task_params.filter_months.map((m: number) => MONTH_NAMES[m - 1]?.slice(0, 3)).join(', ')}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};