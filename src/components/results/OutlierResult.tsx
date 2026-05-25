import { useEffect, useMemo, useState, useRef } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';

type Row = Record<string, any>;

const SCORE_KEYS = ['anomaly_score', 'zscore', 'score'] as const;

const pickScore = (row: Row): { value: number; key: string | null } => {
  for (const k of SCORE_KEYS) {
    if (row[k] !== undefined && row[k] !== null) {
      const n = Number(row[k]);
      if (Number.isFinite(n)) return { value: n, key: k };
    }
  }
  return { value: 0, key: null };
};

export const OutlierResult = ({ jobId, column, method }: { jobId: string; column: string; method?: string }) => {
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/query', {
          job_id: jobId,
          sql: `SELECT * FROM RESULT_TABLE LIMIT 50`,
        });
        if (!cancelled) setData(res.data.data || []);
      } catch (err) {
        console.error('Query failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  const { sortedRows, scoreKey, hasReason, maxAbsScore } = useMemo(() => {
    if (!data.length) return { sortedRows: [] as Row[], scoreKey: null as string | null, hasReason: false, maxAbsScore: 1 };
    const sample = data[0];
    const { key } = pickScore(sample);
    const hasReason = 'reason' in sample;
    let maxAbs = 0;
    const rows = [...data];
    if (key) {
      rows.sort((a, b) => Math.abs(Number(b[key]) || 0) - Math.abs(Number(a[key]) || 0));
      maxAbs = Math.max(...rows.map(r => Math.abs(Number(r[key]) || 0)), 1);
    }
    return { sortedRows: rows, scoreKey: key, hasReason, maxAbsScore: maxAbs };
  }, [data]);

  const downloadReport = async () => {
    if (!reportRef.current) {
      alert("Report not ready yet.");
      return;
    }

    setIsDownloading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const html2canvas = (await import('html2canvas')).default;

      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        allowTaint: true,
      });

      const link = document.createElement('a');
      link.download = `anomalies-${column || 'report'}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    } catch (err) {
      console.error("Download error:", err);
      alert("Failed to download report. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center font-mono text-[11px] text-tx3 animate-pulse">
        Scanning for Anomalies...
      </div>
    );
  }

  const showColumn = column || (sortedRows[0] ? Object.keys(sortedRows[0]).find(k => !SCORE_KEYS.includes(k as any) && k !== 'reason' && k !== 'is_anomaly') || Object.keys(sortedRows[0])[0] : '');

  const scoreLabel = scoreKey === 'zscore' ? 'Z-Score'
    : scoreKey === 'anomaly_score' ? 'Anomaly Score'
    : scoreKey === 'score' ? 'Score'
    : 'Severity';

  const severity = (absScore: number): { label: string; tone: string } => {
    const r = maxAbsScore > 0 ? absScore / maxAbsScore : 0;
    if (r >= 0.66) return { label: 'HIGH', tone: 'text-err' };
    if (r >= 0.33) return { label: 'MED',  tone: 'text-warn' };
    return { label: 'LOW', tone: 'text-tx3' };
  };

  return (
    <div className="space-y-6">
      {/* Header with Download Button */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-tx3 font-bold">Anomaly Detection Report</div>
          <div className="text-[11px] text-tx3 italic">Showing top {sortedRows.length} ranked by {scoreLabel.toLowerCase()}</div>
        </div>

        <button
          onClick={downloadReport}
          disabled={isDownloading}
          className="flex items-center gap-2 bg-white dark:bg-sub border border-border px-4 py-2 rounded-xl text-sm font-medium hover:bg-sub transition-all shadow-sm disabled:opacity-50"
        >
          <Download size={16} />
          {isDownloading ? 'Downloading...' : 'Download PNG'}
        </button>
      </div>

      {/* Main Report Content - This will be captured */}
      <div ref={reportRef} className="bg-white p-6 rounded-2xl border border-border">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-sub/30 p-4 rounded-xl border border-border">
            <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Detection Method</div>
            <div className="text-[14px] font-bold text-tx">{method || 'Z-Score / IQR Hybrid'}</div>
          </div>
          <div className="bg-sub/30 p-4 rounded-xl border border-border">
            <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Outlier Count</div>
            <div className="text-[14px] font-bold text-err">{sortedRows.length} Detected</div>
          </div>
          <div className="bg-sub/30 p-4 rounded-xl border border-border">
            <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Target Column</div>
            <div className="text-[14px] font-bold text-info truncate" title={showColumn}>{showColumn}</div>
          </div>
        </div>

        <div className="border border-border rounded-xl overflow-hidden bg-surf shadow-soft overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-sub/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-tx3 font-bold">Rank</th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-tx3 font-bold">{showColumn}</th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-tx3 font-bold">{scoreLabel}</th>
                {hasReason && <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-tx3 font-bold">Reason</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => {
                const score = scoreKey ? Number(row[scoreKey]) || 0 : 0;
                const abs = Math.abs(score);
                const pct = maxAbsScore > 0 ? Math.min(100, Math.max(8, (abs / maxAbsScore) * 100)) : 0;
                const sev = severity(abs);
                return (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-sub/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-tx3">#{i + 1}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-tx font-bold">{row[showColumn]?.toString() || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 bg-border rounded-full overflow-hidden">
                          <div className={`h-full ${sev.tone === 'text-err' ? 'bg-err' : sev.tone === 'text-warn' ? 'bg-warn' : 'bg-tx3'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-[10px] font-mono font-bold ${sev.tone}`}>
                          {scoreKey ? score.toFixed(2) : sev.label}
                        </span>
                      </div>
                    </td>
                    {hasReason && (
                      <td className="px-4 py-3 text-[11px] text-tx2 max-w-[260px] truncate" title={row.reason || ''}>
                        {row.reason || '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
              {sortedRows.length === 0 && (
                <tr><td colSpan={hasReason ? 4 : 3} className="px-4 py-6 text-center text-tx3 italic text-[12px]">No anomalies surfaced.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};