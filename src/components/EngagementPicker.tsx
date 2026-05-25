import { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, ChevronDown, Search, X } from 'lucide-react';
import { coreApi, type CoreEngagement } from '../lib/core';

const STORAGE_KEY = 'datasense_engagement_id';

export const useSelectedEngagement = () => {
  const [engagementId, setEngagementId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const [engagement, setEngagement] = useState<CoreEngagement | null>(null);

  useEffect(() => {
    try {
      if (engagementId) localStorage.setItem(STORAGE_KEY, engagementId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [engagementId]);

  useEffect(() => {
    if (!engagementId) { setEngagement(null); return; }
    coreApi.engagement(engagementId).then(setEngagement).catch(() => setEngagement(null));
  }, [engagementId]);

  return { engagementId, setEngagementId, engagement };
};


export const EngagementPicker = ({
  engagementId,
  onChange,
}: {
  engagementId: string | null;
  onChange: (id: string | null) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CoreEngagement[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || items.length) return;
    setLoading(true);
    coreApi.engagements()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, items.length]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selected = items.find(i => i.engagement_id === engagementId) || null;

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const ql = q.toLowerCase();
    return items.filter(e =>
      e.engagement_code.toLowerCase().includes(ql) ||
      e.engagement_name.toLowerCase().includes(ql) ||
      e.client_name.toLowerCase().includes(ql) ||
      (e.client_display_name || '').toLowerCase().includes(ql)
    );
  }, [items, q]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 bg-surf border border-border rounded-lg text-[12px] hover:border-acc/40 transition-colors"
      >
        <Briefcase size={13} className="text-acc" />
        {selected ? (
          <span className="text-tx font-mono">
            {selected.engagement_code}
            <span className="text-tx3 mx-1.5">·</span>
            <span className="text-tx2 font-sans">{selected.client_display_name || selected.client_name}</span>
          </span>
        ) : (
          <span className="text-tx3">Pick engagement…</span>
        )}
        <ChevronDown size={11} className={`text-tx3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-[420px] bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="p-2 border-b border-border bg-sub/30">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx3" />
              <input
                type="text"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by code / client / name…"
                autoFocus
                className="w-full pl-7 pr-2 py-1.5 bg-surf border border-border rounded-md text-[11px] outline-none focus:border-acc"
              />
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && <div className="px-3 py-3 text-[11px] text-tx3 animate-pulse">Loading…</div>}
            {!loading && filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[11px] text-tx3 italic">
                {items.length === 0 ? 'No engagements yet — create one in admin.varma.ai' : 'No matches'}
              </div>
            )}
            {filtered.map(e => (
              <button
                key={e.engagement_id}
                onClick={() => { onChange(e.engagement_id); setOpen(false); setQ(''); }}
                className={`w-full text-left px-3 py-2 hover:bg-sub/40 transition-colors ${
                  e.engagement_id === engagementId ? 'bg-acc/5' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-acc">{e.engagement_code}</span>
                  <span className="text-[9px] font-mono uppercase tracking-wider text-tx3">{e.status?.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-[12px] font-semibold text-tx truncate">{e.client_display_name || e.client_name}</div>
                <div className="text-[10px] font-mono text-tx3 truncate">
                  {e.engagement_type?.replace(/_/g, ' ')} · {e.period_start} → {e.period_end}
                </div>
              </button>
            ))}
          </div>
          {selected && (
            <div className="border-t border-border bg-sub/20 p-2">
              <button
                onClick={() => { onChange(null); setOpen(false); }}
                className="w-full text-[11px] text-tx3 hover:text-err flex items-center justify-center gap-1.5 py-1"
              >
                <X size={11} /> Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
