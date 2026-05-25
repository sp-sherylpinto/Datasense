import { useState } from 'react';
import { Pin, Loader2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToasts } from './Toasts';

type ChartType = 'bar' | 'line' | 'area' | 'scatter';

interface Props {
  jobId: string;
  defaultTitle: string;
  defaultChartType?: ChartType;
  // Optional config (e.g. {x_key, y_key}) the dashboard card will read.
  configJson?: Record<string, any>;
}

export const PinButton = ({ jobId, defaultTitle, defaultChartType = 'bar', configJson }: Props) => {
  const { push } = useToasts();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [chartType, setChartType] = useState<ChartType>(defaultChartType);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/dashboard/pins', {
        job_id: jobId,
        title: title.trim(),
        chart_type: chartType,
        config_json: configJson || {},
      });
      push({ tone: 'success', title: 'Pinned to Dashboard', body: title.trim() });
      setOpen(false);
    } catch (err: any) {
      push({
        tone: 'error',
        title: 'Pin failed',
        body: err?.response?.data?.detail || 'See console',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-ghost text-[11px] py-1 px-3 flex items-center gap-1.5 hover:text-acc"
        title="Pin this result to the Dashboard"
      >
        <Pin size={12} /> Pin to Dashboard
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-surf border border-border rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pin size={14} className="text-acc" />
                <span className="text-[13px] font-semibold text-tx">Pin to Dashboard</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-tx3 hover:text-tx" disabled={submitting}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                autoFocus
                placeholder="e.g. Sales Register — Benford fit"
                className="w-full px-3 py-2 bg-sub border border-border rounded-lg text-[12px] text-tx placeholder-tx3 outline-none focus:border-acc"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-wider text-tx3">Chart Type</label>
              <div className="grid grid-cols-4 gap-2">
                {(['bar', 'line', 'area', 'scatter'] as ChartType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setChartType(t)}
                    className={`text-[11px] font-mono py-1.5 rounded-md border transition-all ${
                      chartType === t
                        ? 'bg-acc/10 border-acc text-acc'
                        : 'bg-sub border-border text-tx2 hover:border-tx3'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="btn btn-ghost text-[11px] py-1.5 px-3"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !title.trim()}
                className="btn btn-acc text-[11px] py-1.5 px-4 flex items-center gap-1.5 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={11} className="animate-spin" /> : <Pin size={11} />}
                {submitting ? 'Pinning…' : 'Pin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
