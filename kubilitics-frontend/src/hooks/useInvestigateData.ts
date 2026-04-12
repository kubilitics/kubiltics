// src/hooks/useInvestigateData.ts

import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { listResources } from '@/services/backendApiClient';
import { getPodLogsUrl } from '@/services/backendApiClient';
import { parseInsightDetail, type PodReference } from '@/lib/parseInsightPods';
import { inferRootCause, extractErrorSnippet, type RootCauseResult } from '@/lib/rootCauseHeuristic';
import type { Insight } from '@/services/api/eventsIntelligence';

export interface PodInvestigateInfo {
  namespace: string;
  name: string;
  phase: string;
  reason: string;
  restartCount: number;
  lastRestartTime: string | null;
  logSnippet: string | null;
  errorSnippet: string | null;
  containerName: string | null;
}

export interface InvestigateData {
  rootCause: RootCauseResult;
  pods: PodInvestigateInfo[];
  startedAgo: string | null;
  lastRestartAgo: string | null;
  totalAffected: number;
}

function timeAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function extractPodInfo(pod: Record<string, unknown>): Omit<PodInvestigateInfo, 'logSnippet' | 'errorSnippet'> {
  const metadata = (pod.metadata ?? {}) as Record<string, unknown>;
  const status = (pod.status ?? {}) as Record<string, unknown>;
  const containerStatuses = (status.containerStatuses ?? []) as Array<Record<string, unknown>>;

  let totalRestarts = 0;
  let worstReason = '';
  let lastRestart: string | null = null;
  let containerName: string | null = null;

  for (const cs of containerStatuses) {
    const restarts = (cs.restartCount as number) ?? 0;
    totalRestarts += restarts;

    const waiting = cs.waiting as Record<string, unknown> | undefined;
    const terminated = cs.terminated as Record<string, unknown> | undefined;
    const lastState = cs.lastState as Record<string, unknown> | undefined;

    if (waiting?.reason) {
      worstReason = waiting.reason as string;
      containerName = (cs.name as string) ?? null;
    } else if (terminated?.reason) {
      worstReason = worstReason || (terminated.reason as string);
      containerName = containerName || ((cs.name as string) ?? null);
    }

    const lastTerminated = lastState?.terminated as Record<string, unknown> | undefined;
    const finishedAt = ((lastTerminated?.finishedAt as string) ?? (terminated?.finishedAt as string)) ?? null;
    if (finishedAt && (!lastRestart || finishedAt > lastRestart)) {
      lastRestart = finishedAt;
    }
  }

  return {
    namespace: (metadata.namespace as string) ?? '',
    name: (metadata.name as string) ?? '',
    phase: (status.phase as string) ?? 'Unknown',
    reason: worstReason || ((status.phase as string) ?? 'Unknown'),
    restartCount: totalRestarts,
    lastRestartTime: lastRestart,
    containerName,
  };
}

