/**
 * AlertsBanner — Persistent alert banner at top of Dashboard
 *
 * TASK-OBS-009: Dashboard Alert Positioning
 * Critical alerts demand attention with a persistent top banner.
 */

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, XCircle, ChevronDown, ChevronUp, X, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description?: string;
  resource?: string;
  namespace?: string;
  timestamp: Date;
  link?: string;
}

// ─── Alert Counter ───────────────────────────────────────────────────────────

function AlertCounts({
  critical,
  warnings,
  info,
}: {
  critical: number;
  warnings: number;
  info: number;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {critical > 0 && (
        <span className="flex items-center gap-1.5 font-semibold">
          <XCircle className="h-4 w-4" />
          {critical} critical
        </span>
      )}
      {warnings > 0 && (
        <span className="flex items-center gap-1.5 font-medium opacity-80">
          <AlertTriangle className="h-3.5 w-3.5" />
          {warnings} warning{warnings !== 1 ? 's' : ''}
        </span>
      )}
      {info > 0 && (
        <span className="font-medium opacity-60">
          {info} info
        </span>
      )}
    </div>
  );
}

// ─── Main Banner ─────────────────────────────────────────────────────────────

export interface AlertsBannerProps {
  alerts: DashboardAlert[];
  onDismiss?: (id: string) => void;
  onDismissAll?: () => void;
  onViewDetails?: () => void;
  className?: string;
}

/**
 * AlertsBanner — Persistent banner at top of Dashboard.
 *
 * @example
 * <AlertsBanner
 *   alerts={clusterAlerts}
 *   onViewDetails={() => navigate('/events?severity=critical')}
 * />
 */
export function AlertsBanner({
  alerts,
  onDismiss,
  onDismissAll,
  onViewDetails,
  className,
}: AlertsBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
  const warningAlerts = alerts.filter((a) => a.severity === 'warning');
  const infoAlerts = alerts.filter((a) => a.severity === 'info');

  const hasCritical = criticalAlerts.length > 0;
  const hasWarnings = warningAlerts.length > 0;

  // Don't render if no alerts or dismissed
  if (alerts.length === 0 || isDismissed) return null;

  const bannerStyle = hasCritical
    ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/40 text-red-800 dark:text-red-200'
    : hasWarnings
      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-200'
      : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/40 text-blue-800 dark:text-blue-200';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'rounded-xl border px-4 py-3',
        bannerStyle,
        className
      )}
      role="alert"
      aria-live="polite"
    >
      {/* Collapsed State */}
      <div className="flex items-center justify-between">
        <AlertCounts
          critical={criticalAlerts.length}
          warnings={warningAlerts.length}
          info={infoAlerts.length}
        />

        <div className="flex items-center gap-2">
          {onViewDetails && (
            <button
              onClick={onViewDetails}
              className="text-xs font-medium opacity-70 hover:opacity-100 transition-opacity flex items-center gap-1"
            >
              View Details <ExternalLink className="h-3 w-3" />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label={isExpanded ? 'Collapse alerts' : 'Expand alerts'}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {!hasCritical && (
            <button
              onClick={() => {
                setIsDismissed(true);
                onDismissAll?.();
              }}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              aria-label="Dismiss all alerts"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Alert List */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-current/10 space-y-2 max-h-48 overflow-y-auto">
              {alerts.slice(0, 20).map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {alert.severity === 'critical' ? (
                      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate">{alert.title}</p>
                      {alert.description && (
                        <p className="text-xs opacity-70 truncate">{alert.description}</p>
                      )}
                      <p className="text-[10px] opacity-50 mt-0.5">
                        {alert.resource && `${alert.resource} · `}
                        {alert.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  {onDismiss && alert.severity !== 'critical' && (
                    <button
                      onClick={() => onDismiss(alert.id)}
                      className="p-0.5 rounded opacity-50 hover:opacity-100 shrink-0"
                      aria-label={`Dismiss alert: ${alert.title}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
