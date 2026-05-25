import { useEffect, useRef, useState } from 'react';
import { Trash2, LayoutDashboard, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { api } from '../lib/api';
import { GuidePanel } from '../components/GuidePanel';

interface Pin {
  id: string;
  job_id: string;
  title: string;
  chart_type: string;
  config_json: any;
  position: number;
}

const PALETTE = ['#9a3324', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777'];

const PinCard = ({ pin, onDelete }: { pin: Pin; onDelete: () => void }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(300);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setChartWidth(el.offsetWidth || 300);
    const handler = () => setChartWidth(el.offsetWidth || 300);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.post('/query', { job_id: pin.job_id, sql: 'SELECT * FROM RESULT_TABLE LIMIT 200' })
      .then(r => { if (!cancelled) setData(r.data?.data || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pin.job_id]);

  const renderChart = () => {
    if (loading) {
      return <div className="h-40 flex items-center justify-center text-[11px] text-tx3 animate-pulse">Loading…</div>;
    }
    if (!data.length) {
      return <div className="h-40 flex items-center justify-center text-[11px] text-tx3 italic">No data</div>;
    }

    const sample = data[0];
    const keys = Object.keys(sample);
    const xKey = pin.config_json?.x_key || keys[0] || 'x';
    const yKey = pin.config_json?.y_key || keys[1] || 'y';
    const w = chartWidth;
    const h = 160;
    const margin = { top: 6, right: 12, left: 0, bottom: 6 };

    return (
      <div ref={containerRef} className="w-full overflow-x-auto">
        {pin.chart_type === 'line' ? (
          <LineChart data={data} width={w} height={h} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <Tooltip contentStyle={{ fontSize: '11px', backgroundColor: 'var(--color-surf)', borderColor: 'var(--color-border)', borderRadius: '6px' }} />
            <Line type="monotone" dataKey={yKey} stroke="var(--color-acc)" dot={false} strokeWidth={2} />
          </LineChart>
        ) : pin.chart_type === 'area' ? (
          <AreaChart data={data} width={w} height={h} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <Tooltip contentStyle={{ fontSize: '11px', backgroundColor: 'var(--color-surf)', borderColor: 'var(--color-border)', borderRadius: '6px' }} />
            <Area type="monotone" dataKey={yKey} stroke="var(--color-acc)" fill="var(--color-acc)" fillOpacity={0.2} />
          </AreaChart>
        ) : pin.chart_type === 'scatter' ? (
          <ScatterChart data={data} width={w} height={h} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey={xKey} type="number" tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <YAxis dataKey={yKey} type="number" tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ fontSize: '11px', backgroundColor: 'var(--color-surf)', borderColor: 'var(--color-border)', borderRadius: '6px' }} />
            <Scatter data={data} fill={PALETTE[0]} fillOpacity={0.6} />
          </ScatterChart>
        ) : (
          <BarChart data={data} width={w} height={h} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--color-tx3)' }} />
            <Tooltip contentStyle={{ fontSize: '11px', backgroundColor: 'var(--color-surf)', borderColor: 'var(--color-border)', borderRadius: '6px' }} />
            <Bar dataKey={yKey} fill="var(--color-acc)" radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </div>
    );
  };

  return (
    <div className="bg-surf border border-border rounded-xl p-4 space-y-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-tx truncate">{pin.title}</div>
          <div className="text-[10px] font-mono text-tx3 mt-0.5 truncate">
            {pin.chart_type} · job {pin.job_id.slice(0, 8)}
          </div>
        </div>
        <button onClick={onDelete} className="text-tx3 hover:text-err transition-colors flex-shrink-0" title="Remove pin">
          <Trash2 size={13} />
        </button>
      </div>
      {renderChart()}
    </div>
  );
};

export const DashboardTab = () => {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/dashboard/pins')
      .then(r => setPins(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const deletePin = async (pinId: string) => {
    await api.delete(`/dashboard/pins/${pinId}`).catch(() => {});
    setPins(prev => prev.filter(p => p.id !== pinId));
  };

  return (
    <div className="space-y-5">
      <GuidePanel
        tabId="dashboard"
        icon={<LayoutDashboard size={15} />}
        title="Dashboard"
        description="Charts you've pinned from any analysis tab. Useful for compiling a partner-facing summary or watching a small set of metrics across multiple datasets at once."
        whenToUse={[
          'Building a one-page report after running several analyses',
          'Tracking specific KPIs across recurring engagements',
          'Sharing visual highlights with a senior or client',
        ]}
        steps={[
          'Run any analysis (Benford, Outliers, Temporal, Clusters, Network, Ratios)',
          'Click "Pin to Dashboard" on a completed result',
          'Give it a title — it appears here',
        ]}
        tip="Pinned charts always re-fetch the latest 200 rows of their job's RESULT_TABLE — so they stay accurate if the underlying job is re-run on fresh data with the same job ID."
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={15} className="text-acc" />
          <span className="text-[14px] font-semibold text-tx">Pinned Charts</span>
          <span className="text-[10px] font-mono text-tx3 bg-sub px-2 py-0.5 rounded-full">{pins.length}</span>
        </div>
        <button onClick={load} className="text-tx3 hover:text-tx transition-colors text-[11px] font-mono flex items-center gap-1.5" title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-[12px] text-tx3 animate-pulse">Loading dashboard...</div>
      ) : pins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 bg-surf border border-border rounded-xl">
          <LayoutDashboard size={36} className="text-tx3 opacity-30" />
          <div>
            <p className="text-[13px] text-tx">No pinned charts yet</p>
            <p className="text-[11px] text-tx3 mt-1">Run an analysis and click "Pin to Dashboard" on a completed result.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pins.map(pin => <PinCard key={pin.id} pin={pin} onDelete={() => deletePin(pin.id)} />)}
        </div>
      )}
    </div>
  );
};
