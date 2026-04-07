/**
 * useInsightNotifications
 *
 * Polls active insights via useActiveInsights() and creates in-app
 * notifications for any newly detected insights so they appear in the
 * Notification Center without waiting for a page refresh.
 *
 * Seen insight IDs are persisted in localStorage so notifications
 * don't re-fire on page refresh or HMR. Only truly NEW insights
 * (created after the last check) trigger notifications.
 *
 * Should be mounted once in a top-level component (e.g. AppLayout).
 */
import { useEffect, useRef } from 'react';
import { useActiveInsights } from '@/hooks/useEventsIntelligence';
import { useNotificationStore, type NotificationSeverity } from '@/stores/notificationStore';

const STORAGE_KEY = 'kubilitics:seen-insight-ids';
const MAX_SEEN = 500; // Prevent unbounded growth

function loadSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSeenIds(ids: Set<string>) {
  try {
    // Keep only the most recent MAX_SEEN IDs
    const arr = [...ids];
    const trimmed = arr.length > MAX_SEEN ? arr.slice(arr.length - MAX_SEEN) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

function mapSeverity(severity: string): NotificationSeverity {
  switch (severity) {
    case 'critical':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

export function useInsightNotifications() {
  const { data: insights } = useActiveInsights();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const seenIds = useRef<Set<string>>(loadSeenIds());

  useEffect(() => {
    if (!insights || insights.length === 0) return;

    let added = false;
    for (const insight of insights) {
      if (seenIds.current.has(insight.insight_id)) continue;

      seenIds.current.add(insight.insight_id);
      added = true;

      addNotification({
        id: `insight-${insight.insight_id}`,
        title: insight.title,
        description: insight.detail,
        severity: mapSeverity(insight.severity),
        category: 'cluster',
      });
    }

    if (added) {
      persistSeenIds(seenIds.current);
    }
  }, [insights, addNotification]);
}
