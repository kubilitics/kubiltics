/**
 * NotificationCenter — Bell icon button with dropdown notification panel.
 *
 * Features:
 * - Bell icon with animated unread count badge
 * - Dropdown panel with recent notifications (newest first)
 * - Category filter tabs: All, Cluster, AI, Add-ons
 * - Mark as read, dismiss individual, clear all actions
 * - Framer Motion enter/exit animations
 * - WebSocket integration pattern via `useNotificationWebSocket` hook
 * - Full dark mode support
 *
 * @module NotificationCenter
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  X,
  Check,
  CheckCheck,
  Trash2,
  Server,
  Brain,
  Package,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import {
  useNotificationStore,
  type Notification,
  type NotificationCategory,
  type NotificationSeverity,
} from '@/stores/notificationStore';
import { useBackendWebSocket, type BackendWebSocketMessage } from '@/hooks/useBackendWebSocket';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NotificationCenterProps {
  /** Custom class name applied to the trigger button. */
  className?: string;
  /** Cluster ID for WebSocket subscription. */
  clusterId?: string | null;
}

/** Filter tab definition. */
interface FilterTab {
  readonly id: NotificationCategory | 'all';
  readonly label: string;
  readonly Icon: React.ElementType;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FILTER_TABS: FilterTab[] = [
  { id: 'all', label: 'All', Icon: Bell },
  { id: 'cluster', label: 'Cluster', Icon: Server },
  { id: 'ai', label: 'AI', Icon: Brain },
  { id: 'addon', label: 'Add-ons', Icon: Package },
];

const SEVERITY_ICONS: Record<NotificationSeverity, React.ElementType> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

const SEVERITY_COLORS: Record<NotificationSeverity, string> = {
  error: 'text-red-500 dark:text-red-400',
  warning: 'text-amber-500 dark:text-amber-400',
  info: 'text-blue-500 dark:text-blue-400',
  success: 'text-emerald-500 dark:text-emerald-400',
};

const SEVERITY_BG: Record<NotificationSeverity, string> = {
  error: 'bg-red-50 dark:bg-red-950/20',
  warning: 'bg-amber-50 dark:bg-amber-950/20',
  info: 'bg-blue-50 dark:bg-blue-950/20',
  success: 'bg-emerald-50 dark:bg-emerald-950/20',
};

// ─── WebSocket Integration Hook ─────────────────────────────────────────────

/**
 * Subscribes to backend WebSocket events and converts them into
 * notifications in the store. This is the bridge between the real-time
 * event stream and the notification center UI.
 *
 * @param clusterId - Active cluster ID for the WebSocket connection
 * @param enabled - Whether to enable the subscription
 */
function useNotificationWebSocket(
  clusterId?: string | null,
  enabled = true,
) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const handleMessage = useCallback(
    (data: BackendWebSocketMessage) => {
      // Map WebSocket event types to notification categories
      const eventType = data.type ?? data.event ?? '';

      // Skip heartbeat/ping messages
      if (eventType === 'ping' || eventType === 'heartbeat') return;

      // Determine category from event type
      let category: NotificationCategory = 'cluster';
      if (eventType.startsWith('ai.') || eventType.includes('anomaly')) {
        category = 'ai';
      } else if (eventType.startsWith('addon.') || eventType.includes('install')) {
        category = 'addon';
      }

      // Determine severity from event type
      let severity: NotificationSeverity = 'info';
      if (eventType.includes('error') || eventType.includes('failed') || eventType.includes('crash')) {
        severity = 'error';
      } else if (eventType.includes('warning') || eventType.includes('unhealthy')) {
        severity = 'warning';
      } else if (eventType.includes('success') || eventType.includes('ready') || eventType.includes('completed')) {
        severity = 'success';
      }

      // Extract resource info
      const resource = data.resource as Record<string, unknown> | undefined;
      const metadata = resource?.metadata as Record<string, unknown> | undefined;

      addNotification({
        title: formatEventTitle(eventType, metadata),
        description: formatEventDescription(data),
        severity,
        category,
        resourceKind: resource?.kind as string | undefined,
        resourceName: metadata?.name as string | undefined,
        namespace: metadata?.namespace as string | undefined,
      });
    },
    [addNotification],
  );

