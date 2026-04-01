/**
 * Shared kubeconfig parsing utilities.
 *
 * Used by ContextPicker, ClusterConnect, and WelcomeAddCluster
 * to avoid duplicating YAML parsing and base64 encoding logic.
 */
import yaml from 'js-yaml';

/**
 * Extract the best context name from a kubeconfig YAML string.
 * Prefers `current-context`; falls back to the first `contexts[].name`.
 */
export function extractContextFromKubeconfig(text: string): string {
  try {
    const doc = yaml.load(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return '';
    if (typeof doc['current-context'] === 'string' && doc['current-context']) {
      return doc['current-context'];
    }
    const contextsRaw = doc['contexts'];
    if (Array.isArray(contextsRaw) && contextsRaw.length > 0) {
      const first = contextsRaw[0] as Record<string, unknown>;
      if (typeof first['name'] === 'string' && first['name']) return first['name'];
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Parse all context names from a kubeconfig YAML string.
 * Returns deduplicated context names and the current-context value.
 */
export function parseKubeconfigContexts(text: string): { contexts: string[]; currentContext: string } {
  try {
    const doc = yaml.load(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return { contexts: [], currentContext: '' };

    const currentContext = typeof doc['current-context'] === 'string' ? doc['current-context'] : '';

    const contextsRaw = doc['contexts'];
    const contexts: string[] = [];
    if (Array.isArray(contextsRaw)) {
      for (const entry of contextsRaw) {
        if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['name'] === 'string') {
          const name = ((entry as Record<string, unknown>)['name'] as string).trim();
          if (name && !contexts.includes(name)) contexts.push(name);
        }
      }
    }
    return { contexts, currentContext };
  } catch {
    return { contexts: [], currentContext: '' };
  }
}

/**
 * Encode a Uint8Array to standard base64 (with padding).
 * Compatible with Go's base64.StdEncoding.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Encode a UTF-8 string to standard base64.
 */
export function stringToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}
