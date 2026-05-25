import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { hasSeenGuideFor } from '../lib/guideStorage';

interface GuideProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  whenToUse: string[];
  steps: string[];
  tip?: string;
  // Used for the "have you used this before?" check.
  // If supplied, the panel collapses by default once the user has produced
  // a successful result on this tab in the past.
  tabId?: string;
}

export const GuidePanel = ({ icon, title, description, whenToUse, steps, tip, tabId }: GuideProps) => {
  const storageKey = `guide_open_${(tabId || title).replace(/\s+/g, '_')}`;
  const [open, setOpen] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored !== 'false';
      return tabId ? !hasSeenGuideFor(tabId) : true;
    } catch {
      return true;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, String(next)); } catch {}
  };

  return (
    <div className="bg-surf border border-border rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-sub/30 transition-colors"
      >
        <div className="flex items-center gap-2.5 text-left">
          <span className="text-acc">{icon}</span>
          <span className="text-[13px] font-semibold text-tx">{title}</span>
          <span className="text-[10px] font-mono text-tx3 bg-sub px-2 py-0.5 rounded-full uppercase tracking-wide">Guide</span>
        </div>
        {open ? <ChevronUp size={14} className="text-tx3 flex-shrink-0" /> : <ChevronDown size={14} className="text-tx3 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border grid md:grid-cols-3 gap-6 pt-4">
          <div className="md:col-span-3">
            <p className="text-[12px] text-tx2 leading-relaxed">{description}</p>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-acc mb-2">When to use</div>
            <ul className="space-y-1.5">
              {whenToUse.map((item, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-tx2 leading-snug">
                  <span className="text-acc mt-0.5 flex-shrink-0">›</span>{item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-acc mb-2">How to run</div>
            <ol className="space-y-1.5">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-tx2 leading-snug">
                  <span className="font-mono text-acc flex-shrink-0">{i + 1}.</span>{step}
                </li>
              ))}
            </ol>
          </div>
          {tip && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-acc mb-2">What to look for</div>
              <p className="text-[11px] text-tx2 leading-snug">{tip}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
