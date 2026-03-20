/**
 * Notification Center Zustand Store
 *
 * Persisted store that manages in-app notifications for cluster events,
 * AI observations, and add-on status changes. Integrates with the
 * WebSocket live-update system via `subscribeToWebSocket()`.
 *
 * @module notificationStore
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Notification severity level. */
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';

/** Notification category for filtering. */
export type NotificationCategory = 'cluster' | 'ai' | 'addon' | 'system';

/** A single notification entry. */
export interface Notification {
  /** Unique identifier (UUID v4 or backend-provided). */
  readonly id: string;
  /** Display title (e.g. "Pod CrashLoopBackOff detected"). */
  readonly title: string;
  /** Optional longer description with context. */
  readonly description?: string;
  /** Severity drives icon and color treatment. */
  readonly severity: NotificationSeverity;
  /** Category for filter tabs. */
  readonly category: NotificationCategory;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** Whether the user has read/acknowledged this notification. */
  read: boolean;
  /** Optional resource link for "View" action. */
  readonly resourceLink?: string;
  /** Optional Kubernetes resource kind (e.g. "Pod", "Deployment"). */
  readonly resourceKind?: string;
  /** Optional resource name. */
  readonly resourceName?: string;
  /** Optional namespace. */
  readonly namespace?: string;
}

/** Shape of the notification store. */
interface NotificationState {
  /** All notifications, newest first. */
  notifications: Notification[];
  /** Maximum number of notifications to retain. */
  maxNotifications: number;
  /** Whether the notification dropdown panel is open. */
  isPanelOpen: boolean;

  // ─── Computed-like selectors (read) ──────────────────────────────────
  /** Count of unread notifications. */
  unreadCount: () => number;
  /** Notifications filtered by category. */
  byCategory: (category: NotificationCategory) => Notification[];

  // ─── Actions ─────────────────────────────────────────────────────────
  /** Add a new notification (prepended; trims to maxNotifications). */
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'> & { id?: string }) => void;
  /** Mark a single notification as read. */
  markAsRead: (id: string) => void;
  /** Mark all notifications as read. */
  markAllAsRead: () => void;
  /** Dismiss (remove) a single notification. */
  dismiss: (id: string) => void;
  /** Clear all notifications. */
  clearAll: () => void;
  /** Toggle the notification panel open/closed. */
  togglePanel: () => void;
  /** Set the panel open state directly. */
  setPanelOpen: (open: boolean) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a simple unique ID (no external dependency). */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      maxNotifications: 100,
      isPanelOpen: false,

      unreadCount: () => get().notifications.filter((n) => !n.read).length,

      byCategory: (category) =>
        get().notifications.filter((n) => n.category === category),

      addNotification: (partial) => {
        const notification: Notification = {
          id: partial.id ?? generateId(),
          title: partial.title,
          description: partial.description,
          severity: partial.severity,
          category: partial.category,
          timestamp: new Date().toISOString(),
          read: false,
          resourceLink: partial.resourceLink,
          resourceKind: partial.resourceKind,
          resourceName: partial.resourceName,
          namespace: partial.namespace,
        };

        set((state) => ({
          notifications: [notification, ...state.notifications].slice(
            0,
            state.maxNotifications,
          ),
        }));
      },

      markAsRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),

      markAllAsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),

      dismiss: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      clearAll: () => set({ notifications: [] }),

      togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

      setPanelOpen: (open) => set({ isPanelOpen: open }),
    }),
    {
      name: 'kubilitics-notifications',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({
        notifications: state.notifications.slice(0, 50), // Persist at most 50
      }),
    },
  ),
);
