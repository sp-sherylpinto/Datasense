import { ChevronLeft, Moon, Sun } from 'lucide-react';
import type { CurrentUser } from '../lib/types';

interface Props {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  currentUser: CurrentUser | null;
  // What dataset is loaded — shown next to the user name so it's visible
  // on every tab, not just the upload screen.
  activeDatasetName?: string | null;
}

export const Header = ({ theme, toggleTheme, currentUser, activeDatasetName }: Props) => (
  <header className="h-14 flex items-center justify-between px-6 bg-surf border-b border-border sticky top-0 z-50">
    <a
      href="https://showcase.varma.ai"
      className="flex items-center gap-1.5 font-mono text-xs text-tx3 hover:text-acc transition-colors"
    >
      <ChevronLeft size={14} />
      All Tools
    </a>

    <div
      className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center select-none"
    >
      <span
        className="text-tx leading-none"
        style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 600, fontSize: '1.5rem' }}
      >
        Varma <span style={{ color: '#9a3324' }}>&amp;</span> Varma
      </span>
      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-tx3 mt-0.5">
        DataSense Pro
      </span>
    </div>

    <div className="flex items-center gap-3">
      {activeDatasetName && (
        <span
          className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-mono text-tx3 max-w-[260px] truncate"
          title={activeDatasetName}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-acc" />
          {activeDatasetName}
        </span>
      )}
      {currentUser && (
        <span className="hidden md:block text-xs text-tx3">{currentUser.name}</span>
      )}
      <button
        onClick={toggleTheme}
        className="text-tx3 hover:text-acc transition-colors"
        title="Toggle theme"
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
    </div>
  </header>
);