  useBackendWebSocket({
    clusterId,
    enabled: enabled && isConfigured(),
    onMessage: handleMessage,
  });
}

/** Formats a WebSocket event type into a human-readable title. */
function formatEventTitle(
  eventType: string,
  metadata?: Record<string, unknown>,
): string {
  const name = metadata?.name as string | undefined;

  // Map known event types to readable titles
  const eventTitleMap: Record<string, string> = {
    'resource.created': name ? `${name} created` : 'Resource created',
    'resource.updated': name ? `${name} updated` : 'Resource updated',
    'resource.deleted': name ? `${name} deleted` : 'Resource deleted',
    'pod.crash': name ? `${name} CrashLoopBackOff` : 'Pod crash detected',
    'pod.oom': name ? `${name} OOMKilled` : 'Pod OOM killed',
    'node.not_ready': name ? `Node ${name} not ready` : 'Node not ready',
    'ai.anomaly': name ? `Anomaly on ${name}` : 'Anomaly detected',
    'ai.observation': 'AI observation',
    'addon.installed': name ? `${name} installed` : 'Add-on installed',
    'addon.failed': name ? `${name} install failed` : 'Add-on install failed',
    'addon.health_changed': name ? `${name} health changed` : 'Add-on health changed',
  };

  return eventTitleMap[eventType] ?? humanizeEventType(eventType);
}

/** Converts a dot-separated event type into a readable string. */
function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Cluster event';
}

/** Formats an event message as a description string. */
function formatEventDescription(data: BackendWebSocketMessage): string {
  const resource = data.resource as Record<string, unknown> | undefined;
  const metadata = resource?.metadata as Record<string, unknown> | undefined;
  const parts: string[] = [];

  if (resource?.kind) parts.push(resource.kind as string);
  if (metadata?.namespace) parts.push(`in ${metadata.namespace as string}`);
  if (data.timestamp) {
    try {
      parts.push(formatDistanceToNow(new Date(data.timestamp), { addSuffix: true }));
    } catch {
      // Ignore date parse errors
    }
  }

  return parts.join(' ') || '';
}

// ─── Notification Item ──────────────────────────────────────────────────────

/** Individual notification row in the dropdown panel. */
function NotificationItem({
  notification,
  onMarkRead,
  onDismiss,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const SeverityIcon = SEVERITY_ICONS[notification.severity];
  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true });
    } catch {
      return '';
    }
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
      className={cn(
        'group relative px-4 py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-b-0',
        'hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors duration-150',
        !notification.read && 'bg-primary/[0.02] dark:bg-primary/[0.03]',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Severity icon */}
        <div
          className={cn(
            'shrink-0 mt-0.5 h-7 w-7 rounded-lg flex items-center justify-center',
            SEVERITY_BG[notification.severity],
          )}
        >
          <SeverityIcon className={cn('h-3.5 w-3.5', SEVERITY_COLORS[notification.severity])} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                'text-[13px] font-semibold leading-snug truncate',
                notification.read
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-900 dark:text-slate-100',
              )}
            >
              {!notification.read && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 -translate-y-px" />
              )}
              {notification.title}
            </p>
          </div>

          {notification.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
              {notification.description}
            </p>
          )}

          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground/70 font-medium">
              {timeAgo}
            </span>
            {notification.resourceKind && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-muted-foreground font-semibold uppercase tracking-wider">
                {notification.resourceKind}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons (visible on hover) */}
        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {!notification.read && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(notification.id);
              }}
              className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              aria-label="Mark as read"
              title="Mark as read"
            >
              <Check className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(notification.id);
            }}
            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

/**
 * NotificationCenter — Bell icon button with dropdown panel.
 *
 * Place this in the app header. It manages its own open/close state
 * and subscribes to WebSocket events for real-time notifications.
 *
 * @example
 * ```tsx
 * <Header>
 *   <NotificationCenter clusterId={activeCluster?.id} />
 * </Header>
 * ```
 */
