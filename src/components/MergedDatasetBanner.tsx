import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, ChevronDown, ChevronUp, FileText, GitMerge, Info } from 'lucide-react';
import type { FileMetadata } from '../lib/types';

interface Props {
  file: FileMetadata;
}

export const MergedDatasetBanner = ({ file }: Props) => {
  const [expanded, setExpanded] = useState(false);

  const isMerged = (file as any).file_type === 'merged' || (file as any).source_type === 'merge';
  if (!isMerged) return null;

  const strategy   = (file as any).strategy ?? 'union_all';
  const sourceIds  = (file as any).source_ids as string[] | undefined;
  const sourceName = (file as any).source_datasets as string[] | undefined;

  const strategyLabel = strategy === 'union_all'
    ? 'Append (rows stacked — same column structure)'
    : 'Flexible Join (columns aligned by name, nulls filled)';

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-acc/5 border border-acc/20 rounded-xl overflow-hidden"
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-acc/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-acc/10 flex items-center justify-center flex-shrink-0">
            <GitMerge size={14} className="text-acc" />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-acc flex items-center gap-2">
              Merged Dataset
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-acc/10 text-acc border border-acc/20">
                {strategy === 'union_all' ? 'APPEND' : 'FLEX JOIN'}
              </span>
            </p>
            <p className="text-[10px] text-tx3 mt-0.5">
              {file.row_count_approx?.toLocaleString()} rows · {file.columns?.length} columns · Click to view details
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={14} className="text-tx3 flex-shrink-0" /> : <ChevronDown size={14} className="text-tx3 flex-shrink-0" />}
      </button>

      {/* Expanded details */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-acc/10">

              {/* Merge strategy */}
              <div className="flex items-start gap-2">
                <Info size={12} className="text-acc mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[11px] font-medium text-tx">Merge Strategy</p>
                  <p className="text-[10px] text-tx3 mt-0.5">{strategyLabel}</p>
                </div>
              </div>

              {/* Source datasets */}
              {sourceName && sourceName.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-tx3 mb-2">Source Files</p>
                  <div className="space-y-1.5">
                    {sourceName.map((name, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-sub/30 rounded-lg border border-border">
                        <FileText size={11} className="text-tx3 flex-shrink-0" />
                        <span className="text-[11px] font-mono text-tx truncate">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Null warning for diagonal merge */}
              {strategy === 'diagonal' && (
                <div className="flex items-start gap-2 bg-warn/5 border border-warn/20 rounded-lg px-3 py-2">
                  <Layers size={11} className="text-warn mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-warn leading-relaxed">
                    Flexible Join fills missing columns with nulls where files differed in structure.
                    High null rates on some columns in the Quality Profile are expected.
                  </p>
                </div>
              )}

              {/* Column count */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-sub/40 rounded-lg px-3 py-2 text-center">
                  <p className="text-[15px] font-semibold text-tx">{file.row_count_approx?.toLocaleString()}</p>
                  <p className="text-[9px] text-tx3 uppercase tracking-wider mt-0.5">Total Rows</p>
                </div>
                <div className="bg-sub/40 rounded-lg px-3 py-2 text-center">
                  <p className="text-[15px] font-semibold text-tx">{file.columns?.length}</p>
                  <p className="text-[9px] text-tx3 uppercase tracking-wider mt-0.5">Columns</p>
                </div>
                <div className="bg-sub/40 rounded-lg px-3 py-2 text-center">
                  <p className="text-[15px] font-semibold text-tx">{sourceName?.length ?? '—'}</p>
                  <p className="text-[9px] text-tx3 uppercase tracking-wider mt-0.5">Sources</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
