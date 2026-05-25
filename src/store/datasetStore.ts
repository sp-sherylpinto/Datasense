import { create } from 'zustand';
import type { FileMetadata, SavedDataset, AuditArea } from '../lib/types';

interface DatasetState {
  file: FileMetadata | null;
  setFile: (f: FileMetadata | null | ((prev: FileMetadata | null) => FileMetadata | null)) => void;
  columnMappings: Record<string, string>;
  setColumnMappings: (m: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  columnRenames: Record<string, string>;
  setColumnRenames: (r: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  columnOrder: string[];
  setColumnOrder: (o: string[] | ((prev: string[]) => string[])) => void;
  savedDatasets: SavedDataset[];
  setSavedDatasets: (ds: SavedDataset[] | ((prev: SavedDataset[]) => SavedDataset[])) => void;
  datasetsLoading: boolean;
  setDatasetsLoading: (v: boolean) => void;
  loadingDataset: string | null;
  setLoadingDataset: (id: string | null) => void;
  auditAreas: AuditArea[];
  setAuditAreas: (a: AuditArea[]) => void;
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  shareDataset: SavedDataset | null;
  setShareDataset: (ds: SavedDataset | null) => void;
}

export const useDatasetStore = create<DatasetState>((set) => ({
  file: null,
  setFile: (f) =>
    set((s) => ({
      file: typeof f === 'function' ? f(s.file) : f,
    })),
  columnMappings: {},
  setColumnMappings: (m) =>
    set((s) => ({
      columnMappings: typeof m === 'function' ? m(s.columnMappings) : m,
    })),
  columnRenames: {},
  setColumnRenames: (r) =>
    set((s) => ({
      columnRenames: typeof r === 'function' ? r(s.columnRenames) : r,
    })),
  columnOrder: [],
  setColumnOrder: (o) =>
    set((s) => ({
      columnOrder: typeof o === 'function' ? o(s.columnOrder) : o,
    })),
  savedDatasets: [],
  setSavedDatasets: (ds) =>
    set((s) => ({
      savedDatasets: typeof ds === 'function' ? ds(s.savedDatasets) : ds,
    })),
  datasetsLoading: true,
  setDatasetsLoading: (v) => set({ datasetsLoading: v }),
  loadingDataset: null,
  setLoadingDataset: (id) => set({ loadingDataset: id }),
  auditAreas: [],
  setAuditAreas: (a) => set({ auditAreas: a }),
  confirmDelete: null,
  setConfirmDelete: (id) => set({ confirmDelete: id }),
  shareDataset: null,
  setShareDataset: (ds) => set({ shareDataset: ds }),
}));
