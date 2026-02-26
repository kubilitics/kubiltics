/**
 * useAINotifications — E-PLAT-005
 * Background-polls /api/v1/analytics/anomalies every 5 minutes.
 * When critical anomalies are detected, surfaces them via sonner toasts
 * with "Investigate" deep-link navigation to the affected resource.
 *
 * Deduplication: once an anomaly (keyed by resource_id + anomaly_type) has
 * been toasted, it is stored in sessionStorage and won't re-fire until page reload.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getAnomalies } from '@/services/aiService';

const POLL_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const SEEN_KEY = 'kubilitics-ai-notif-seen';
const MAX_TOASTS_PER_POLL = 3; // Don't spam — cap at 3 toasts per check

interface AnomalyResult {
  resource_id?: string;
  resource_name?: string;
  namespace?: string;
  kind?: string;
  anomaly_type?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  score?: number;
  description?: string;
}

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    // ignore
  }
}

function anomalyKey(a: AnomalyResult): string {
  return `${a.resource_id ?? a.resource_name}::${a.anomaly_type}`;
}

function resourcePath(a: AnomalyResult): string | null {
  if (!a.kind) return null;
  const kind = a.kind.toLowerCase();
  const ns = a.namespace;
  const name = a.resource_name ?? a.resource_id;
  if (!name) return null;
  const kindRoutes: Record<string, string> = {
    pod: 'pods',
    deployment: 'deployments',
    statefulset: 'statefulsets',
    daemonset: 'daemonsets',
    node: 'nodes',
    service: 'services',
    namespace: 'namespaces',
    job: 'jobs',
    cronjob: 'cronjobs',
  };
  const route = kindRoutes[kind];
  if (!route) return null;
  // Namespace-scoped resources need the namespace in the path
  const namespaceScoped = !['node', 'namespace'].includes(kind);
  if (namespaceScoped && ns) return `/${route}/${ns}/${name}`;
  return `/${route}/${name}`;
}

export function useAINotifications() {
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  const poll = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const data = await getAnomalies();
      // Service now returns { anomalies: [...] }
      const anomalies: AnomalyResult[] = (data?.anomalies || []).map(a => ({
        ...a,
        // Map lowercase API severity to uppercase Sonner expectation
        severity: (a.severity?.toUpperCase() as any) || 'LOW'
      }));

      const criticalOrHigh = anomalies.filter(
        (a) => a.severity === 'CRITICAL' || a.severity === 'HIGH'
      );

      if (criticalOrHigh.length === 0) return;

      const seen = loadSeen();
      let toasted = 0;

      for (const anomaly of criticalOrHigh) {
        if (toasted >= MAX_TOASTS_PER_POLL) break;
        const key = anomalyKey(anomaly);
        if (seen.has(key)) continue;

        seen.add(key);
        toasted++;

        const path = resourcePath(anomaly);
        const isCritical = anomaly.severity === 'CRITICAL';

        toast(
          `${isCritical ? '🔴 Critical' : '🟠 High'} Anomaly: ${anomaly.resource_name ?? anomaly.resource_id ?? 'Unknown resource'}`,
          {
            description: anomaly.description ?? `${anomaly.anomaly_type} detected`,
            duration: 10_000,
            action: path
              ? {
                label: 'View',
                onClick: () => navigate(path),
              }
              : undefined,
          }
        );
      }

      saveSeen(seen);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // Silently ignore poll errors — AI service may not be running
    }
  };

  useEffect(() => {
    // Initial poll after short delay (don't fire immediately on mount)
    const initial = setTimeout(poll, 15_000);
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
