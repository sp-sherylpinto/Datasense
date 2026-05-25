import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import type { TabType } from '../lib/types';
import { GROUP_LABELS, tabsForGroup } from '../lib/nav';

interface Props {
  activeTab: TabType;
  onChange: (t: TabType) => void;
  fileLoaded: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
}

const GROUPS: Array<'prepare' | 'analyse'> = ['prepare', 'analyse'];

export const Sidebar: React.FC<Props> = ({
  activeTab,
  onChange,
  fileLoaded,
  isCollapsed,
  onToggle,
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleTabClick = (tabId: TabType) => {
    onChange(tabId);
    setIsMobileOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center px-4 justify-between flex-shrink-0">
        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <span className="font-semibold text-acc text-[14px] whitespace-nowrap">
                DataSense Pro 
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Desktop + Mobile Toggle */}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg text-tx3 hover:text-tx hover:bg-sub/60 transition-colors flex-shrink-0"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight size={16} />
          ) : (
            <ChevronLeft size={16} />
          )}
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4 px-2 space-y-5 custom-scrollbar">
        {GROUPS.map((group) => {
          const items = tabsForGroup(group);
          if (!items.length) return null;

          return (
            <div key={group}>
              {/* Group Label */}
              <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="px-3 mb-1.5"
                  >
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-tx3 select-none">
                      {GROUP_LABELS[group]}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-0.5">
                {items.map((tab) => {
                  const disabled =
                    tab.requiresFile && !fileLoaded;
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      onClick={() =>
                        !disabled && handleTabClick(tab.id)
                      }
                      disabled={disabled}
                      title={
                        isCollapsed
                          ? tab.label
                          : disabled
                          ? 'Load a dataset first'
                          : undefined
                      }
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium
                        transition-all duration-150 relative group
                        ${
                          isActive
                            ? 'bg-acc/10 text-acc'
                            : disabled
                            ? 'text-tx3/35 cursor-not-allowed'
                            : 'text-tx2 hover:bg-sub/70 hover:text-tx'
                        }
                        ${isCollapsed ? 'justify-center' : ''}
                      `}
                    >
                      {/* Active Indicator */}
                      {isActive && (
                        <motion.div
                          layoutId="activeSidebarItem"
                          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-acc rounded-full"
                        />
                      )}

                      <tab.icon
                        size={17}
                        className={`flex-shrink-0 ${
                          isActive
                            ? 'text-acc'
                            : disabled
                            ? 'text-tx3/35'
                            : 'text-tx3 group-hover:text-tx2'
                        }`}
                      />

                      <AnimatePresence initial={false}>
                        {!isCollapsed && (
                          <motion.span
                            initial={{
                              opacity: 0,
                              width: 0,
                            }}
                            animate={{
                              opacity: 1,
                              width: 'auto',
                            }}
                            exit={{
                              opacity: 0,
                              width: 0,
                            }}
                            transition={{
                              duration: 0.15,
                            }}
                            className="overflow-hidden whitespace-nowrap"
                          >
                            {tab.label}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-xl border border-border bg-surf shadow-soft"
      >
        <Menu size={18} />
      </button>

      {/* Desktop Sidebar */}
      <motion.aside
        animate={{
          width: isCollapsed ? 72 : 248,
        }}
        transition={{
          duration: 0.25,
          ease: 'easeInOut',
        }}
      className="hidden lg:flex h-full border-r border-border bg-surf flex-col overflow-hidden flex-shrink-0"
      >
        <SidebarContent />
      </motion.aside>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 bg-black/40 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileOpen(false)}
            />

            <motion.aside
              className="lg:hidden fixed left-0 top-0 bottom-0 w-72 bg-surf border-r border-border z-50"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ duration: 0.25 }}
            >
              <div className="h-14 border-b border-border flex items-center justify-between px-4">
                <span className="font-semibold text-acc">
                  DataSense
                </span>
                <button
                  onClick={() => setIsMobileOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-sub/60"
                >
                  <X size={18} />
                </button>
              </div>

              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};