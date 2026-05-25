import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ZAxis, Legend, ResponsiveContainer,
} from 'recharts';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';

const PALETTE = [
  '#9a3324', '#2563eb', '#16a34a', '#d97706',
  '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#475569',
];

// Mirrors TimeSeriesResult's downloadChart — targets the chart wrapper div
const downloadChart = (containerRef: React.RefObject<HTMLDivElement>, filename: string) => {
  const svg = containerRef.current?.querySelector('svg') as SVGElement | null;
  if (!svg) { alert('Chart not ready — run the analysis first.'); return; }

  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width  = (svg.clientWidth  || 600) * scale;
    canvas.height = (svg.clientHeight || 420) * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.download = filename;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
};

interface Props {
  jobId: string;
  xLabel: string;
  yLabel: string;
}

export const ClusterResult = ({ jobId, xLabel, yLabel }: Props) => {
  const [data, setData]       = useState<{ x: number; y: number; cluster_id: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const chartRef              = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/query', {
          job_id: jobId,
          sql: 'SELECT x, y, cluster_id FROM RESULT_TABLE LIMIT 5000',
        });
        if (cancelled) return;
        const rows = (res.data.data || [])
          .map((r: any) => ({
            x:          Number(r.x),
            y:          Number(r.y),
            cluster_id: Number(r.cluster_id),
          }))
          .filter((r: any) => Number.isFinite(r.x) && Number.isFinite(r.y));
        setData(rows);
      } catch (err) {
        console.error('Cluster query failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  const groups = useMemo(() => {
    const buckets = new Map<number, { x: number; y: number }[]>();
    data.forEach(d => {
      const arr = buckets.get(d.cluster_id) || [];
      arr.push({ x: d.x, y: d.y });
      buckets.set(d.cluster_id, arr);
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([id, points]) => ({ id, points, color: PALETTE[id % PALETTE.length] }));
  }, [data]);

  if (loading) {
    return (
      <div className="h-[420px] flex items-center justify-center font-mono text-[11px] text-tx3 animate-pulse">
        Loading cluster assignments…
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="h-[420px] flex items-center justify-center text-tx3 italic text-[12px]">
        No cluster points returned.
      </div>
    );
  }

  const filename = `clusters-${xLabel}-${yLabel}-${new Date().toISOString().slice(0, 10)}.png`;

  return (
    <div className="space-y-3">
      {/* Header — mirrors TimeSeriesResult */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-tx3">Cluster Analysis</p>
          <p className="text-[13px] font-semibold text-tx mt-0.5">{xLabel} × {yLabel}</p>
        </div>
        <button
          onClick={() => downloadChart(chartRef, filename)}
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-border text-tx2 hover:border-acc hover:text-acc transition-all"
        >
          <Download size={13} /> Download PNG
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-sub/30 p-3 rounded-lg border border-border">
          <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Points Plotted</div>
          <div className="text-[16px] font-bold text-tx">{data.length.toLocaleString()}</div>
        </div>
        <div className="bg-sub/30 p-3 rounded-lg border border-border">
          <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Clusters</div>
          <div className="text-[16px] font-bold text-tx">{groups.length}</div>
        </div>
        <div className="bg-sub/30 p-3 rounded-lg border border-border">
          <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Smallest</div>
          <div className="text-[16px] font-bold text-warn">
            {Math.min(...groups.map(g => g.points.length)).toLocaleString()}
          </div>
        </div>
        <div className="bg-sub/30 p-3 rounded-lg border border-border">
          <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Largest</div>
          <div className="text-[16px] font-bold text-info">
            {Math.max(...groups.map(g => g.points.length)).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Chart — ResponsiveContainer only, no manual width tracking */}
      <div ref={chartRef} className="w-full h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 8 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e3dcd3"   // hardcoded — CSS vars crash recharts SVG in v2.12
              vertical={false}
            />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: '#8a7d70', fontSize: 11 }}
              tick={{ fill: '#8a7d70', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#8a7d70', fontSize: 11 }}
              tick={{ fill: '#8a7d70', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <ZAxis range={[24, 24]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{
                backgroundColor: '#ffffff',
                borderColor: '#e3dcd3',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
            {groups.map(g => (
              <Scatter
                key={g.id}
                name={`Cluster ${g.id} (${g.points.length})`}
                data={g.points}
                fill={g.color}
                fillOpacity={0.65}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Cluster chips */}
      <div className="flex flex-wrap gap-2">
        {groups.map(g => (
          <div
            key={g.id}
            className="flex items-center gap-1.5 text-[11px] font-mono text-tx2 px-2 py-1 rounded-md bg-sub/30 border border-border"
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
            <span>Cluster {g.id}</span>
            <span className="text-tx3">·</span>
            <span>{g.points.length.toLocaleString()} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
};
