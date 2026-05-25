import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Zap, AlertTriangle, XCircle, Filter,
  ChevronDown, ChevronUp, Search, ShieldAlert, BarChart2,
  Hash, Type, Calendar, ToggleLeft, DollarSign, Loader2,
  TrendingUp, ArrowUpDown, Download,
} from 'lucide-react';
import { GuidePanel } from '../components/GuidePanel';
import { EmptyState } from '../components/EmptyState';
import { api } from '../lib/api';
import { markGuideSeen } from '../lib/guideStorage';
import type { FileMetadata, JobStatus } from '../lib/types';

interface Props {
  file: FileMetadata | null;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, JobStatus>;
  goToUpload: () => void;
}

type FilterMode = 'all' | 'issues' | 'patterns';
type SortMode = 'quality_asc' | 'quality_desc' | 'name' | 'nulls_desc';

const TYPE_ICON: Record<string, React.ElementType> = {
  currency: DollarSign,
  number: Hash,
  date: Calendar,
  datetime: Calendar,
  boolean: ToggleLeft,
  text: Type,
  'Int64': Hash,
  'Float64': Hash,
  'Utf8': Type,
  'Boolean': ToggleLeft,
  'Date': Calendar,
  'Datetime': Calendar,
};

const getTypeIcon = (dtype: string) => {
  const d = String(dtype).toLowerCase();
  if (d.includes('float') || d.includes('int') || d.includes('number')) return Hash;
  if (d.includes('date') || d.includes('time')) return Calendar;
  if (d.includes('bool')) return ToggleLeft;
  if (d.includes('currency')) return DollarSign;
  return Type;
};

const scoreColor = (s: number) =>
  s >= 90 ? 'text-ok' : s >= 70 ? 'text-warn' : 'text-err';
const scoreBg = (s: number) =>
  s >= 90 ? 'bg-ok' : s >= 70 ? 'bg-warn' : 'bg-err';
const scoreBorder = (s: number) =>
  s >= 90 ? 'border-ok/30' : s >= 70 ? 'border-warn/30' : 'border-err/30';
const scoreLabel = (s: number) =>
  s >= 90 ? 'Excellent' : s >= 70 ? 'Fair' : 'Poor';

// Circular progress ring
const ScoreRing = ({ score, size = 56 }: { score: number; size?: number }) => {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={4} className="text-border" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={4}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  );
};

