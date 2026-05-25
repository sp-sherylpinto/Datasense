import { create } from 'zustand';
import type { CurrentUser } from '../lib/types';

interface AppState {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  currentUser: CurrentUser | null;
  setCurrentUser: (u: CurrentUser | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'light',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      return { theme: next };
    }),
  currentUser: null,
  setCurrentUser: (u) => set({ currentUser: u }),
}));
