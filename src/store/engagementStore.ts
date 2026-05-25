import { create } from 'zustand';
import type { CoreEngagement } from '../lib/core';

interface EngagementState {
  engagementId: string | null;
  engagement: CoreEngagement | null;
  setEngagementId: (id: string | null) => void;
  setEngagement: (e: CoreEngagement | null) => void;
}

export const useEngagementStore = create<EngagementState>((set) => ({
  engagementId: null,
  engagement: null,
  setEngagementId: (id) => set({ engagementId: id }),
  setEngagement: (e) => set({ engagement: e }),
}));
