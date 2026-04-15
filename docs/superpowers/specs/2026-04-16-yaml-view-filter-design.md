# YAML View Filter — Design Spec

**Date:** 2026-04-16
**Author:** Koti (with Claude)
**Status:** Draft, pending review

## Problem

The YAML tab on every resource detail page renders the full K8s object including `metadata.managedFields`. On a typical pod, `managedFields` is 80–95% of the output — a wall of field-tracking metadata that's useless to humans and drowns the fields users actually want to see (spec, status, labels, env vars). Headlamp, Rancher, k9s, and Lens all hide it by default.

## Goal

Show clean YAML by default, with a single explicit toggle to reveal the raw form. Match Headlamp's proven behavior: hide only `managedFields`, keep everything else (status, resourceVersion, uid, generation, creationTimestamp) because those fields have legitimate debugging value and the user has just built a Diagnose panel that depends on `status`.

## Non-Goals

- A multi-checkbox preferences panel for "which fields to hide" (Rancher path — rejected as YAGNI).
- Persisting the toggle state across sessions. Session-only is enough.
- Touching `YamlEditorDialog.tsx`, which already has its own `stripManagedFields` helper. Unifying the two is a separate cleanup.
- Changing backend YAML generation. All filtering happens in the frontend.

## Architecture

Three small units with clear boundaries:

### 1. `src/lib/yaml/filterYaml.ts` (new)

Pure function, no React, no `js-yaml` import. Takes a K8s resource object and a preset name, returns a new object with noise fields removed. Easy to unit-test with fixtures.

```ts
export type YamlPreset = 'clean' | 'raw';

export function filterYaml<T>(obj: T, preset: YamlPreset): T;
```

**Preset semantics:**
- `'clean'` (default): removes `metadata.managedFields`. Nothing else.
- `'raw'`: identity. Returns input unchanged.

**Implementation constraints:**
- Never mutates its input. Shallow-clones the top level, replaces `metadata` with a rest-destructured copy that omits `managedFields`.
- Null / undefined / primitives pass through.
- No deep clone of `spec`/`status` — they're never mutated and a deep clone is expensive on Helm-heavy resources.

**Why a preset enum and not a boolean:** future presets (`'minimal'`, `'kubectl-apply-ready'`, etc.) can be added as additional `case` arms without changing the component API. YAGNI for the presets themselves; not YAGNI for the shape of the extension point.

### 2. `src/hooks/useK8sResourceDetail.ts` (modify)

Currently returns only a serialized `yaml` string. Expose the parsed object alongside it:

```ts
return { data: resource, yaml: rawYamlString, ... };
```

`data` was already fetched — this is a zero-cost exposure, not a second API call. Existing callers that read `yaml` keep working unchanged. `YamlViewer` is the only new consumer of `data`.

### 3. `src/components/resources/YamlViewer.tsx` (modify)

Adds a `resource` prop (the parsed object) alongside the existing `yaml` string prop. Owns preset state:

```ts
const [preset, setPreset] = useState<YamlPreset>('clean');

const displayYaml = useMemo(() => {
  if (preset === 'raw' || !resource) return yaml;
  return yamlDump(filterYaml(resource, 'clean'), { lineWidth: -1, noRefs: true });
}, [preset, resource, yaml]);
```

The `!resource` guard means: if the parent didn't pass `resource` (legacy usage), fall back to the raw string. Safe migration.

## UI

A segmented control placed next to the existing Copy / Download / Edit buttons in the viewer header:

```
[ Clean | Raw ]    Copy   Download   Edit
```

Two explicit modes beats a binary "show managedFields" toggle because the labels tell the user what they'll see, not what they're toggling.

**Defaults:** `Clean`.

**Helper caption:** when `Raw` is active, show a small muted caption below the control: *"Showing full YAML including managedFields."* When `Clean` is active: no caption. The normal case needs no chrome.

**Size indicator (polish):** header shows `"523 lines · 14 KB"` for the currently displayed YAML, so the user can see at a glance how much noise was hidden.

## Behaviors

**Copy / Download respect current mode.** If the user is viewing Clean, they copy Clean. This is the right default: a user who wants raw flips first, then copies.

**Edit mode forces Raw.** Editing a filtered view then saving would silently drop `managedFields`, which is fine semantically (the API server ignores it on PUT) but confusing. Entering Edit sets `preset = 'raw'` and disables the toggle. Exiting Edit restores the previous preset.

**Unknown / empty resource.** If `resource` is undefined (race with the fetch, or a legacy caller), `displayYaml` falls back to the raw `yaml` string unchanged. No crash, no spinner flash.

## Testing

### Unit tests — `filterYaml.test.ts`

1. `'raw'` returns input by reference equality.
2. `'clean'` removes `metadata.managedFields` when present.
3. `'clean'` is a no-op when `managedFields` is absent.
4. `'clean'` does not touch `status`, `spec`, `metadata.resourceVersion`, `metadata.uid`, `metadata.generation`, `metadata.creationTimestamp`, or any other field.
5. Input is never mutated — freeze the input with `Object.freeze` deeply and assert `filterYaml` does not throw and the frozen input is unchanged.
6. Null, undefined, strings, numbers pass through without crashing.

### Component tests — `YamlViewer.test.tsx`

1. Default render of a pod with `managedFields` shows no `managedFields:` substring in the output.
2. Clicking the `Raw` pill reveals `managedFields:` in the output.
3. Clicking back to `Clean` re-hides it.
4. Copy button places the currently-displayed YAML on the clipboard (stub `navigator.clipboard`).
5. Entering Edit mode flips preset to Raw and disables the segmented control.
6. Exiting Edit restores the prior preset.

### Fixture

Add `pod-with-managedfields.yaml` fixture to the existing test fixtures directory. Use the real OTel Demo `ad-667f9497cd-2pq46` pod YAML the user pasted in the conversation — it's a realistic 250+ line case dominated by `managedFields`.

## Files Touched

- **Create:** `src/lib/yaml/filterYaml.ts`, `src/lib/yaml/filterYaml.test.ts`, `src/lib/yaml/__fixtures__/pod-with-managedfields.yaml`
- **Modify:** `src/hooks/useK8sResourceDetail.ts` (expose parsed `data`)
- **Modify:** `src/components/resources/YamlViewer.tsx` (preset state, segmented control, filter integration, edit-mode interaction)
- **Create:** `src/components/resources/YamlViewer.test.tsx` (if absent — otherwise extend)

No changes to backend, routing, or other resource detail pages. `GenericResourceDetail` passes the new `resource` prop through to `YamlViewer` — one-line change.

## Risks and Mitigations

- **Risk:** `useK8sResourceDetail` exposing `data` changes its public shape. **Mitigation:** it's additive, existing fields unchanged, all current callers keep working. Grep confirms no caller destructures with a complete rest pattern.
- **Risk:** A resource with no `metadata` object (unusual — some CRDs). **Mitigation:** the `filterYaml` guard checks `metadata && typeof metadata === 'object'` before touching it.
- **Risk:** Edit mode interaction confusion (toggle disabled). **Mitigation:** the segmented control visibly disables and a tooltip explains why.

## Out of Scope

- Unifying `stripManagedFields` in `YamlEditorDialog.tsx` with the new `filterYaml` module. Worth doing in a follow-up, not this task.
- Adding more presets (`'minimal'`, etc.). The extension point is ready; shipping more presets waits for user demand.
- Persisting toggle state in localStorage or the UI store.
