import { ReactNode, useId } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TabConfig {
  id: string;
  label: string;
  content: ReactNode;
  /** Optional icon shown left of label */
  icon?: LucideIcon;
  /** Optional badge (e.g. event count, "Live") shown as small pill */
  badge?: number | string;
}

export interface ResourceTabsProps {
  tabs: TabConfig[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function ResourceTabs({ tabs, activeTab, onTabChange, className }: ResourceTabsProps) {
  const instanceId = useId();

  return (
    <div className={cn('space-y-6 w-full', className)}>
      {/* Tab bar */}
      <div className="w-full rounded-xl bg-muted/40 dark:bg-slate-800/40 p-1 overflow-x-auto scrollbar-thin scrollbar-thumb-border/30 scrollbar-track-transparent" style={{ scrollbarWidth: 'thin' }}>
        <nav className="flex items-center gap-0.5" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'relative flex items-center gap-1.5 shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground/80'
                )}
              >
                {/* Animated background pill for active tab */}
                {isActive && (
                  <motion.div
                    layoutId={`tab-pill-${instanceId}`}
                    className="absolute inset-0 bg-white dark:bg-slate-700 rounded-lg shadow-sm"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    style={{ zIndex: 0 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : '')} aria-hidden />}
                  <span>{tab.label}</span>
                  {tab.badge != null && (
                    <span
                      className={cn(
                        'shrink-0 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center leading-none',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted-foreground/15 text-muted-foreground'
                      )}
                    >
                      {typeof tab.badge === 'number' && tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="min-h-[60vh]"
      >
        {tabs.find((tab) => tab.id === activeTab)?.content}
      </motion.div>
    </div>
  );
}
