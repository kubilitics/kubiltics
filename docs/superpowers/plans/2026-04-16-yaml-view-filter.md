# YAML View Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide `metadata.managedFields` from the YAML tab by default, with a segmented Clean/Raw toggle to reveal the full raw form. Match Headlamp's proven behavior.

**Architecture:** A pure `filterYaml(obj, preset)` function strips `managedFields` for `'clean'` and is identity for `'raw'`. `YamlViewer` accepts the parsed `resource` object alongside the existing `yaml` string, owns `preset` state, and re-serializes filtered YAML with the existing `js-yaml` library. `GenericResourceDetail` passes the parsed `resource` into `YamlViewer` (one-line change — the variable is already in scope).

**Tech Stack:** TypeScript, React, Vitest, `@testing-library/react`, `js-yaml` v4.1.1, existing shadcn UI primitives (`Button`, `Tooltip`).

**Spec:** `docs/superpowers/specs/2026-04-16-yaml-view-filter-design.md`

**Intentionally dropped from the spec (YAGNI):** the "523 lines · 14 KB" size indicator in the YamlViewer header. It is polish beyond the feature's core value (hide `managedFields`); every downstream tool we compared with (Headlamp, Rancher) ships without it. Can be added later if users ask.

---

## File Structure

| File | Responsibility | State |
|---|---|---|
| `kubilitics-frontend/src/lib/yaml/filterYaml.ts` | Pure filter function. One preset enum, one exported function. No React, no js-yaml. | Create |
| `kubilitics-frontend/src/lib/yaml/filterYaml.test.ts` | Unit tests for `filterYaml`. | Create |
| `kubilitics-frontend/src/components/resources/YamlViewer.tsx` | Add `resource` prop, `preset` state, segmented Clean/Raw control in header, filtered display. | Modify |
| `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx` | Component tests: default filtered, toggle reveals raw, Copy respects mode, Edit forces Raw. | Create |
| `kubilitics-frontend/src/components/resources/GenericResourceDetail.tsx` | Pass the already-destructured `resource` into `YamlViewer`. | Modify (1 line) |

No hook changes. `useResourceDetail` already returns `resource` alongside `yaml` (see `src/hooks/useK8sResourceDetail.ts:167-176`).

---

## Task 1: Pure filter function

**Files:**
- Create: `kubilitics-frontend/src/lib/yaml/filterYaml.ts`
- Test: `kubilitics-frontend/src/lib/yaml/filterYaml.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `kubilitics-frontend/src/lib/yaml/filterYaml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterYaml } from './filterYaml';