// Individual column card
const ColumnCard = ({ row }: { row: any }) => {
  const [expanded, setExpanded] = useState(false);
  const Icon = getTypeIcon(row.dtype);
  const score = row.quality_score ?? 0;
  const completeness = row.completeness_pct ?? 0;
  const uniqueness = row.uniqueness_pct ?? 0;
  const hasIssue = score < 70;
  const hasPattern = !!row.detected_pattern;

  return (
    <div className={`bg-surf border rounded-xl overflow-hidden transition-all ${scoreBorder(score)}`}>
      {/* Card header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left p-4 flex items-center gap-4 hover:bg-sub/20 transition-colors"
      >
        {/* Score ring */}
        <div className="relative shrink-0">
          <ScoreRing score={score} size={52} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-[11px] font-bold ${scoreColor(score)}`}>{score}</span>
          </div>
        </div>

        {/* Column info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon size={12} className="text-tx3 shrink-0" />
            <span className="text-[13px] font-mono font-semibold text-tx truncate">{row.column}</span>
            {hasIssue && <AlertTriangle size={12} className="text-err shrink-0" />}
            {hasPattern && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/20 shrink-0">
                {row.detected_pattern}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-tx3">
              {String(row.dtype).replace('Utf8', 'Text').replace('Float64', 'Number').replace('Int64', 'Integer')}
            </span>
            <span className="text-tx3 text-[10px]">·</span>
            <span className="text-[10px] font-mono text-tx3">{(row.null_count ?? 0).toLocaleString()} nulls</span>
            <span className="text-tx3 text-[10px]">·</span>
            <span className="text-[10px] font-mono text-tx3">{uniqueness}% unique</span>
          </div>
        </div>

        {/* Completeness bar */}
        <div className="hidden md:flex flex-col items-end gap-1 shrink-0 w-28">
          <span className="text-[10px] font-mono text-tx3">Completeness</span>
          <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreBg(completeness)}`} style={{ width: `${completeness}%` }} />
          </div>
          <span className={`text-[11px] font-mono font-bold ${scoreColor(completeness)}`}>{completeness}%</span>
        </div>

        {/* Quality label */}
        <div className="hidden md:flex flex-col items-end shrink-0 w-20">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            score >= 90 ? 'bg-ok/10 text-ok border-ok/20'
            : score >= 70 ? 'bg-warn/10 text-warn border-warn/20'
            : 'bg-err/10 text-err border-err/20'
          }`}>{scoreLabel(score)}</span>
        </div>

        <ChevronDown size={14} className={`text-tx3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border bg-sub/10 p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Completeness</div>
            <div className={`text-[20px] font-bold ${scoreColor(completeness)}`}>{completeness}%</div>
            <div className="text-[10px] text-tx3">{(row.null_count ?? 0).toLocaleString()} null values</div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Uniqueness</div>
            <div className="text-[20px] font-bold text-tx">{uniqueness}%</div>
            <div className="text-[10px] text-tx3">{row.distinct_count?.toLocaleString() ?? '—'} distinct values</div>
          </div>
          {row.detected_pattern && (
            <div>
              <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Pattern</div>
              <div className="text-[13px] font-semibold text-info">{row.detected_pattern}</div>
              {row.pattern_match_pct > 0 && (
                <div className="text-[10px] text-tx3">{row.pattern_match_pct}% match rate</div>
              )}
            </div>
          )}
          {row.top_values && (
            <div className="col-span-2 md:col-span-1">
              <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Top Values</div>
              <div className="text-[11px] font-mono text-tx2 leading-relaxed break-words">
                {row.top_values}
              </div>
            </div>
          )}
          {(row.min_value !== undefined || row.max_value !== undefined) && (
            <div>
              <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Range</div>
              <div className="text-[11px] font-mono text-tx2">
                {row.min_value ?? '—'} → {row.max_value ?? '—'}
              </div>
            </div>
          )}
          {row.mean_value !== undefined && (
            <div>
              <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Mean</div>
              <div className="text-[13px] font-semibold text-tx">
                {typeof row.mean_value === 'number' ? row.mean_value.toFixed(2) : row.mean_value}
              </div>
            </div>
          )}
          {/* Issue hint */}
          {hasIssue && (
            <div className="col-span-2 md:col-span-4 flex items-start gap-2 bg-err/5 border border-err/20 rounded-lg p-2 mt-1">
              <AlertTriangle size={12} className="text-err shrink-0 mt-0.5" />
              <p className="text-[11px] text-err leading-relaxed">
                {completeness < 70
                  ? `High null rate (${100 - completeness}% missing). Consider imputing or dropping this column before analysis.`
                  : score < 70
                  ? 'Quality issues detected. Review null values, type consistency, and top values before running analysis.'
                  : 'Minor quality issues detected.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ProfileTab = ({ file, startJob, jobs, goToUpload }: Props) => {
  const [profileData, setProfileData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('quality_asc');
  const [search, setSearch] = useState('');
  // Clear profile when file changes
  useEffect(() => {
  setProfileData([]);
}, [file?.file_id]);

  const latestJob = Object.values(jobs)
    .filter(j => j?.task_name === 'run_profile' && j?.status === 'completed')
    .slice(-1)[0];

  const running = Object.values(jobs).some(
    j => j?.task_name === 'run_profile' && (j.status === 'pending' || j.status === 'running')
  );

  useEffect(() => {
    if (!latestJob?.id) return;
    setLoading(true);
    api.post('/query', {
      job_id: latestJob.id,
      sql: 'SELECT * FROM RESULT_TABLE ORDER BY quality_score ASC',
    })
      .then(r => setProfileData(r.data?.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    markGuideSeen('profile');
  }, [latestJob?.id]);

  const overallScore = profileData.length
    ? Math.round(profileData.reduce((s: number, r: any) => s + (r.quality_score || 0), 0) / profileData.length)
    : null;

  const issueCount = profileData.filter((r: any) => r.quality_score < 70).length;
  const patternCount = profileData.filter((r: any) => r.detected_pattern).length;
  const highNullCount = profileData.filter((r: any) => r.completeness_pct < 80).length;

  const filtered = useMemo(() => {
    let data = [...profileData];
    if (filterMode === 'issues') data = data.filter(r => r.quality_score < 70);
    if (filterMode === 'patterns') data = data.filter(r => r.detected_pattern);
    if (search.trim()) data = data.filter(r => r.column?.toLowerCase().includes(search.toLowerCase()));
    switch (sortMode) {
      case 'quality_asc': data.sort((a, b) => a.quality_score - b.quality_score); break;
      case 'quality_desc': data.sort((a, b) => b.quality_score - a.quality_score); break;
      case 'name': data.sort((a, b) => a.column?.localeCompare(b.column)); break;
      case 'nulls_desc': data.sort((a, b) => b.null_count - a.null_count); break;
    }
    return data;
  }, [profileData, filterMode, sortMode, search]);

  const exportCSV = () => {
    if (!profileData.length) return;
    const headers = Object.keys(profileData[0]).join(',');
    const rows = profileData.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(',')).join('\n');
    const blob = new Blob([`${headers}\n${rows}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quality_profile_${file?.name || 'dataset'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const readinessLabel = overallScore === null ? null
    : overallScore >= 90 ? { label: 'Ready for Analysis', color: 'text-ok', bg: 'bg-ok/10 border-ok/30', icon: CheckCircle2 }
    : overallScore >= 70 ? { label: 'Review Recommended', color: 'text-warn', bg: 'bg-warn/10 border-warn/30', icon: AlertTriangle }
    : { label: 'Fix Issues First', color: 'text-err', bg: 'bg-err/10 border-err/30', icon: XCircle };

  return (
    <div className="space-y-6">
      <GuidePanel
        tabId="profile"
        icon={<CheckCircle2 size={15} />}
        title="Data Quality Profile"
        description="Runs a comprehensive quality scan across every column — identifying missing values, duplicates, outliers, type inconsistencies, and Indian regulatory patterns (PAN, GSTIN, IFSC)."
        whenToUse={[
          'Always run this first after uploading a dataset',
          'Before presenting data to a client or senior — verify it\'s clean',
          'When data comes from multiple sources and you suspect inconsistencies',
        ]}
        steps={[
          'Upload a dataset from the Data Source tab',
          "Click 'Run Profile' — the engine scores every column",
          'Review the Overall Quality Score and readiness banner',
          'Expand individual columns to see detailed stats and recommendations',
        ]}
        tip="A score below 70 means the column has serious quality issues. Address these in the Data Source tab before running Benford or Anomaly analysis."
      />

      {!file ? (
        <EmptyState goToUpload={goToUpload} message="Upload or load a dataset, then come back here to run the quality profile." />
      ) : (
        <>
          {/* ── Header ── */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-[16px] font-semibold text-tx">Data Quality Profile</div>
              <div className="text-[12px] text-tx2 mt-0.5">
                Column-level completeness, uniqueness, type consistency, and regulatory pattern detection
              </div>
            </div>
            <div className="flex items-center gap-2">
              {profileData.length > 0 && (
                <button
                  onClick={exportCSV}
                  className="btn btn-ghost text-[12px] flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl"
                >
                  <Download size={13} /> Export
                </button>
              )}
              <button
                onClick={() => startJob('run_profile')}
                disabled={running}
                className="btn btn-acc flex items-center gap-2 disabled:opacity-50"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                {running ? 'Profiling...' : 'Run Profile'}
              </button>
            </div>
          </div>

          {/* ── Running indicator ── */}
          {running && (
            <div className="flex items-center gap-3 bg-acc/5 border border-acc/20 rounded-xl p-4">
              <Loader2 size={16} className="animate-spin text-acc" />
              <div>
                <div className="text-[13px] font-semibold text-tx">Profiling in progress...</div>
                <div className="text-[11px] text-tx3">Scanning all columns for quality metrics and patterns</div>
              </div>
            </div>
          )}

          {/* ── Summary cards ── */}
          {overallScore !== null && !loading && (
            <>
              {/* Readiness banner */}
              {readinessLabel && (
                <div className={`flex items-center gap-3 border rounded-xl p-4 ${readinessLabel.bg}`}>
                  <readinessLabel.icon size={18} className={readinessLabel.color} />
                  <div>
                    <div className={`text-[13px] font-bold ${readinessLabel.color}`}>{readinessLabel.label}</div>
                    <div className="text-[11px] text-tx2 mt-0.5">
                      {overallScore >= 90
                        ? 'All columns meet quality thresholds. You can proceed to analysis confidently.'
                        : overallScore >= 70
                        ? `${issueCount} column${issueCount !== 1 ? 's' : ''} below threshold. Review before running analysis.`
                        : `${issueCount} column${issueCount !== 1 ? 's' : ''} have serious quality issues. Fix these before proceeding.`}
                    </div>
                  </div>
                </div>
              )}

              {/* Metric cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {/* Overall score */}
                <div className="bg-surf border border-border rounded-xl p-4 flex items-center gap-4 col-span-2 md:col-span-1">
                  <div className="relative shrink-0">
                    <ScoreRing score={overallScore} size={64} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-[13px] font-bold ${scoreColor(overallScore)}`}>{overallScore}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-tx3 uppercase">Overall Score</div>
                    <div className={`text-[13px] font-bold ${scoreColor(overallScore)}`}>{scoreLabel(overallScore)}</div>
                  </div>
                </div>

                <div className="bg-surf border border-border rounded-xl p-4">
                  <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Columns</div>
                  <div className="text-[28px] font-bold text-tx">{profileData.length}</div>
                  <div className="text-[10px] text-tx3">profiled</div>
                </div>

                <div className="bg-surf border border-border rounded-xl p-4">
                  <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Issues</div>
                  <div className={`text-[28px] font-bold ${issueCount > 0 ? 'text-err' : 'text-ok'}`}>{issueCount}</div>
                  <div className="text-[10px] text-tx3">score &lt; 70</div>
                </div>

                <div className="bg-surf border border-border rounded-xl p-4">
                  <div className="text-[10px] font-mono text-tx3 uppercase mb-1">High Nulls</div>
                  <div className={`text-[28px] font-bold ${highNullCount > 0 ? 'text-warn' : 'text-ok'}`}>{highNullCount}</div>
                  <div className="text-[10px] text-tx3">&gt;20% missing</div>
                </div>

                <div className="bg-surf border border-border rounded-xl p-4">
                  <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Patterns</div>
                  <div className={`text-[28px] font-bold ${patternCount > 0 ? 'text-info' : 'text-tx'}`}>{patternCount}</div>
                  <div className="text-[10px] text-tx3">PAN · GSTIN · IFSC</div>
                </div>
              </div>
            </>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="flex items-center justify-center py-20 gap-3 text-tx3">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-[13px] font-mono">Loading profile data...</span>
            </div>
          )}

          {/* ── Filter + Search + Sort bar ── */}
          {profileData.length > 0 && !loading && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx3" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search columns..."
                  className="pl-8 pr-3 py-2 text-[12px] bg-sub border border-border rounded-xl text-tx placeholder:text-tx3 focus:outline-none focus:border-acc w-48"
                />
              </div>

              {/* Filter buttons */}
              <div className="flex items-center gap-1 bg-sub rounded-xl p-1 border border-border">
                {([
                  { key: 'all', label: 'All', count: profileData.length },
                  { key: 'issues', label: 'Issues', count: issueCount },
                  { key: 'patterns', label: 'Patterns', count: patternCount },
                ] as const).map(({ key, label, count }) => (
                  <button
                    key={key}
                    onClick={() => setFilterMode(key)}
                    className={`text-[11px] px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                      filterMode === key
                        ? 'bg-acc text-white font-semibold'
                        : 'text-tx2 hover:text-tx'
                    }`}
                  >
                    {label}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${filterMode === key ? 'bg-white/20' : 'bg-border'}`}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Sort */}
              <div className="flex items-center gap-2 ml-auto">
                <ArrowUpDown size={12} className="text-tx3" />
                <select
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value as SortMode)}
                  className="text-[12px] bg-sub border border-border rounded-xl px-3 py-2 text-tx focus:outline-none focus:border-acc"
                >
                  <option value="quality_asc">Quality: Low → High</option>
                  <option value="quality_desc">Quality: High → Low</option>
                  <option value="name">Column Name</option>
                  <option value="nulls_desc">Most Nulls First</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Column cards ── */}
          {filtered.length > 0 && !loading && (
            <div className="space-y-3">
              {filtered.map((row: any, i: number) => (
                <ColumnCard key={row.column || i} row={row} />
              ))}
            </div>
          )}

          {filtered.length === 0 && profileData.length > 0 && !loading && (
            <div className="py-10 text-center text-tx3 text-[13px]">
              No columns match your filter.
            </div>
          )}

          {/* ── Empty state ── */}
          {!latestJob && !running && !loading && (
            <div className="flex flex-col items-center justify-center py-24 text-tx3 gap-4">
              <div className="p-6 rounded-2xl bg-sub/50 border border-border">
                <BarChart2 size={40} className="opacity-30" />
              </div>
              <div className="text-center">
                <div className="text-[14px] font-semibold text-tx mb-1">No Profile Yet</div>
                <div className="text-[12px] text-tx3">Click "Run Profile" to scan your dataset for quality issues</div>
              </div>
              <button
                onClick={() => startJob('run_profile')}
                className="btn btn-acc flex items-center gap-2 mt-2"
              >
                <Zap size={14} /> Run Profile Now
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
