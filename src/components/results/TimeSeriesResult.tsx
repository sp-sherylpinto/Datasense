import { useEffect, useState } from 'react';
import { Download, Clock } from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../../lib/api';

// SVG-based download — no html2canvas, no dynamic imports, no recharts conflicts
const downloadChart = (filename: string) => {
  const svg = document.querySelector('.recharts-wrapper svg') as SVGElement | null;
  if (!svg) { alert('Chart not ready — run the analysis first.'); return; }

  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width  = img.width  * scale;
    canvas.height = img.height * scale;
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
  dateCol: string;
  valCol: string;
}

export const TimeSeriesResult = ({ jobId, dateCol, valCol }: Props) => {
  const [data, setData]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<'area' | 'line'>('area');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/query', {
          job_id: jobId,
          sql: `SELECT * FROM RESULT_TABLE ORDER BY "${dateCol}"`,
        });
        if (!cancelled) {
          const rawData = Array.isArray(res.data.data) ? res.data.data : [];
          
          // Normalize data: ensure type field exists
          const normalized = rawData.map((d: any) => ({
            ...d,
            type: d.type || (d.forecast ? 'forecast' : 'historical'),
            // Ensure date column is accessible
            [dateCol]: d[dateCol] || d.date,
            // Ensure value column is accessible
            [valCol]: d[valCol] || d.value,
          }));
          
          setData(normalized);
        }
      } catch (err) {
        console.error('Failed to fetch time series data', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId, dateCol, valCol]);

  if (loading) return (
    <div className="h-[420px] flex items-center justify-center">
      <Clock className="animate-spin text-acc" size={32} />
    </div>
  );

  if (!data.length) return (
    <div className="h-[420px] flex items-center justify-center text-tx3 italic text-[12px]">
      No data available
    </div>
  );

  // Split data into historical and forecast
  const historical = data.filter(d => d.type === 'historical' || d.type !== 'forecast');
  const forecast   = data.filter(d => d.type === 'forecast');
  
  // Check if we have forecast data
  const hasForecast = forecast && forecast.length > 0;

  const filename = `timeseries-${valCol}-${new Date().toISOString().slice(0, 10)}.png`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-tx3">Temporal Analysis</p>
          <p className="text-[13px] font-semibold text-tx mt-0.5">{valCol} over time</p>
          {hasForecast && <p className="text-[10px] text-ok mt-1">✓ Forecast available</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-sub/50 rounded-lg p-1.5">
            <button
              onClick={() => setChartType('area')}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-all ${
                chartType === 'area' 
                  ? 'bg-acc text-white' 
                  : 'text-tx3 hover:text-tx'
              }`}
            >
              Area
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-all ${
                chartType === 'line' 
                  ? 'bg-acc text-white' 
                  : 'text-tx3 hover:text-tx'
              }`}
            >
              Line
            </button>
          </div>
          <button
            onClick={() => downloadChart(filename)}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-border text-tx2 hover:border-acc hover:text-acc transition-all"
          >
            <Download size={13} /> Download
          </button>
        </div>
      </div>

      {/* Chart Container */}
      <div className="w-full h-[420px] bg-surf border border-border rounded-xl p-4">
        {chartType === 'area' ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
              <defs>
                <linearGradient id="gradHistorical" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradForecast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey={dateCol}
                tick={{ fill: 'var(--color-tx3)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={val => {
                  if (!val) return '';
                  return typeof val === 'string' ? val.split('T')[0] : String(val).split('T')[0];
                }}
              />
              <YAxis
                tick={{ fill: 'var(--color-tx3)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-surf)',
                  borderColor: 'var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  padding: '8px 12px',
                }}
                formatter={(value: any) => {
                  if (typeof value === 'number') return value.toFixed(2);
                  return value;
                }}
              />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: '11px' }} />
              
              {/* Historical Data */}
              <Area
                type="monotone"
                dataKey={valCol}
                stroke="#2563eb"
                strokeWidth={2.5}
                fill="url(#gradHistorical)"
                name="Historical Data"
                data={historical}
                dot={false}
                activeDot={{ r: 5, fill: '#2563eb' }}
                isAnimationActive={true}
              />
              
              {/* Forecast Data - GREEN LINE */}
              {hasForecast && (
                <Area
                  type="monotone"
                  dataKey={valCol}
                  stroke="#10b981"
                  strokeWidth={3}
                  strokeDasharray="8 4"
                  fill="url(#gradForecast)"
                  name="Forecast (30 days)"
                  data={forecast}
                  dot={false}
                  activeDot={{ r: 5, fill: '#10b981' }}
                  isAnimationActive={true}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          /* Line Chart Mode */
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey={dateCol}
                tick={{ fill: 'var(--color-tx3)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={val => {
                  if (!val) return '';
                  return typeof val === 'string' ? val.split('T')[0] : String(val).split('T')[0];
                }}
              />
              <YAxis
                tick={{ fill: 'var(--color-tx3)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-surf)',
                  borderColor: 'var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  padding: '8px 12px',
                }}
                formatter={(value: any) => {
                  if (typeof value === 'number') return value.toFixed(2);
                  return value;
                }}
              />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: '11px' }} />
              
              {/* Historical Line */}
              <Line
                type="monotone"
                dataKey={valCol}
                stroke="#2563eb"
                strokeWidth={2.5}
                name="Historical Data"
                data={historical}
                dot={false}
                activeDot={{ r: 5, fill: '#2563eb' }}
                isAnimationActive={true}
              />
              
              {/* Forecast Line - GREEN & DASHED */}
              {hasForecast && (
                <Line
                  type="monotone"
                  dataKey={valCol}
                  stroke="#10b981"
                  strokeWidth={3}
                  strokeDasharray="8 4"
                  name="Forecast (30 days)"
                  data={forecast}
                  dot={false}
                  activeDot={{ r: 5, fill: '#10b981' }}
                  isAnimationActive={true}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Data Summary */}
      {hasForecast && (
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div className="bg-info/10 border border-info/20 rounded-lg p-3">
            <p className="text-info font-semibold mb-1">Historical Period</p>
            <p className="text-tx3">{historical.length} data points</p>
            {historical.length > 0 && (
              <>
                <p className="text-tx2 mt-2 text-[10px]">
                  From: {historical[0]?.[dateCol]}
                </p>
                <p className="text-tx2 text-[10px]">
                  To: {historical[historical.length - 1]?.[dateCol]}
                </p>
              </>
            )}
          </div>
          <div className="bg-ok/10 border border-ok/20 rounded-lg p-3">
            <p className="text-ok font-semibold mb-1">Forecast (Next 30 Days)</p>
            <p className="text-tx3">{forecast.length} predicted points</p>
            {forecast.length > 0 && (
              <>
                <p className="text-tx2 mt-2 text-[10px]">
                  From: {forecast[0]?.[dateCol]}
                </p>
                <p className="text-tx2 text-[10px]">
                  To: {forecast[forecast.length - 1]?.[dateCol]}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
