/**
 * RiskPanel — Right panel showing risk indicators with severity-colored borders.
 *
 * Each risk has a colored left border, title, and detail text.
 */
import { motion } from 'framer-motion';
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RiskIndicator } from '@/services/api/types';

export interface RiskPanelProps {
  risks: RiskIndicator[];
}

const SEVERITY_STYLES: Record<string, { border: string; icon: string; IconComponent: typeof AlertOctagon }> = {
  critical: {
    border: 'border-l-red-500',
    icon: 'text-red-500',
    IconComponent: AlertOctagon,
  },
  warning: {
    border: 'border-l-orange-500',
    icon: 'text-orange-500',
    IconComponent: AlertTriangle,
  },
  info: {
    border: 'border-l-blue-500',
    icon: 'text-blue-500',
    IconComponent: Info,
  },
};

export function RiskPanel({ risks }: RiskPanelProps) {
  if (risks.length === 0) {
    return (
      <div className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center">
        No risk indicators detected.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Risk Indicators
      </h3>
      <div className="space-y-2">
        {risks.map((risk, index) => {
          const style = SEVERITY_STYLES[risk.severity] ?? SEVERITY_STYLES.info;
          const Icon = style.IconComponent;

          return (
            <motion.div
              key={`${risk.severity}-${risk.title}-${index}`}
              className={cn(
                'rounded-lg border border-slate-200 dark:border-slate-700 border-l-4 p-3',
                'bg-white dark:bg-slate-800',
                style.border,
              )}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, duration: 0.25 }}
            >
              <div className="flex items-start gap-2.5">
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', style.icon)} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {risk.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {risk.detail}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
