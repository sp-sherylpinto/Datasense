import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, RotateCw, X } from 'lucide-react';

type ToastTone = 'error' | 'success' | 'info';

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  // Optional retry action — when present a Retry button is rendered.
  retry?: () => void;
  // ms before auto-dismiss; 0 disables auto-dismiss.
  ttlMs?: number;
}

interface ToastContextValue {
  push: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToasts = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used inside <ToastProvider>');
  return ctx;
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const handle = timeoutsRef.current[id];
    if (handle) {
      clearTimeout(handle);
      delete timeoutsRef.current[id];
    }
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const ttl = t.ttlMs ?? (t.tone === 'error' ? 0 : 5000);
    setToasts(prev => [...prev, { ...t, id }]);
    if (ttl > 0) {
      timeoutsRef.current[id] = setTimeout(() => dismiss(id), ttl);
    }
    return id;
  }, [dismiss]);

  useEffect(() => {
    return () => {
      Object.values(timeoutsRef.current).forEach(clearTimeout);
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />)}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

const ToastCard = ({ toast, onClose }: { toast: Toast; onClose: () => void }) => {
  const tone = toast.tone;
  const Icon = tone === 'error' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  const accent =
    tone === 'error'   ? 'border-err/40 bg-err/5  text-err'
    : tone === 'success' ? 'border-ok/40  bg-ok/5   text-ok'
    : 'border-info/40 bg-info/5 text-info';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, transition: { duration: 0.15 } }}
      className={`pointer-events-auto rounded-xl border shadow-lg backdrop-blur-sm bg-surf overflow-hidden ${accent}`}
    >
      <div className="flex items-start gap-3 p-3">
        <Icon size={16} className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-tx truncate">{toast.title}</div>
          {toast.body && (
            <div className="text-[11px] text-tx2 mt-0.5 break-words whitespace-pre-wrap line-clamp-3">
              {toast.body}
            </div>
          )}
          {toast.retry && (
            <button
              onClick={() => { toast.retry?.(); onClose(); }}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-mono text-acc hover:underline"
            >
              <RotateCw size={11} /> Retry
            </button>
          )}
        </div>
        <button onClick={onClose} className="text-tx3 hover:text-tx flex-shrink-0">
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
};
