import React, { useState } from 'react';
import { Clock, CheckCircle2, XCircle, ChevronUp, ChevronDown, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { JobStatus } from '../lib/types';

export const JobStatusCard = ({ job }: { job: JobStatus }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col bg-sub rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          {job.status === 'running' && <Clock className="animate-spin text-info" size={16} />}
          {job.status === 'completed' && <CheckCircle2 className="text-ok" size={16} />}
          {job.status === 'failed' && <XCircle className="text-err" size={16} />}
          {job.status === 'pending' && <Clock className="text-tx3" size={16} />}
          <div>
            <div className="text-[12px] font-medium">{job.task_name}</div>
            <div className="text-[10px] font-mono text-tx3 uppercase">{job.id.slice(0, 8)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job.status === 'failed' && job.error_message && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-tx3 hover:text-tx transition-colors"
              title={expanded ? 'Hide Error' : 'View Error Detail'}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <div className={`pill ${
            job.status === 'completed' ? 'pill-lo' :
            job.status === 'failed' ? 'pill-hi' : 'pill-inf'
          }`}>
            {job.status.toUpperCase()}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && job.error_message && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border bg-black/5 dark:bg-black/20"
          >
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2 text-err text-[11px] font-semibold uppercase tracking-wider">
                <AlertCircle size={12} />
                Error Details
              </div>
              <pre className="text-[10px] font-mono p-2 bg-black/10 dark:bg-white/5 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto custom-scrollbar text-tx2">
                {job.error_message}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
