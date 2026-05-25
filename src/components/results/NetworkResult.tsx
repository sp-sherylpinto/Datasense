import { useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';

// Resolved from index.css light-theme values — canvas doesn't resolve CSS vars
const C_ACC    = '#9a3324';
const C_TX3    = '#8a7d70';
const C_TX     = '#1a1a1a';
const C_WHITE  = '#ffffff';

export const NetworkResult = ({
  jobId,
  sourceCol,
  targetCol,
}: {
  jobId: string;
  sourceCol: string;
  targetCol: string;
}) => {
  const [graphData, setGraphData]   = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [fullData, setFullData]     = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading]       = useState(true);
  const [minWeight, setMinWeight]   = useState(1);
  const [maxWeight, setMaxWeight]   = useState(1);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  const containerRef   = useRef<HTMLDivElement>(null);
  const graphRef       = useRef<any>(null);
  const wrapperRef     = useRef<HTMLDivElement>(null);

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        setDimensions({
          width:  entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load graph data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/query', {
          job_id: jobId,
          sql: 'SELECT * FROM RESULT_TABLE LIMIT 1000',
        });
        const data = res.data.data || [];
        const nodesSet = new Set<string>();
        const links: any[] = [];
        let currentMax = 1;

        data.forEach((row: any) => {
          const src    = row[sourceCol]?.toString();
          const tgt    = row[targetCol]?.toString();
          const weight = row['count'] || 1;
          if (weight > currentMax) currentMax = weight;
          if (src && tgt) {
            nodesSet.add(src);
            nodesSet.add(tgt);
            links.push({ source: src, target: tgt, value: weight });
          }
        });

        const nodes = Array.from(nodesSet).map(id => ({ id }));
        if (cancelled) return;
        setFullData({ nodes, links });
        setMaxWeight(currentMax);
        setGraphData({ nodes, links });
      } catch (err) {
        console.error('Network query failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId, sourceCol, targetCol]);

  // Apply min-weight filter
  useEffect(() => {
    if (!fullData.links.length) return;
    const filteredLinks = fullData.links.filter(l => l.value >= minWeight);
    const activeNodes   = new Set<string>();
    filteredLinks.forEach(l => {
      activeNodes.add(typeof l.source === 'string' ? l.source : l.source.id);
      activeNodes.add(typeof l.target === 'string' ? l.target : l.target.id);
    });
    setGraphData({
      nodes: fullData.nodes.filter(n => activeNodes.has(n.id)),
      links: filteredLinks,
    });
  }, [minWeight, fullData]);

  // Download the canvas as PNG
  const handleDownload = () => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `network-${jobId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center font-mono text-[11px] text-tx3 animate-pulse">
        Mapping Network Connections...
      </div>
    );
  }

  const density = graphData.nodes.length > 1
    ? (graphData.links.length / (graphData.nodes.length * (graphData.nodes.length - 1))).toFixed(4)
    : '0.0000';

  return (
    <div className="space-y-3">
      {/* Header — mirrors TimeSeriesResult / ClusterResult */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-tx3">Network Analysis</p>
          <p className="text-[13px] font-semibold text-tx mt-0.5">
            {sourceCol} → {targetCol}
          </p>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-border text-tx2 hover:border-acc hover:text-acc transition-all"
        >
          <Download size={13} /> Download PNG
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-sub/30 p-4 rounded-xl border border-border">
          <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Nodes</div>
          <div className="text-[18px] font-bold text-tx">{graphData.nodes.length}</div>
        </div>
        <div className="bg-sub/30 p-4 rounded-xl border border-border">
          <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Edges</div>
          <div className="text-[18px] font-bold text-tx">{graphData.links.length}</div>
        </div>
        <div className="bg-sub/30 p-4 rounded-xl border border-border">
          <div className="text-[10px] font-mono text-tx3 uppercase mb-1">Density</div>
          <div className="text-[18px] font-bold text-info">{density}</div>
        </div>
        <div className="bg-sub/30 p-4 rounded-xl border border-border flex flex-col justify-center">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono text-tx3 uppercase">Min Edge Weight</div>
            <div className="text-[12px] font-bold text-acc">{minWeight}</div>
          </div>
          <input
            type="range"
            min="1"
            max={maxWeight}
            step="1"
            value={minWeight}
            onChange={e => setMinWeight(parseInt(e.target.value))}
            className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-acc"
          />
        </div>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="h-[500px] w-full bg-sub/10 rounded-2xl border border-border overflow-hidden relative"
      >
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          nodeLabel="id"
          nodeColor={() => C_ACC}
          linkColor={() => C_TX3}
          linkDirectionalParticles={graphData.nodes.length < 500 ? 2 : 0}
          linkDirectionalParticleSpeed={(d: any) => d.value * 0.001}
          warmupTicks={100}
          cooldownTicks={100}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const radius = 4;
            // Node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle = C_ACC;
            ctx.fill();

            // Label — only when zoomed in or graph is small
            const shouldDrawLabel = globalScale > 1.5 || graphData.nodes.length < 50;
            if (shouldDrawLabel) {
              const label    = node.id;
              const fontSize = 12 / globalScale;
              ctx.font = `${fontSize}px Inter, sans-serif`;
              const textWidth = ctx.measureText(label).width;
              const pad       = fontSize * 0.2;
              const bW        = textWidth + pad;
              const bH        = fontSize + pad;
              // Label background
              ctx.fillStyle = 'rgba(255,255,255,0.85)';
              ctx.fillRect(
                node.x - bW / 2,
                node.y - bH / 2 - radius - 2,
                bW,
                bH,
              );
              // Label text
              ctx.textAlign    = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle    = C_TX;
              ctx.fillText(label, node.x, node.y - radius - 2 - bH / 2 + fontSize / 2);
            }
          }}
          nodePointerAreaPaint={(node: any, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
        />
      </div>

      <div className="text-[11px] text-tx3 text-center font-medium italic">
        Interactive force-directed graph. Scroll to zoom · drag to pan · use the slider to filter weak edges.
      </div>
    </div>
  );
};
