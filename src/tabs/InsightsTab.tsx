import { useEffect, useRef, useState } from 'react';
import {
  BarChart3, AlertTriangle, Activity, Layers, Network,
  FileText, Download, Trash2, Eye, EyeOff,
  ChevronDown, ChevronUp, CheckCircle2, Clock,
  Sparkles, RotateCcw,
} from 'lucide-react';
import { streamAi } from '../lib/sse';
import type { FileMetadata, JobStatus } from '../lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type SectionId = 'cover' | 'dataset' | 'benford' | 'anomalies' | 'timeseries' | 'clustering' | 'network';

interface Section {
  id: SectionId;
  title: string;
  icon: React.ElementType;
  visible: boolean;
  taskNames: string[];
}

interface AiState {
  text: string;
  loading: boolean;
  error: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_LABEL: Record<string, string> = {
  run_benford:    "Benford's Law",
  run_outliers:   'Anomaly Detection',
  run_timeseries: 'Temporal Trend',
  run_forecast:   'Forecast',
  run_clustering: 'Cluster Analysis',
  run_network:    'Network Mapping',
};

const paramSummary = (taskName: string, params: Record<string, any> = {}): string => {
  if (taskName === 'run_benford')    return `Column: ${params.column || '—'}`;
  if (taskName === 'run_outliers')   return `Column: ${params.column || '—'} · Method: ${params.method || 'auto'}`;
  if (taskName === 'run_timeseries') return `${params.date_col || '—'} × ${params.val_col || '—'}`;
  if (taskName === 'run_forecast')   return `${params.date_col || '—'} × ${params.val_col || '—'} · ${params.periods || 30} periods`;
  if (taskName === 'run_clustering') return `k=${params.k || '?'} · ${params.x_col || '—'} × ${params.y_col || '—'}`;
  if (taskName === 'run_network')    return `${params.src_col || params.source_col || '—'} → ${params.tgt_col || params.target_col || '—'}`;
  return '';
};

const ANALYSIS_TASK_NAMES = [
  'run_benford', 'run_outliers', 'run_timeseries',
  'run_forecast', 'run_clustering', 'run_network',
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  file: FileMetadata | null;
  jobs: Record<string, JobStatus>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const InsightsTab = ({ file, jobs }: Props) => {
  const printRef = useRef<HTMLDivElement>(null);

  // All completed analysis jobs from the store
  const completedJobs = Object.values(jobs).filter(
    j => j.status === 'completed' && ANALYSIS_TASK_NAMES.includes(j.task_name)
  );

  // Section definitions
  const [sections, setSections] = useState<Section[]>([
    { id: 'cover',      title: 'Cover Page',        icon: FileText,      visible: true, taskNames: [] },
    { id: 'dataset',    title: 'Dataset Overview',  icon: CheckCircle2,  visible: true, taskNames: [] },
    { id: 'benford',    title: "Benford's Law",     icon: BarChart3,     visible: true, taskNames: ['run_benford'] },
    { id: 'anomalies',  title: 'Anomaly Detection', icon: AlertTriangle, visible: true, taskNames: ['run_outliers'] },
    { id: 'timeseries', title: 'Temporal Analysis', icon: Activity,      visible: true, taskNames: ['run_timeseries', 'run_forecast'] },
    { id: 'clustering', title: 'Cluster Analysis',  icon: Layers,        visible: true, taskNames: ['run_clustering'] },
    { id: 'network',    title: 'Network Analysis',  icon: Network,       visible: true, taskNames: ['run_network'] },
  ]);

  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>({
    cover: false, dataset: false, benford: false,
    anomalies: false, timeseries: false, clustering: false, network: false,
  });

  // AI text per job id
  const [aiStates, setAiStates] = useState<Record<string, AiState>>({});

  // Cover fields
  const [reportTitle,    setReportTitle]    = useState('Audit Analytics Report');
  const [clientName,     setClientName]     = useState('');
  const [engagementDate, setEngagementDate] = useState(new Date().toISOString().slice(0, 10));
  const [preparedBy,     setPreparedBy]     = useState('');

  // ── Load AI for all completed jobs via SSE stream ──────────────────────────
  const loadAi = async (jobId: string) => {
    setAiStates(prev => ({ ...prev, [jobId]: { text: '', loading: true, error: false } }));
    try {
      const gen = streamAi(`/ai/explain/${jobId}`, {});
      let running = '';
      while (true) {
        const step = await gen.next();
        if (step.done) {
          running = step.value.text || running;
          break;
        }
        running = step.value as string;
        setAiStates(prev => ({ ...prev, [jobId]: { text: running, loading: true, error: false } }));
      }
      setAiStates(prev => ({ ...prev, [jobId]: { text: running, loading: false, error: false } }));
    } catch {
      setAiStates(prev => ({ ...prev, [jobId]: { text: '', loading: false, error: true } }));
    }
  };

  // Auto-load AI for newly completed jobs not yet fetched
  useEffect(() => {
    completedJobs.forEach(job => {
      if (!aiStates[job.id]) {
        loadAi(job.id);
      }
    });
  }, [completedJobs.map(j => j.id).join(',')]);

  // ── Section helpers ────────────────────────────────────────────────────────
  const toggleVisible  = (id: SectionId) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));

