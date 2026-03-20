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
      {/* Full-width tab bar: fills screen, clear selected state, dark unselected text */}
      <div className="w-full rounded-xl border border-border/50 bg-gradient-to-r from-muted/40 via-muted/20 to-muted/30 shadow-sm overflow-hidden">
        <nav
          className="flex w-full items-center gap-0.5 p-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
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
                  'relative flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isActive
                    ? 'bg-primary/10 text-primary shadow-sm border border-primary/25 font-semibold'
                    : 'text-foreground/70 hover:text-foreground hover:bg-muted/60 border border-transparent'
                )}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
                <span>{tab.label}</span>
                {tab.badge != null && (
                  <span
                    className={cn(
                      'shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold flex items-center justify-center',
                      isActive
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-foreground/70'
                    )}
                  >
                    {typeof tab.badge === 'number' && tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content - min height so tall content uses available space */}
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
