/**
 * Strip display-noise from a K8s resource object before YAML serialization,
 * and provide companion helpers for JSON rendering, size detection, and the
 * list of well-known fold paths.
 *
 * Presets:
 *   - 'clean' (default): removes metadata.managedFields. Everything else —
 *     status, resourceVersion, uid, generation, creationTimestamp — is kept
 *     because it has debugging value. Matches Headlamp's behavior.
 *   - 'apply-ready': removes all server-managed metadata (uid, resourceVersion,
 *     creationTimestamp, generation, selfLink, ownerReferences, managedFields)
 *     AND the top-level status block. Output is safe to pipe to kubectl apply.
 *   - 'raw': identity. Returns the object unchanged.
 *
 * Pure: never mutates its input. Unknown or primitive inputs pass through.
 * The preset enum is the extension point: new presets can be added as
 * additional arms without changing any caller's API.
 */
export type YamlPreset = 'clean' | 'apply-ready' | 'raw';

const APPLY_READY_METADATA_STRIP = [
  'managedFields',
  'uid',
  'resourceVersion',
  'creationTimestamp',
  'generation',
  'selfLink',
  'ownerReferences',
] as const;

export function filterYaml<T>(obj: T, preset: YamlPreset): T {
  if (preset === 'raw' || !obj || typeof obj !== 'object') return obj;

  const input = obj as Record<string, unknown>;
  const metadata = input.metadata;
  const hasMetadataObject =
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata);

  if (preset === 'clean') {
    if (hasMetadataObject && 'managedFields' in (metadata as Record<string, unknown>)) {
      const { managedFields: _drop, ...rest } = metadata as Record<string, unknown>;
      return { ...input, metadata: rest } as T;
    }
    return obj;
  }

  // 'apply-ready'
  const next: Record<string, unknown> = { ...input };
  if (hasMetadataObject) {
    const metaRecord = metadata as Record<string, unknown>;
    const cleanedMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metaRecord)) {
      if (!(APPLY_READY_METADATA_STRIP as readonly string[]).includes(k)) {
        cleanedMeta[k] = v;
      }
    }
    next.metadata = cleanedMeta;
  }
  delete next.status;
  return next as T;
}

/**
 * JSON serialization companion to filterYaml. Separate function so callers
 * don't inline JSON.stringify and we have a single place to add stable key
 * sorting later if needed.
 */
export function toJson(obj: unknown, opts?: { indent?: number }): string {
  const indent = opts?.indent ?? 2;
  return JSON.stringify(obj, null, indent);
}

/**
 * True when the serialized YAML (or JSON) string exceeds 1 MB. Typical K8s
 * resources are < 50 KB; above 1 MB Monaco's first paint becomes noticeable
 * and the Power Pack applies auto-folding + a warning banner.
 */
const LARGE_RESOURCE_BYTES = 1_048_576; // 1 MB

export function isLargeResource(text: string): boolean {
  return text.length > LARGE_RESOURCE_BYTES;
}

/**
 * Well-known YAML paths that can be folded on demand. Consumers pass these to
 * Monaco's folding API (via a local range-finder that walks the serialized
 * text). Kept stable so the fold menu renders deterministically and the
 * object identity survives re-renders (cheap to memo against).
 */
const WELL_KNOWN_FOLD_PATHS: ReadonlyArray<{ path: string; label: string }> = [
  { path: 'metadata.managedFields', label: 'Fold managedFields' },
  { path: 'status', label: 'Fold status' },
  { path: 'spec.template', label: 'Fold spec.template' },
];

export function wellKnownFoldPaths(): ReadonlyArray<{ path: string; label: string }> {
  return WELL_KNOWN_FOLD_PATHS;
}
