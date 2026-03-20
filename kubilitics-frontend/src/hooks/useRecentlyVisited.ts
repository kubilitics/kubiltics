/**
 * Tracks last 5 visited resource pages in localStorage for Quick Access on Dashboard.
 * Only resource list/detail pages are tracked (not /dashboard, /settings, etc.).
 */
import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const STORAGE_KEY = 'kubilitics-recently-visited';
const MAX_ITEMS = 5;

export interface RecentVisit {
  path: string;
  label: string;
  kind: string;
  timestamp: number;
}

const KIND_LABELS: Record<string, string> = {
  pods: 'Pods',
  deployments: 'Deployments',
  replicasets: 'ReplicaSets',
  statefulsets: 'StatefulSets',
  daemonsets: 'DaemonSets',
  jobs: 'Jobs',
  cronjobs: 'CronJobs',
  services: 'Services',
  configmaps: 'ConfigMaps',
  secrets: 'Secrets',
  nodes: 'Nodes',
  namespaces: 'Namespaces',
  events: 'Events',
  ingresses: 'Ingresses',
  persistentvolumeclaims: 'PVCs',
  persistentvolumes: 'PVs',
  storageclasses: 'StorageClasses',
  workloadsoverview: 'Workloads',
  topology: 'Topology',
  customresourcedefinitions: 'CRDs',
  customresources: 'Custom Resources',
};

function pathToLabel(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return 'Dashboard';
  const kind = segments[0];
  const label = KIND_LABELS[kind] ?? kind;
  if (segments.length >= 3) {
    return `${label}: ${segments[2]}`;
  }
  if (segments.length === 2) {
    return `${label}: ${segments[1]}`;
  }
  return label;
}

function pathToKind(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[0] ?? '';
}

function shouldTrack(path: string): boolean {
  if (!path || path === '/' || path === '/dashboard' || path === '/settings') return false;
  if (path.startsWith('/setup') || path.startsWith('/connected')) return false;
  if (path.startsWith('/analytics') || path.startsWith('/security') || path.startsWith('/ml-analytics') || path.startsWith('/cost')) return false;
  return true;
}

function loadFromStorage(): RecentVisit[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentVisit[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function saveToStorage(items: RecentVisit[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // ignore
  }
}

export function useRecentlyVisited(): RecentVisit[] {
  const [items, setItems] = useState<RecentVisit[]>(loadFromStorage);
  const location = useLocation();

  useEffect(() => {
    if (!shouldTrack(location.pathname)) return;
    const path = location.pathname;
    const label = pathToLabel(path);
    const kind = pathToKind(path);
    const entry: RecentVisit = { path, label, kind, timestamp: Date.now() };

    setItems((prev) => {
      const filtered = prev.filter((p) => p.path !== path);
      const next = [entry, ...filtered].slice(0, MAX_ITEMS);
      saveToStorage(next);
      return next;
    });
  }, [location.pathname]);

  return items;
}

export function useRecentlyVisitedReadOnly(): RecentVisit[] {
  const [items, setItems] = useState<RecentVisit[]>(loadFromStorage);

  const refresh = useCallback(() => {
    setItems(loadFromStorage());
  }, []);

  useEffect(() => {
    const handleStorage = () => setItems(loadFromStorage());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return items;
}
