// src/lib/parseInsightPods.ts

export interface PodReference {
  namespace: string;
  name: string;
}

export interface InsightParseResult {
  pods: PodReference[];
  /** Namespace mentioned in the insight (for fallback listing when no pod names found) */
  namespace: string | null;
}

/**
 * Extract pod namespace/name pairs from an insight detail string.
 * Handles formats like:
 *   "3 pod(s) in CrashLoopBackOff: ns1/pod1, ns2/pod2, ns3/pod3"
 *   "ns/pod-name is failing"
 *   "26 pod restart events in 5 minutes in namespace otel-demo" (namespace-only)
 */
export function parseInsightPods(detail: string): PodReference[] {
  return parseInsightDetail(detail).pods;
}

export function parseInsightDetail(detail: string): InsightParseResult {
  const pods: PodReference[] = [];
  // Match namespace/pod-name patterns (K8s names: lowercase alphanumeric, hyphens, dots)
  const regex = /([a-z0-9][-a-z0-9.]*)\/([a-z0-9][-a-z0-9.]*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(detail)) !== null) {
    pods.push({ namespace: match[1], name: match[2] });
  }

  // Extract namespace from "in namespace <ns>" pattern (for restart storms, etc.)
  let namespace: string | null = null;
  const nsMatch = detail.match(/in namespace\s+([a-z0-9][-a-z0-9.]*)/i);
  if (nsMatch) {
    namespace = nsMatch[1];
  }

  return { pods, namespace };
}
