import { useState, useEffect } from 'react';

const TICK_MS = 10_000; // update every 10s per TASK-078

function formatRelativeTime(updatedAt: number): string {
  const now = Date.now();
  const deltaMs = Math.max(0, now - updatedAt);
  const deltaSec = Math.floor(deltaMs / 1000);
  const deltaMin = Math.floor(deltaSec / 60);
  const deltaHour = Math.floor(deltaMin / 60);
  const deltaDay = Math.floor(deltaHour / 24);

  if (deltaSec < 60) return 'just now';
  if (deltaMin < 60) return `${deltaMin}m ago`;
  if (deltaHour < 24) return `${deltaHour}h ago`;
  if (deltaDay < 7) return `${deltaDay}d ago`;
  return `${Math.floor(deltaDay / 7)}wk ago`;
}

/**
 * Returns a human-readable "X ago" string for a timestamp, updating every 10s.
 * Used for "Updated X ago" list footer indicator (TASK-078).
 */
export function useRelativeTimeAgo(updatedAt: number | undefined): string {
  const [label, setLabel] = useState<string>(() =>
    updatedAt != null ? formatRelativeTime(updatedAt) : '—'
  );

  useEffect(() => {
    if (updatedAt == null) {
      setLabel('—');
      return;
    }
    setLabel(formatRelativeTime(updatedAt));
    const id = setInterval(() => setLabel(formatRelativeTime(updatedAt)), TICK_MS);
    return () => clearInterval(id);
  }, [updatedAt]);

  return label;
}