describe('filterYaml', () => {
  it("'raw' returns input unchanged (reference equality)", () => {
    const input = { kind: 'Pod', metadata: { managedFields: [1, 2, 3] } };
    expect(filterYaml(input, 'raw')).toBe(input);
  });

  it("'clean' removes metadata.managedFields", () => {
    const input = {
      kind: 'Pod',
      metadata: {
        name: 'p',
        managedFields: [{ manager: 'kubelet' }],
      },
    };
    const out = filterYaml(input, 'clean') as { metadata: Record<string, unknown> };
    expect(out.metadata).not.toHaveProperty('managedFields');
    expect(out.metadata.name).toBe('p');
  });

  it("'clean' is a no-op when managedFields is absent", () => {
    const input = { kind: 'Pod', metadata: { name: 'p' } };
    const out = filterYaml(input, 'clean') as { metadata: Record<string, unknown> };
    expect(out.metadata).toEqual({ name: 'p' });
  });

  it("'clean' keeps status, spec, and other metadata fields intact", () => {
    const input = {
      kind: 'Pod',
      apiVersion: 'v1',
      metadata: {
        name: 'p',
        namespace: 'default',
        uid: 'abc-123',
        resourceVersion: '42',
        generation: 1,
        creationTimestamp: '2026-04-16T00:00:00Z',
        managedFields: [{ manager: 'kubelet' }],
        labels: { app: 'x' },
      },
      spec: { containers: [{ name: 'c', image: 'nginx' }] },
      status: { phase: 'Running', podIP: '10.0.0.1' },
    };
    const out = filterYaml(input, 'clean') as typeof input;
    expect(out.kind).toBe('Pod');
    expect(out.apiVersion).toBe('v1');
    expect(out.spec).toEqual(input.spec);
    expect(out.status).toEqual(input.status);
    expect(out.metadata.name).toBe('p');
    expect(out.metadata.namespace).toBe('default');
    expect(out.metadata.uid).toBe('abc-123');
    expect(out.metadata.resourceVersion).toBe('42');
    expect(out.metadata.generation).toBe(1);
    expect(out.metadata.creationTimestamp).toBe('2026-04-16T00:00:00Z');
    expect(out.metadata.labels).toEqual({ app: 'x' });
  });

  it('does not mutate its input when filtering', () => {
    const input = {
      kind: 'Pod',
      metadata: {
        name: 'p',
        managedFields: [{ manager: 'kubelet' }],
      },
    };
    const snapshot = JSON.stringify(input);
    filterYaml(input, 'clean');
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('handles missing or non-object metadata gracefully', () => {
    expect(filterYaml({ kind: 'Pod' }, 'clean')).toEqual({ kind: 'Pod' });
    expect(filterYaml({ kind: 'Pod', metadata: null }, 'clean')).toEqual({
      kind: 'Pod',
      metadata: null,
    });
  });

  it('passes null, undefined, and primitives through unchanged', () => {
    expect(filterYaml(null, 'clean')).toBe(null);
    expect(filterYaml(undefined, 'clean')).toBe(undefined);
    expect(filterYaml('string', 'clean')).toBe('string');
    expect(filterYaml(42, 'clean')).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-frontend && npx vitest run src/lib/yaml/filterYaml.test.ts`
Expected: FAIL with `Cannot find module './filterYaml'` or equivalent.

- [ ] **Step 3: Write the minimal implementation**

Create `kubilitics-frontend/src/lib/yaml/filterYaml.ts`:

```ts
/**
 * Strip display-noise from a K8s resource object before YAML serialization.
 *
 * Presets:
 *   - 'clean' (default): removes metadata.managedFields. Everything else —
 *     status, resourceVersion, uid, generation, creationTimestamp — is kept
 *     because it has debugging value. Matches Headlamp's behavior.
 *   - 'raw': identity. Returns the object unchanged.
 *
 * Pure function. Never mutates its input. Unknown or primitive inputs pass
 * through. The preset enum is the extension point: new presets can be added
 * as additional arms without changing any caller's API.
 */
export type YamlPreset = 'clean' | 'raw';

export function filterYaml<T>(obj: T, preset: YamlPreset): T {
  if (preset === 'raw' || !obj || typeof obj !== 'object') return obj;

  const input = obj as Record<string, unknown>;
  const metadata = input.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'managedFields' in (metadata as Record<string, unknown>)
  ) {
    const { managedFields: _drop, ...rest } = metadata as Record<string, unknown>;
    return { ...input, metadata: rest } as T;
  }
  return obj;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-frontend && npx vitest run src/lib/yaml/filterYaml.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-frontend/src/lib/yaml/filterYaml.ts kubilitics-frontend/src/lib/yaml/filterYaml.test.ts
git commit -m "feat(yaml): add filterYaml pure function with clean/raw presets"
```

---

## Task 2: YamlViewer accepts resource + preset state + segmented toggle

**Files:**
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.tsx`
- Test: `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx` (create)

- [ ] **Step 1: Write the failing component tests**

Create `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { YamlViewer } from './YamlViewer';

// Mock CodeEditor so tests don't need Monaco — it just renders its `value` prop
// into a textarea. That's enough to assert what the user sees.
vi.mock('@/components/editor/CodeEditor', () => ({
  CodeEditor: ({ value }: { value: string }) => (
    <textarea data-testid="code-editor" value={value} readOnly />
  ),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const podResource = {
  kind: 'Pod',
  apiVersion: 'v1',
  metadata: {
    name: 'nginx',
    namespace: 'default',
    managedFields: [
      { manager: 'kubelet', operation: 'Update', apiVersion: 'v1' },
    ],
  },
  spec: { containers: [{ name: 'nginx', image: 'nginx:1.25' }] },
  status: { phase: 'Running' },
};

const rawYaml = `kind: Pod
apiVersion: v1
metadata:
  name: nginx
  namespace: default
  managedFields:
    - manager: kubelet
      operation: Update
      apiVersion: v1
spec:
  containers:
    - name: nginx
      image: nginx:1.25
status:
  phase: Running
`;

function renderViewer(props: Partial<Parameters<typeof YamlViewer>[0]> = {}) {
  return render(
    <TooltipProvider>
      <YamlViewer
        yaml={rawYaml}
        resource={podResource}
        resourceName="nginx"
        {...props}
      />
    </TooltipProvider>,
  );
}

describe('YamlViewer — Clean/Raw filter', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('default render hides managedFields', () => {
    renderViewer();
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).not.toContain('managedFields');
    expect(editor.value).toContain('name: nginx');
    expect(editor.value).toContain('phase: Running');
  });

  it('clicking Raw reveals managedFields', () => {
    renderViewer();
    fireEvent.click(screen.getByRole('button', { name: /raw/i }));
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('managedFields');
    expect(editor.value).toContain('manager: kubelet');
  });

  it('clicking back to Clean re-hides managedFields', () => {
    renderViewer();
    fireEvent.click(screen.getByRole('button', { name: /raw/i }));
    fireEvent.click(screen.getByRole('button', { name: /clean/i }));
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).not.toContain('managedFields');
  });

  it('Copy button copies the currently-displayed filtered YAML in Clean mode', () => {
    renderViewer();
    const copyButtons = screen.getAllByRole('button', { name: /copy yaml/i });
    fireEvent.click(copyButtons[0]);
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(written).not.toContain('managedFields');
    expect(written).toContain('name: nginx');
  });

  it('falls back to raw yaml string when no resource prop is provided', () => {
    renderViewer({ resource: undefined });
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe(rawYaml);
  });

  it('Edit forces Raw and Cancel restores the previous preset', () => {
    renderViewer({ editable: true, onSave: vi.fn() });
    // Default is Clean.
    expect(screen.getByRole('button', { name: /clean/i })).toHaveAttribute('aria-pressed', 'true');
    // Enter edit mode.
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    // While editing, the full yaml is shown and segmented control is disabled.
    const editorWhileEditing = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editorWhileEditing.value).toContain('managedFields');
    expect(screen.getByRole('button', { name: /clean/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /raw/i })).toBeDisabled();
    // Cancel back to read mode.
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    const editorAfter = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editorAfter.value).not.toContain('managedFields');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: FAIL — `YamlViewer` does not accept `resource` prop; all assertions on filtered output fail because the component currently shows raw YAML.

- [ ] **Step 3: Add the `resource` prop to the interface**

In `kubilitics-frontend/src/components/resources/YamlViewer.tsx`, modify the `YamlViewerProps` interface (currently lines 19-28):

```ts
export interface YamlViewerProps {
  yaml: string;
  /** Parsed K8s resource object. When provided, enables the Clean/Raw filter. */
  resource?: unknown;
  resourceName: string;
  editable?: boolean;
  onSave?: (yaml: string) => Promise<void> | void;
  /** Fetch the latest YAML from the server (used for conflict resolution). */
  onFetchLatest?: () => Promise<string>;
  /** Optional warning or notice (e.g. Pod immutability) shown below the description */
  warning?: React.ReactNode;
}
```

And update the component signature (line 63):

```ts
export function YamlViewer({ yaml, resource, resourceName, editable = false, onSave, onFetchLatest, warning }: YamlViewerProps) {
```

- [ ] **Step 4: Add imports, preset state, and displayYaml memo**

Add imports at the top of `YamlViewer.tsx` (after the existing `js-yaml` import on line 11):

```ts
import { filterYaml, type YamlPreset } from '@/lib/yaml/filterYaml';
import { useMemo } from 'react';
```

Note: `useState`, `useCallback`, `useEffect` are already imported on line 1. Add `useMemo` to the same import line if it isn't present.

After the existing `useState` hooks inside the component (around line 70, after `conflictDetected`), add:

```ts
const [preset, setPreset] = useState<YamlPreset>('clean');

const displayYaml = useMemo(() => {
  if (!resource || preset === 'raw') return yaml;
  try {
    return yamlParser.dump(filterYaml(resource, 'clean'), {
      indent: 2,
      noArrayIndent: false,
      skipInvalid: true,
      flowLevel: -1,
      noRefs: true,
      lineWidth: -1,
    });
  } catch {
    return yaml;
  }
}, [preset, resource, yaml]);
```

- [ ] **Step 5: Route all read-mode references through `displayYaml`**

In `handleCopy` (currently lines 91-96), replace the `yaml` read-mode reference:

```ts
const handleCopy = useCallback(() => {
  navigator.clipboard.writeText(isEditing ? editedYaml : displayYaml);
  setCopied(true);
  toast.success('YAML copied to clipboard');
  setTimeout(() => setCopied(false), 2000);
}, [isEditing, editedYaml, displayYaml]);
```

In `handleDownload` (currently lines 98-110), replace the `yaml` read-mode reference:

```ts
const handleDownload = useCallback(() => {
  const content = isEditing ? editedYaml : displayYaml;
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${resourceName}.yaml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  toast.success(`Downloaded ${resourceName}.yaml`);
}, [isEditing, editedYaml, displayYaml, resourceName]);
```

In `handleEdit` (currently lines 112-117), seed the editor from the raw `yaml` (always full form — editing must round-trip faithfully). Also stash the previous preset so we can restore it when editing exits.

Add a ref alongside the other `useState` hooks:

```ts
const previousPresetRef = useRef<YamlPreset>('clean');
```

Add `useRef` to the import on line 1 if it's not already present.

Then modify `handleEdit`:

```ts
const handleEdit = () => {
  previousPresetRef.current = preset;
  setEditedYaml(yaml);
  setErrors([]);
  setEditorKey((k) => k + 1);
  setPreset('raw');
  setIsEditing(true);
};
```

And modify `handleCancel` (currently lines 119-123) to restore the previous preset on exit:

```ts
const handleCancel = () => {
  setEditedYaml(yaml);
  setErrors([]);
  setIsEditing(false);
  setPreset(previousPresetRef.current);
};
```

The existing `handleSave` flow also exits edit mode on success — find the `setIsEditing(false)` call in `handleSave` and add `setPreset(previousPresetRef.current);` immediately after it. (If there are multiple exit points in `handleSave`, add the restore after each.)

In the read-mode `CodeEditor` at the bottom of the return JSX (currently line 409-415), replace the `value={yaml}` with `value={displayYaml}`:

```tsx
<CodeEditor
  value={displayYaml}
  readOnly
  minHeight="600px"
  className="rounded-none border-0"
  fontSize="small"
/>
```

- [ ] **Step 6: Add the segmented Clean/Raw control in the header**

Find the `<>` fragment in read-mode actions (currently line 274, right before the `<Tooltip>` wrapping the Copy button). Insert the segmented control as the first child of that fragment:

```tsx
{resource && (
  <>
    <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 mr-1">
      <Button
        variant={preset === 'clean' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
        onClick={() => setPreset('clean')}
        disabled={isEditing}
        aria-pressed={preset === 'clean'}
        aria-label="Clean (hide managedFields)"
      >
        Clean
      </Button>
      <Button
        variant={preset === 'raw' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
        onClick={() => setPreset('raw')}
        disabled={isEditing}
        aria-pressed={preset === 'raw'}
        aria-label="Raw (show full YAML)"
      >
        Raw
      </Button>
    </div>
    <Separator orientation="vertical" className="h-4 mx-1" />
  </>
)}
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
```

The `{resource && ...}` guard means viewers that still pass only the string (no parsed object) keep their old behavior — no breakage.

Then, immediately after the warning banner block (currently around line 310, the `{warning && ...}` block), insert the Raw-mode helper caption so it sits between the header and the editor area:

```tsx
{!isEditing && preset === 'raw' && resource && (
  <div className="px-4 py-1.5 text-[11px] text-muted-foreground bg-muted/20 border-b border-border">
    Showing full YAML including <code className="font-mono">managedFields</code>.
  </div>
)}
```

When Clean is active (the default), no caption renders — the normal case has no chrome.

- [ ] **Step 7: Run component tests to verify they pass**

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 8: Typecheck**

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add kubilitics-frontend/src/components/resources/YamlViewer.tsx kubilitics-frontend/src/components/resources/YamlViewer.test.tsx
git commit -m "feat(yaml): Clean/Raw preset toggle in YamlViewer

Accept the parsed resource alongside the serialized string, run it
through filterYaml('clean') by default, and add a segmented toggle that
flips between Clean (no managedFields) and Raw. Copy/Download respect
the current mode. Edit forces Raw because edited YAML must round-trip
faithfully through js-yaml. Viewers that omit the resource prop keep
their existing unfiltered behavior."
```

---

## Task 3: Wire GenericResourceDetail to pass the resource

**Files:**
- Modify: `kubilitics-frontend/src/components/resources/GenericResourceDetail.tsx:636`

- [ ] **Step 1: Pass `resource` into the YamlViewer element**

Currently at `GenericResourceDetail.tsx:636`:

```tsx
content: <YamlViewer yaml={yaml} resourceName={ctx.name} editable onSave={handleSaveYaml} onFetchLatest={handleFetchLatestYaml} />,
```

Change to:

```tsx
content: <YamlViewer yaml={yaml} resource={resource} resourceName={ctx.name} editable onSave={handleSaveYaml} onFetchLatest={handleFetchLatestYaml} />,
```

`resource` is already destructured at line 423 — no new hook call, no new import.

- [ ] **Step 2: Typecheck**

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 3: Run the full yaml + viewer test files to confirm nothing regressed**

Run: `cd kubilitics-frontend && npx vitest run src/lib/yaml src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 13 tests total (7 filterYaml + 6 YamlViewer).

- [ ] **Step 4: Manual smoke test**

With `npm run tauri dev` already running:
1. Navigate to any Pod detail page (e.g. `otel-demo/ad-667f9497cd-2pq46`).
2. Click the **YAML** tab.
3. Verify the output does NOT contain `managedFields:`.
4. Click **Raw** in the segmented control at the top-right.
5. Verify the output now contains `managedFields:` and the full kubelet entries.
6. Click **Clean** — `managedFields` disappears again.
7. Click **Copy YAML** while in Clean mode. Paste into a scratch file. Confirm no `managedFields`.
8. Click **Edit**. Confirm the editor shows the full raw form and the Clean/Raw buttons are disabled.
9. Cancel edit. Confirm Clean view is restored.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-frontend/src/components/resources/GenericResourceDetail.tsx
git commit -m "feat(yaml): pass parsed resource into YamlViewer for Clean/Raw filter"
```

---

## Final Verification

- [ ] Run the full frontend test suite to catch unexpected regressions.

Run: `cd kubilitics-frontend && npx vitest run`
Expected: all tests pass.

- [ ] Confirm the working tree is clean.

Run: `git status`
Expected: `nothing to commit, working tree clean`.
