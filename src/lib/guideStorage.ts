// Tracks "this tab has produced its first successful result"
// so the GuidePanel can collapse by default after the user is up to speed.

const SEEN_KEY = 'guide_seen_tabs_v1';

const read = (): Set<string> => {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
};

const write = (set: Set<string>) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set))); } catch {}
};

export const hasSeenGuideFor = (tab: string): boolean => read().has(tab);

export const markGuideSeen = (tab: string) => {
  const s = read();
  if (s.has(tab)) return;
  s.add(tab);
  write(s);
};
