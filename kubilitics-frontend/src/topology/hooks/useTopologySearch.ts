import { useState, useMemo, useCallback } from "react";
import type { TopologyNode } from "../types/topology";

export interface SearchResult {
  node: TopologyNode;
  matchReason: string;
}

/**
 * useTopologySearch: Provides search functionality with syntax support:
 * - Plain text: searches name, kind, namespace
 * - kind:Pod: filters by resource kind
 * - ns:default: filters by namespace
 * - label:app=nginx: filters by label key=value
 * - status:error: filters by status
 */
export function useTopologySearch(nodes: TopologyNode[] | undefined) {
  const [query, setQuery] = useState("");

  const results = useMemo((): SearchResult[] => {
    if (!query.trim() || !nodes?.length) return [];

    const parsed = parseSearchQuery(query);
    return nodes
      .filter((n) => matchesSearch(n, parsed))
      .map((n) => ({
        node: n,
        matchReason: getMatchReason(n, parsed),
      }))
      .slice(0, 50); // Limit results
  }, [query, nodes]);

  const clearSearch = useCallback(() => setQuery(""), []);

  return { query, setQuery, results, clearSearch, hasResults: results.length > 0 };
}

interface ParsedQuery {
  text: string;
  kind?: string;
  namespace?: string;
  label?: { key: string; value: string };
  status?: string;
}

function parseSearchQuery(raw: string): ParsedQuery {
  const parts = raw.trim().split(/\s+/);
  const parsed: ParsedQuery = { text: "" };
  const textParts: string[] = [];

  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const prefix = part.substring(0, colonIdx).toLowerCase();
      const value = part.substring(colonIdx + 1);
      switch (prefix) {
        case "kind":
          parsed.kind = value.toLowerCase();
          continue;
        case "ns":
        case "namespace":
          parsed.namespace = value;
          continue;
        case "label": {
          const eqIdx = value.indexOf("=");
          if (eqIdx > 0) {
            parsed.label = { key: value.substring(0, eqIdx), value: value.substring(eqIdx + 1) };
          } else {
            parsed.label = { key: value, value: "" };
          }
          continue;
        }
        case "status":
          parsed.status = value.toLowerCase();
          continue;
      }
    }
    textParts.push(part);
  }
  parsed.text = textParts.join(" ").toLowerCase();
  return parsed;
}

function matchesSearch(node: TopologyNode, q: ParsedQuery): boolean {
  if (q.kind && node.kind.toLowerCase() !== q.kind) return false;
  if (q.namespace && node.namespace !== q.namespace) return false;
  if (q.status && !node.status.toLowerCase().includes(q.status)) return false;
  if (q.label) {
    const labels = node.labels ?? {};
    if (q.label.value) {
      if (labels[q.label.key] !== q.label.value) return false;
    } else {
      if (!(q.label.key in labels)) return false;
    }
  }
  if (q.text) {
    const searchable = `${node.name} ${node.kind} ${node.namespace} ${node.status}`.toLowerCase();
    return searchable.includes(q.text);
  }
  return true;
}

function getMatchReason(node: TopologyNode, q: ParsedQuery): string {
  const reasons: string[] = [];
  if (q.kind) reasons.push(`kind:${node.kind}`);
  if (q.namespace) reasons.push(`ns:${node.namespace}`);
  if (q.status) reasons.push(`status:${node.status}`);
  if (q.label) reasons.push(`label:${q.label.key}`);
  if (q.text) reasons.push(`name match`);
  return reasons.join(", ") || "match";
}
