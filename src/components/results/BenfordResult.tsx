import { useEffect, useState, useRef } from 'react';
import { Download, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../../lib/api';

const EXPECTED_BENFORD = [30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];

export const BenfordResult = ({ jobId, column }: { jobId: string; column?: string }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSamples, setTotalSamples] = useState(0);
  const [chiSquared, setChiSquared] = useState<number | null>(null);
  const [showInsights, setShowInsights] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await api.post('/query', {
          job_id: jobId,
          sql: 'SELECT digit, count FROM RESULT_TABLE ORDER BY digit',
        });

        const rows = res.data?.data || [];
        const total = rows.reduce((sum: number, r: any) => sum + Number(r.count || 0), 0);

        const formatted = rows.map((d: any, i: number) => ({
          digit: d.digit,
          observed: total > 0 ? parseFloat(((Number(d.count) / total) * 100).toFixed(2)) : 0,
          expected: EXPECTED_BENFORD[i] || 0,
        }));

        const chi = formatted.reduce((acc, row, i) => {
          const e = EXPECTED_BENFORD[i] || 1;
          return acc + Math.pow(row.observed - e, 2) / e;
        }, 0);

        setData(formatted);
        setTotalSamples(total);
        setChiSquared(chi);
      } catch (err: any) {
        console.error(err);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [jobId]);

  const downloadChart = async () => {
    if (!chartRef.current) {
      alert("Chart not ready yet. Please wait a moment.");
      return;
    }

    setIsDownloading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 600));

      const html2canvas = (await import('html2canvas')).default;

      const canvas = await html2canvas(chartRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        allowTaint: true,
      });

      const link = document.createElement('a');
      link.download = `benford-${column || 'analysis'}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    } catch (err) {
      console.error("Download error:", err);
      alert("Failed to download chart. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  const verdict = chiSquared === null
    ? null
    : chiSquared < 15.51
      ? { label: 'Strong Conformance', color: 'text-ok' }
      : chiSquared < 22
        ? { label: 'Moderate Deviation', color: 'text-warn' }
        : { label: 'Significant Deviation - Investigate', color: 'text-err' };

  if (loading) return <div className="h-96 flex items-center justify-center text-tx3">Loading Benford Analysis...</div>;
  if (error) return <div className="h-96 flex items-center justify-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-sub/30 p-4 rounded-xl border border-border">
          <div className="text-xs text-tx3">Sample Size</div>
          <div className="text-2xl font-bold">{totalSamples.toLocaleString()}</div>
        </div>
        <div className="bg-sub/30 p-4 rounded-xl border border-border">
          <div className="text-xs text-tx3">Chi-Squared</div>
          <div className="text-2xl font-bold">{chiSquared?.toFixed(2) || '—'}</div>
        </div>
        <div className="bg-sub/30 p-4 rounded-xl border border-border">
          <div className="text-xs text-tx3">Verdict</div>
          <div className={`text-lg font-semibold ${verdict?.color}`}>{verdict?.label}</div>
        </div>
        <div className="bg-sub/30 p-4 rounded-xl border border-border">
          <div className="text-xs text-tx3">Column</div>
          <div className="font-medium text-acc truncate">{column}</div>
        </div>
      </div>

      {/* Chart Section with Download Button Outside */}
      <div className="relative">
        <button
          onClick={downloadChart}
          disabled={isDownloading}
          className="absolute -top-4 right-4 z-30 flex items-center gap-2 bg-white dark:bg-sub border border-border px-4 py-2 rounded-xl text-sm font-medium hover:bg-sub transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={16} />
          {isDownloading ? 'Downloading...' : 'Download PNG'}
        </button>

        <div className="relative mt-8" ref={chartRef}>
          <div className="h-[420px] bg-white rounded-xl border border-border p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 20, right: 40, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="digit" />
                <YAxis unit="%" />
                <Tooltip />
                <Legend />
                <Bar dataKey="observed" name="Observed (%)" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expected" name="Benford Expected (%)" fill="#94a3b8" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* AI Insights Panel */}
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
          <div className="p-6 space-y-4 text-[13px] bg-panel">
            {verdict && (
              <div className={`p-4 rounded-xl border ${verdict.color.includes('err') ? 'border-red-200 bg-red-50' : ''}`}>
                {verdict.label}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <strong>Recommended Actions</strong>
                <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                  <li>Sample high-deviation records for vouching</li>
                  <li>Check for fabricated round numbers</li>
                  <li>Investigate digit 9 spikes</li>
                </ul>
              </div>
              <div>
                <strong>Red Flags</strong>
                <ul className="mt-2 space-y-1 text-tx3 list-disc pl-5">
                  <li>Extremely uniform distribution (~11% per digit)</li>
                  <li>Excessive usage of digit 9 or 5</li>
                  <li>Complete absence of certain digits</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};