  const toggleCollapsed = (id: SectionId) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  const moveSection = (id: SectionId, dir: -1 | 1) => {
    setSections(prev => {
      const idx  = prev.findIndex(s => s.id === id);
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const jobsForSection = (s: Section) =>
    completedJobs.filter(j => s.taskNames.includes(j.task_name));

  const visibleSections = sections.filter(s => s.visible);

  // ── PDF export: render printable HTML into an iframe and print ────────────
  const handleExportPdf = () => {
    const content = buildPrintHtml({
      reportTitle, clientName, engagementDate, preparedBy,
      file, visibleSections, jobsForSection, aiStates,
    });

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow!.document;
    doc.open();
    doc.write(content);
    doc.close();

    iframe.contentWindow!.onload = () => {
      setTimeout(() => {
        iframe.contentWindow!.print();
        setTimeout(() => document.body.removeChild(iframe), 2000);
      }, 500);
    };
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-tx">Insights Report</h1>
          <p className="text-[12px] text-tx3 mt-0.5">
            Compile, edit and export a professional PDF of all completed analyses.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-tx3">
            {completedJobs.length} analysis{completedJobs.length !== 1 ? 'es' : ''} · {visibleSections.length} sections
          </span>
          <button onClick={handleExportPdf} className="btn btn-acc flex items-center gap-2 px-5 py-2.5">
            <Download size={15} /> Export PDF
          </button>
        </div>
      </div>

      {completedJobs.length === 0 && (
        <div className="bg-warn/5 border border-warn/20 rounded-2xl px-6 py-5 text-[13px] text-warn">
          No completed analyses found in this session. Run Benford, Anomaly, Temporal, Clustering, or Network analysis first, then return here.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Left: section manager ── */}
        <div className="xl:col-span-1 space-y-3">
          <div className="bg-surf border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-sub/30">
              <span className="text-[12px] font-semibold text-tx uppercase tracking-wider">Report Sections</span>
            </div>
            <div className="p-3 space-y-2">
              {sections.map((s, idx) => {
                const Icon    = s.icon;
                const jobCnt  = jobsForSection(s).length;
                const hasData = s.taskNames.length === 0 || jobCnt > 0;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${
                      s.visible ? 'border-border bg-surf' : 'border-dashed border-border/50 bg-sub/20 opacity-50'
                    }`}
                  >
                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveSection(s.id, -1)} disabled={idx === 0}
                        className="text-tx3 hover:text-tx disabled:opacity-20">
                        <ChevronUp size={11} />
                      </button>
                      <button onClick={() => moveSection(s.id, 1)} disabled={idx === sections.length - 1}
                        className="text-tx3 hover:text-tx disabled:opacity-20">
                        <ChevronDown size={11} />
                      </button>
                    </div>

                    <Icon size={13} className={s.visible ? 'text-acc' : 'text-tx3'} />

                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-tx truncate">{s.title}</div>
                      {s.taskNames.length > 0 && (
                        <div className={`text-[10px] font-mono mt-0.5 ${hasData ? 'text-ok' : 'text-tx3'}`}>
                          {hasData ? `${jobCnt} job${jobCnt !== 1 ? 's' : ''}` : 'no jobs yet'}
                        </div>
                      )}
                    </div>

                    <button onClick={() => toggleVisible(s.id)}
                      className="text-tx3 hover:text-tx transition-colors"
                      title={s.visible ? 'Hide' : 'Show'}>
                      {s.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hidden sections restore */}
          {sections.some(s => !s.visible) && (
            <div className="bg-sub/30 border border-dashed border-border rounded-2xl p-4">
              <div className="text-[10px] font-mono text-tx3 uppercase tracking-wider mb-2">Hidden — click to restore</div>
              <div className="flex flex-wrap gap-2">
                {sections.filter(s => !s.visible).map(s => {
                  const Icon = s.icon;
                  return (
                    <button key={s.id} onClick={() => toggleVisible(s.id)}
                      className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border border-border bg-surf hover:border-acc hover:text-acc text-tx2 transition-all">
                      <Icon size={10} /> {s.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="bg-surf border border-border rounded-2xl p-4 text-[11px] text-tx3 space-y-1.5">
            <div className="flex items-center gap-2"><Eye size={12} className="shrink-0" /> Eye icon hides section from PDF</div>
            <div className="flex items-center gap-2"><ChevronUp size={12} className="shrink-0" /><ChevronDown size={12} className="shrink-0" /> Arrows reorder sections</div>
            <div className="flex items-center gap-2"><Trash2 size={12} className="shrink-0" /> Remove button in section header</div>
          </div>
        </div>

        {/* ── Right: preview editor ── */}
        <div className="xl:col-span-2 space-y-4">

          {visibleSections.map((s, si) => {
            const Icon   = s.icon;
            const isOpen = !collapsed[s.id];
            return (
              <div key={s.id} className="bg-surf border border-border rounded-2xl overflow-hidden shadow-sm">
                {/* Section header */}
                <div className="px-5 py-4 border-b border-border bg-sub/20 flex items-center gap-3">
                  <span className="text-[10px] font-mono text-tx3 w-5">{String(si + 1).padStart(2, '0')}</span>
                  <Icon size={15} className="text-acc" />
                  <span className="text-[13px] font-semibold text-tx flex-1">{s.title}</span>
                  <button onClick={() => toggleVisible(s.id)}
                    className="flex items-center gap-1 text-[10px] font-mono text-tx3 hover:text-err px-2 py-1 rounded-lg hover:bg-err/5 border border-transparent hover:border-err/20 transition-all">
                    <Trash2 size={11} /> Remove
                  </button>
                  <button onClick={() => toggleCollapsed(s.id)}
                    className="text-tx3 hover:text-tx p-1 rounded-lg hover:bg-sub transition-colors">
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {/* Section body */}
                {isOpen && (
                  <div className="p-5">
                    {s.id === 'cover' && (
                      <div className="space-y-3">
                        <Field label="Report Title"    value={reportTitle}    onChange={setReportTitle} />
                        <Field label="Client / Entity" value={clientName}     onChange={setClientName} placeholder="e.g. Acme Pvt Ltd" />
                        <Field label="Date"            value={engagementDate} onChange={setEngagementDate} type="date" />
                        <Field label="Prepared By"     value={preparedBy}     onChange={setPreparedBy} placeholder="e.g. CA Ramesh Kumar" />
                      </div>
                    )}

                    {s.id === 'dataset' && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatBox label="Dataset"  value={file?.name || '—'} />
                        <StatBox label="Rows"     value={(file?.row_count_approx || 0).toLocaleString()} />
                        <StatBox label="Columns"  value={(file?.columns?.length || 0).toString()} />
                        <StatBox label="Analyses" value={completedJobs.length.toString()} />
                      </div>
                    )}

                    {s.taskNames.length > 0 && (
                      <div className="space-y-4">
                        {jobsForSection(s).length === 0 ? (
                          <div className="py-8 text-center text-tx3 text-[12px] italic border border-dashed border-border rounded-xl">
                            No completed {s.title} jobs in this session.
                          </div>
                        ) : (
                          jobsForSection(s).map(job => {
                            const ai = aiStates[job.id];
                            return (
                              <div key={job.id} className="border border-border rounded-xl overflow-hidden">
                                <div className="px-4 py-3 bg-sub/30 flex items-center justify-between gap-3 flex-wrap">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[10px] text-tx3">#{job.id.slice(0, 8)}</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-ok/10 text-ok border-ok/20 font-medium">
                                      ✓ Complete
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-tx2 font-mono">
                                    {paramSummary(job.task_name, job.task_params || {})}
                                  </span>
                                </div>
                                <div className="p-4 text-[12px] text-tx2">
                                  {(!ai || ai.loading) && (
                                    <div className="flex items-center gap-2 text-tx3 animate-pulse">
                                      <Sparkles size={12} />
                                      {ai?.text || 'Generating AI interpretation…'}
                                    </div>
                                  )}
                                  {ai && !ai.loading && ai.error && (
                                    <div className="flex items-center gap-2 text-err/70 text-[11px]">
                                      AI interpretation unavailable.
                                      <button onClick={() => loadAi(job.id)}
                                        className="flex items-center gap-1 text-acc hover:underline">
                                        <RotateCcw size={10} /> Retry
                                      </button>
                                    </div>
                                  )}
                                  {ai && !ai.loading && !ai.error && ai.text && (
                                    <div className="leading-relaxed whitespace-pre-wrap">{ai.text}</div>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Export CTA */}
          <div className="bg-acc/5 border border-acc/20 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[13px] font-semibold text-tx mb-0.5">Ready to export?</div>
              <div className="text-[11px] text-tx3">
                {visibleSections.length} sections · {completedJobs.length} completed analyses
              </div>
            </div>
            <button onClick={handleExportPdf} className="btn btn-acc flex items-center gap-2 px-6 py-2.5">
              <Download size={15} /> Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const Field = ({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) => (
  <div className="flex items-center gap-4">
    <label className="text-[11px] font-mono text-tx3 uppercase tracking-wider w-32 shrink-0">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="flex-1 bg-sub border border-border rounded-lg px-3 py-2 text-[12px] text-tx outline-none focus:border-acc/50" />
  </div>
);

const StatBox = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-sub/30 border border-border rounded-xl p-4">
    <div className="text-[10px] font-mono text-tx3 uppercase mb-1">{label}</div>
    <div className="text-[16px] font-bold text-tx truncate" title={value}>{value}</div>
  </div>
);

// ── PDF HTML builder ───────────────────────────────────────────────────────────
// Renders self-contained HTML into an iframe then calls print() on it.
// This is the only reliable cross-browser approach — CSS @media print tricks
// fail because they hide the parent document, not the iframe content.

interface PrintArgs {
  reportTitle: string;
  clientName: string;
  engagementDate: string;
  preparedBy: string;
  file: FileMetadata | null;
  visibleSections: Section[];
  jobsForSection: (s: Section) => JobStatus[];
  aiStates: Record<string, AiState>;
}

function buildPrintHtml(a: PrintArgs): string {
  const { reportTitle, clientName, engagementDate, preparedBy, file, visibleSections, jobsForSection, aiStates } = a;

  const sectionHtml = visibleSections
    .filter(s => s.id !== 'cover')
    .map((s, si) => {
      let body = '';

      if (s.id === 'dataset') {
        body = `
          <div class="stats-grid">
            ${[
              { l: 'Dataset',  v: file?.name || '—' },
              { l: 'Rows',     v: (file?.row_count_approx || 0).toLocaleString() },
              { l: 'Columns',  v: (file?.columns?.length || 0).toString() },
            ].map(m => `
              <div class="stat-box">
                <div class="stat-label">${m.l}</div>
                <div class="stat-value">${m.v}</div>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        const jobs = jobsForSection(s);
        if (!jobs.length) {
          body = `<p class="no-data">No completed jobs for this analysis.</p>`;
        } else {
          body = jobs.map(job => {
            const ai     = aiStates[job.id];
            const aiText = ai?.text || 'AI interpretation not available.';
            const params = paramSummary(job.task_name, job.task_params || {});
            return `
              <div class="job-card">
                <div class="job-header">
                  <span class="job-id">${TASK_LABEL[job.task_name] || job.task_name} · #${job.id.slice(0, 8)}</span>
                  <span class="job-params">${params}</span>
                </div>
                <div class="job-body">${aiText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
              </div>
            `;
          }).join('');
        }
      }

      return `
        <div class="section ${si > 0 ? 'page-break' : ''}">
          <div class="section-header">
            <span class="section-num">0${si + 1}</span>
            <h2>${s.title}</h2>
          </div>
          ${body}
        </div>
      `;
    }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${reportTitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; background: white; }

  /* Cover */
  .cover { min-height: 100vh; display: flex; flex-direction: column; justify-content: space-between; padding: 60pt 48pt; border-bottom: 4pt solid #9a3324; }
  .cover-eyebrow { font-size: 8pt; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; color: #9a3324; margin-bottom: 24pt; }
  .cover h1 { font-size: 32pt; font-weight: 700; line-height: 1.2; color: #1a1a1a; margin-bottom: 12pt; }
  .cover-client { font-size: 14pt; color: #4a4a4a; margin-bottom: 6pt; }
  .cover-meta { font-size: 10pt; color: #8a7d70; }
  .cover-footer { font-size: 8pt; color: #8a7d70; font-family: monospace; }

  /* Sections */
  .section { padding: 48pt; }
  .page-break { page-break-before: always; }
  .section-header { display: flex; align-items: baseline; gap: 12pt; margin-bottom: 24pt; padding-bottom: 8pt; border-bottom: 2pt solid #9a3324; }
  .section-num { font-size: 9pt; font-family: monospace; color: #9a3324; font-weight: 700; }
  .section-header h2 { font-size: 18pt; font-weight: 700; color: #1a1a1a; }

  /* Stats */
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12pt; margin-bottom: 16pt; }
  .stat-box { border: 1pt solid #e3dcd3; border-radius: 6pt; padding: 12pt; }
  .stat-label { font-size: 7pt; font-family: monospace; text-transform: uppercase; letter-spacing: 0.08em; color: #8a7d70; margin-bottom: 4pt; }
  .stat-value { font-size: 16pt; font-weight: 700; }

  /* Job cards */
  .job-card { border: 1pt solid #e3dcd3; border-radius: 6pt; overflow: hidden; margin-bottom: 14pt; }
  .job-header { background: #f0ebe3; padding: 8pt 12pt; display: flex; justify-content: space-between; align-items: center; border-bottom: 1pt solid #e3dcd3; }
  .job-id { font-size: 8pt; font-family: monospace; color: #4a4a4a; font-weight: 600; }
  .job-params { font-size: 8pt; font-family: monospace; color: #8a7d70; }
  .job-body { padding: 12pt; font-size: 10pt; line-height: 1.6; color: #2a2a2a; }

  /* No data */
  .no-data { color: #8a7d70; font-style: italic; font-size: 10pt; padding: 12pt 0; }

  /* Disclaimer */
  .disclaimer { padding: 32pt 48pt; border-top: 2pt solid #9a3324; }
  .disclaimer p { font-size: 8pt; color: #8a7d70; line-height: 1.6; font-family: monospace; }

  @page { size: A4; margin: 0; }
</style>
</head>
<body>

<div class="cover">
  <div>
    <div class="cover-eyebrow">Audit Analytics Report</div>
    <h1>${reportTitle}</h1>
    ${clientName ? `<p class="cover-client">${clientName}</p>` : ''}
    <p class="cover-meta">${engagementDate}${preparedBy ? ` &nbsp;·&nbsp; Prepared by: ${preparedBy}` : ''}</p>
  </div>
  <div class="cover-footer">
    Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; DataSense Pro &nbsp;·&nbsp; Varma &amp; Varma Chartered Accountants
  </div>
</div>

${sectionHtml}

<div class="disclaimer page-break">
  <p>This report was generated automatically by DataSense Pro. All analysis results should be reviewed
  and interpreted by a qualified professional before use in audit conclusions or formal reports.
  &copy; Varma &amp; Varma Chartered Accountants.</p>
</div>

</body>
</html>`;
}
