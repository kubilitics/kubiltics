import { ReactNode } from 'react';
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
  return (
    <div className={cn('space-y-6 w-full', className)}>
      {/* Tab bar — clean segmented control inspired by Apple design */}
      <div className="w-full">
        <nav
          className="flex items-center gap-1 overflow-x-auto pb-px scrollbar-thin scrollbar-thumb-border/40 scrollbar-track-transparent"
          aria-label="Tabs"
          style={{ scrollbarWidth: 'thin' }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'relative flex items-center gap-1.5 shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1',
                  isActive
                    ? 'bg-white dark:bg-slate-800 text-foreground shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]'
                    : 'text-muted-foreground hover:text-foreground/80 hover:bg-muted/50'
                )}
              >
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
                {/* Active indicator line */}
                {isActive && (
                  <motion.div
                    layoutId="active-tab-indicator"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </button>
            );
          })}
        </nav>
        {/* Subtle separator */}
        <div className="h-px bg-border/40 -mt-px" />
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