async function fetchInvestigateData(
  baseUrl: string,
  clusterId: string,
  insight: Insight,
): Promise<InvestigateData> {
  const parsed = parseInsightDetail(insight.detail);
  let podRefs = parsed.pods;

  // Fallback: if no individual pod names but a namespace is mentioned (e.g. "restart storm in namespace X"),
  // list all pods in that namespace with restarts > 0
  if (podRefs.length === 0 && parsed.namespace) {
    try {
      const result = await listResources(baseUrl, clusterId, 'pods', { namespace: parsed.namespace });
      for (const item of result.items) {
        const meta = (item.metadata ?? {}) as Record<string, unknown>;
        const status = (item.status ?? {}) as Record<string, unknown>;
        const containerStatuses = (status.containerStatuses ?? []) as Array<Record<string, unknown>>;
        const totalRestarts = containerStatuses.reduce((sum: number, cs: Record<string, unknown>) => sum + ((cs.restartCount as number) ?? 0), 0);
        if (totalRestarts > 0) {
          podRefs.push({ namespace: (meta.namespace as string) ?? parsed.namespace, name: (meta.name as string) ?? '' });
        }
      }
    } catch {
      // API error — fall through to empty
    }
  }

  if (podRefs.length === 0) {
    return {
      rootCause: { cause: 'Could not identify affected pods from alert', keyword: null },
      pods: [],
      startedAgo: timeAgo(new Date(insight.timestamp * 1000).toISOString()),
      lastRestartAgo: null,
      totalAffected: 0,
    };
  }

  const byNamespace = new Map<string, PodReference[]>();
  for (const ref of podRefs) {
    const list = byNamespace.get(ref.namespace) ?? [];
    list.push(ref);
    byNamespace.set(ref.namespace, list);
  }

  const allPodInfos: PodInvestigateInfo[] = [];
  const podNames = new Set(podRefs.map((r) => `${r.namespace}/${r.name}`));

  for (const [ns, refs] of byNamespace) {
    const matchedInNs = new Set<string>();
    try {
      const result = await listResources(baseUrl, clusterId, 'pods', { namespace: ns });
      for (const item of result.items) {
        const meta = (item.metadata ?? {}) as Record<string, unknown>;
        const key = `${meta.namespace}/${meta.name}`;
        if (podNames.has(key)) {
          matchedInNs.add(key);
          const info = extractPodInfo(item);
          allPodInfos.push({ ...info, logSnippet: null, errorSnippet: null });
        }
      }
    } catch {
      // API error — fall through, all refs become stubs below
    }
    // For any pods not found in the API (deleted/recreated), add stubs from the insight
    for (const ref of refs) {
      const key = `${ref.namespace}/${ref.name}`;
      if (!matchedInNs.has(key)) {
        allPodInfos.push({
          namespace: ref.namespace,
          name: ref.name,
          phase: 'Unknown',
          reason: insight.title.includes('CrashLoopBackOff') ? 'CrashLoopBackOff' : 'Unknown',
          restartCount: 0,
          lastRestartTime: null,
          logSnippet: null,
          errorSnippet: null,
          containerName: null,
        });
      }
    }
  }

  allPodInfos.sort((a, b) => {
    if (b.restartCount !== a.restartCount) return b.restartCount - a.restartCount;
    const aTime = a.lastRestartTime ? new Date(a.lastRestartTime).getTime() : 0;
    const bTime = b.lastRestartTime ? new Date(b.lastRestartTime).getTime() : 0;
    return bTime - aTime;
  });

  // Infer root cause: try logs first, fall back to insight title/detail
  let rootCause: RootCauseResult = inferRootCause(insight.title + '\n' + insight.detail);

  if (allPodInfos.length > 0) {
    const worst = allPodInfos[0];
    try {
      const logsUrl = getPodLogsUrl(baseUrl, clusterId, worst.namespace, worst.name, {
        tail: 30,
        follow: false,
        container: worst.containerName ?? undefined,
      });
      const resp = await fetch(logsUrl);
      if (resp.ok) {
        const logText = await resp.text();
        rootCause = inferRootCause(logText);
        worst.logSnippet = logText;
        worst.errorSnippet = extractErrorSnippet(logText);
      }
    } catch {
      // Logs unavailable
    }
  }

  const allRestartTimes = allPodInfos
    .map((p) => p.lastRestartTime)
    .filter(Boolean) as string[];

  const startedAgo = timeAgo(new Date(insight.timestamp * 1000).toISOString());
  const latestRestart = allRestartTimes.sort().reverse()[0] ?? null;
  const lastRestartAgo = timeAgo(latestRestart);

  return {
    rootCause,
    pods: allPodInfos,
    startedAgo,
    lastRestartAgo,
    totalAffected: podRefs.length,
  };
}

export function useInvestigateData(insight: Insight | null, enabled = false) {
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery<InvestigateData, Error>({
    queryKey: ['investigate', clusterId, insight?.insight_id],
    queryFn: () => fetchInvestigateData(effectiveBaseUrl, clusterId!, insight!),
    enabled: enabled && !!insight && !!clusterId && isBackendConfigured,
    staleTime: 15_000,
    retry: 1,
  });
}
