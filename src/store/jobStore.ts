import { create } from 'zustand';
import type { JobStatus } from '../lib/types';

interface JobState {
  jobs: Record<string, JobStatus>;
  setJobs: (jobs: Record<string, JobStatus> | ((prev: Record<string, JobStatus>) => Record<string, JobStatus>)) => void;
  cleaning: boolean;
  setCleaning: (v: boolean) => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  sseConnections: Record<string, EventSource>;
  registerSSE: (jobId: string, es: EventSource) => void;
  closeSSE: (jobId: string) => void;
  closeAllSSE: () => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: {},
  setJobs: (jobs) =>
    set((s) => ({
      jobs: typeof jobs === 'function' ? jobs(s.jobs) : jobs,
    })),
  cleaning: false,
  setCleaning: (v) => set({ cleaning: v }),
  uploading: false,
  setUploading: (v) => set({ uploading: v }),
  sseConnections: {},
  registerSSE: (jobId, es) =>
    set((s) => {
      // Close any existing connection for this job
      const existing = s.sseConnections[jobId];
      if (existing) existing.close();
      return { sseConnections: { ...s.sseConnections, [jobId]: es } };
    }),
  closeSSE: (jobId) =>
    set((s) => {
      const es = s.sseConnections[jobId];
      if (es) es.close();
      const next = { ...s.sseConnections };
      delete next[jobId];
      return { sseConnections: next };
    }),
  closeAllSSE: () =>
    set((s) => {
      Object.values(s.sseConnections).forEach((es) => es.close());
      return { sseConnections: {} };
    }),
}));