export function NotificationCenter({ className, clusterId }: NotificationCenterProps) {
  const [activeFilter, setActiveFilter] = useState<NotificationCategory | 'all'>('all');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const {
    notifications,
    isPanelOpen,
    unreadCount,
    markAsRead,
    markAllAsRead,
    dismiss,
    clearAll,
    togglePanel,
    setPanelOpen,
  } = useNotificationStore();

  // Subscribe to WebSocket events
  useNotificationWebSocket(clusterId, true);

  // Filtered notifications
  const filteredNotifications =
    activeFilter === 'all'
      ? notifications
      : notifications.filter((n) => n.category === activeFilter);

  const currentUnreadCount = unreadCount();

  // Close panel on click outside
  useEffect(() => {
    if (!isPanelOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setPanelOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPanelOpen, setPanelOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isPanelOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPanelOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isPanelOpen, setPanelOpen]);

  return (
    <div className="relative">
      {/* Bell trigger button */}
      <button
        ref={triggerRef}
        onClick={togglePanel}
        className={cn(
          'h-11 min-w-[2.75rem] rounded-xl',
          'inline-flex items-center justify-center gap-2.5',
          'text-slate-500 dark:text-slate-400',
          'hover:bg-slate-100/60 hover:text-slate-900 hover:translate-y-[-0.5px]',
          'dark:hover:bg-slate-700/60 dark:hover:text-slate-100',
          'transition-all duration-300 ease-spring',
          'active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
          'px-4',
          className,
        )}
        aria-label={
          currentUnreadCount > 0
            ? `${currentUnreadCount} unread notification${currentUnreadCount > 1 ? 's' : ''}`
            : 'Notifications'
        }
        aria-expanded={isPanelOpen}
        aria-haspopup="true"
      >
        <div className="relative shrink-0 flex items-center justify-center h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 transition-colors">
          <Bell className="h-4 w-4" />
          {currentUnreadCount > 0 ? (
            <motion.span
              key={currentUnreadCount}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 border-2 border-white dark:border-slate-900 shadow-sm flex items-center justify-center text-[9px] font-black text-white px-0.5"
            >
              {currentUnreadCount > 99 ? '99+' : currentUnreadCount}
            </motion.span>
          ) : (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white dark:border-slate-900 shadow-sm" />
          )}
        </div>
        <span className="hidden 2xl:inline text-sm font-bold tracking-tight">
          {currentUnreadCount > 0 ? `${currentUnreadCount} New` : 'Updates'}
        </span>
      </button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {isPanelOpen && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'absolute right-0 top-full mt-2 z-[60]',
              'w-[380px] max-h-[520px]',
              'bg-white dark:bg-slate-900 backdrop-blur-2xl',
              'rounded-2xl border border-slate-200/60 dark:border-slate-700/60',
              'shadow-2xl dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)]',
              'flex flex-col overflow-hidden',
            )}
            role="dialog"
            aria-label="Notification center"
          >
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800/60">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                  Notifications
                </h3>
                <div className="flex items-center gap-1">
                  {currentUnreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="h-7 px-2 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
                      title="Mark all as read"
                    >
                      <CheckCheck className="h-3 w-3" />
                      <span>Read all</span>
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={clearAll}
                      className="h-7 px-2 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
                      title="Clear all notifications"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Filter tabs */}
              <div className="flex items-center gap-1" role="tablist" aria-label="Filter notifications">
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeFilter === tab.id}
                    onClick={() => setActiveFilter(tab.id)}
                    className={cn(
                      'h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all duration-150 flex items-center gap-1.5',
                      activeFilter === tab.id
                        ? 'bg-primary/10 text-primary dark:bg-primary/20'
                        : 'text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <tab.Icon className="h-3 w-3" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notification list */}
            <div className="flex-1 overflow-y-auto overscroll-contain" role="list">
              <AnimatePresence mode="popLayout">
                {filteredNotifications.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-12 px-4"
                  >
                    <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <Bell className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-semibold text-muted-foreground">No notifications</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {activeFilter === 'all'
                        ? 'Events will appear here in real-time'
                        : `No ${activeFilter} notifications yet`}
                    </p>
                  </motion.div>
                ) : (
                  filteredNotifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkRead={markAsRead}
                      onDismiss={dismiss}
                    />
                  ))
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-800/20">
                <p className="text-[10px] font-medium text-muted-foreground/60 text-center">
                  {notifications.length} notification{notifications.length !== 1 ? 's' : ''} total
                  {currentUnreadCount > 0 && ` · ${currentUnreadCount} unread`}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default NotificationCenter;
