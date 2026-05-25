import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Trash2, Copy, Zap, Search, X, Loader2 } from 'lucide-react';

interface FilterTemplate {
  id: string;
  name: string;
  description?: string;
  filters: any[];
  filterCount: number;
  usageCount: number;
  lastUsed?: string;
}

interface FilterLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterTemplate[];
  onApply: (template: FilterTemplate) => void;
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (template: FilterTemplate) => Promise<void>;
  isLoading?: boolean;
}

export function FilterLibrary({
  isOpen,
  onClose,
  filters,
  onApply,
  onDelete,
  onDuplicate,
  isLoading = false,
}: FilterLibraryProps) {
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  if (!isOpen) return null;

  const filtered = filters.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-bg border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-acc" />
            <span className="font-semibold text-tx">Filter Library</span>
            {filters.length > 0 && (
              <span className="text-xs bg-acc/20 text-acc px-2 py-1 rounded">
                {filters.length}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-tx3 hover:text-tx">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        {filters.length > 0 && (
          <div className="px-6 py-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-tx3" />
              <input
                type="text"
                placeholder="Search filters..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-sub border border-border rounded text-sm text-tx outline-none focus:ring-2 focus:ring-acc/20"
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-acc" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <Zap size={24} className="mx-auto text-tx3 mb-2 opacity-50" />
              <p className="text-sm text-tx3">
                {filters.length === 0 
                  ? 'No filters saved yet. Create one to see it here.' 
                  : 'No filters match your search'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(filter => (
                <motion.div
                  key={filter.id}
                  layout
                  className="p-3 rounded-lg bg-sub hover:bg-sub/80 transition-colors group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-tx">{filter.name}</h4>
                      {filter.description && (
                        <p className="text-xs text-tx3 mt-0.5">{filter.description}</p>
                      )}
                      <div className="flex gap-2 mt-1 text-xs text-tx3">
                        <span>{filter.filterCount} filters</span>
                        {filter.usageCount > 0 && (
                          <>
                            <span>•</span>
                            <span>Used {filter.usageCount}x</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onApply(filter)}
                        className="p-1.5 rounded hover:bg-acc/20 text-tx3 hover:text-acc transition-colors"
                        title="Apply filter"
                      >
                        <Zap size={14} />
                      </button>
                      <button
                        onClick={() => onDuplicate(filter)}
                        className="p-1.5 rounded hover:bg-info/20 text-tx3 hover:text-info transition-colors"
                        title="Duplicate"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          setDeleting(filter.id);
                          try {
                            await onDelete(filter.id);
                          } finally {
                            setDeleting(null);
                          }
                        }}
                        disabled={deleting === filter.id}
                        className="p-1.5 rounded hover:bg-err/20 text-tx3 hover:text-err transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-sub hover:bg-sub/80 text-tx transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}