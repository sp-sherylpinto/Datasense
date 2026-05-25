import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X } from 'lucide-react';

interface FilterTemplate {
  id: string;
  name: string;
  description?: string;
  filters: any[];
  filterCount: number;
  usageCount: number;
}

interface FilterSuggestionsProps {
  isOpen: boolean;
  onClose: () => void;
  suggested: FilterTemplate[];
  onApply: (template: FilterTemplate) => void;
}

export function FilterSuggestions({
  isOpen,
  onClose,
  suggested,
  onApply,
}: FilterSuggestionsProps) {
  if (!isOpen || suggested.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: -20, y: 20 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, x: -20, y: 20 }}
        className="fixed left-4 top-[300px] w-80 bg-bg border border-border rounded-lg shadow-xl z-40"
      >
        <div className="max-h-[50vh] overflow-y-auto">
          <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-bg z-10">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-acc" />
              <span className="text-sm font-semibold text-tx">Quick Apply</span>
            </div>
            <button
              onClick={onClose}
              className="text-tx3 hover:text-tx"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-3 space-y-2">
            {suggested.map(filter => (
              <motion.button
                key={filter.id}
                onClick={() => {
                  onApply(filter);
                  onClose();
                }}
                whileHover={{ x: 4 }}
                className="w-full text-left p-2.5 rounded-lg hover:bg-sub/60 transition-colors group"
              >
                <h4 className="text-sm font-medium text-tx group-hover:text-acc">
                  {filter.name}
                </h4>
                {filter.description && (
                  <p className="text-xs text-tx3 mt-0.5">{filter.description}</p>
                )}
                <div className="flex items-center gap-2 mt-1 text-xs text-tx3">
                  <span>{filter.filterCount} filters</span>
                  {filter.usageCount > 0 && (
                    <>
                      <span>•</span>
                      <span>Used {filter.usageCount}x</span>
                    </>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}