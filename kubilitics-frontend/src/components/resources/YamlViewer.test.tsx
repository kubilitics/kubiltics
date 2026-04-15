import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { YamlViewer } from './YamlViewer';
import type { YamlCopyMenuProps } from './YamlCopyMenu';

// ── Module-level spy to capture what YamlViewer passes to YamlCopyMenu ────────
// We wrap the real YamlCopyMenu so we can intercept onCopy calls and inspect
// the pre-computed strings (cleanYaml, applyReadyYaml, rawYaml, jsonText,
// kubectlApplyCommand) that YamlViewer computes before handing them down.
// This avoids relying on navigator.clipboard (unreliable in vitest's vm context).

// Holds the most-recent props passed to YamlCopyMenu by YamlViewer.
let capturedMenuProps: YamlCopyMenuProps | null = null;
// Spy called whenever YamlCopyMenu's onCopy fires.
const copyMenuOnCopySpy = vi.fn<[string, string], void>();

vi.mock('./YamlCopyMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./YamlCopyMenu')>();
  return {
    ...actual,
    YamlCopyMenu: (props: YamlCopyMenuProps) => {
      capturedMenuProps = props;
      const wrappedOnCopy = (label: string, text: string) => {
        copyMenuOnCopySpy(label, text);
        props.onCopy(label, text);
      };
      return <actual.YamlCopyMenu {...props} onCopy={wrappedOnCopy} />;
    },
  };
});

// ── Fake Monaco editor ─────────────────────────────────────────────────────────
// Records fold API calls so tests can verify the fold menu is wired correctly.

interface FakeEditorCalls {
  foldAllCalled: number;
  unfoldAllCalled: number;
  foldSelectedCalled: number;
  lastSelection?: { startLine: number; endLine: number };
  cursorListeners: Array<(e: { position: { lineNumber: number } }) => void>;
}

let fakeEditorCalls: FakeEditorCalls;

function createFakeEditor(calls: FakeEditorCalls) {
  return {
    getAction: (id: string) => ({
      run: () => {
        if (id === 'editor.foldAll') calls.foldAllCalled++;
        else if (id === 'editor.unfoldAll') calls.unfoldAllCalled++;
        else if (id === 'editor.foldSelected') calls.foldSelectedCalled++;
        return Promise.resolve();
      },
    }),
    setSelection: (range: { startLineNumber?: number; endLineNumber?: number } | unknown) => {
      const r = range as { startLineNumber?: number; endLineNumber?: number };
      if (r.startLineNumber !== undefined && r.endLineNumber !== undefined) {
        calls.lastSelection = { startLine: r.startLineNumber, endLine: r.endLineNumber };
      }
    },
    onDidChangeCursorPosition: (listener: (e: { position: { lineNumber: number } }) => void) => {
      calls.cursorListeners.push(listener);
      return { dispose: () => {} };
    },
    revealLineInCenter: () => {},
    getModel: () => null,
  } as unknown as import('monaco-editor').editor.IStandaloneCodeEditor;
}

// Mock CodeEditor so tests don't need Monaco — it just renders its `value` prop
// into a textarea. The onEditorReady callback fires once on mount with a fake
// Monaco editor so fold-menu tests can verify the fold API is called correctly.
vi.mock('@/components/editor/CodeEditor', () => ({
  CodeEditor: ({
    value,
    onEditorReady,
  }: {
    value: string;
    onEditorReady?: (e: unknown) => void;
  }) => {
    const didFire = React.useRef(false);
    React.useEffect(() => {
      if (!didFire.current && onEditorReady) {
        didFire.current = true;
        onEditorReady(createFakeEditor(fakeEditorCalls));
      }
    }, [onEditorReady]);
    return <textarea data-testid="code-editor" value={value} readOnly />;
  },
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
    capturedMenuProps = null;
    copyMenuOnCopySpy.mockClear();
    fakeEditorCalls = {
      foldAllCalled: 0,
      unfoldAllCalled: 0,
      foldSelectedCalled: 0,
      cursorListeners: [],
    };
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

  it('Copy menu Clean item copies filtered YAML in Clean mode', async () => {
    const user = userEvent.setup();
    renderViewer();
    await user.click(screen.getByRole('button', { name: /copy menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /copy as yaml \(clean\)/i }));
    const written = copyMenuOnCopySpy.mock.calls[0][1];
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

  it("'Apply-ready' preset hides status, uid, resourceVersion", () => {
    renderViewer({
      resource: {
        ...podResource,
        metadata: {
          ...podResource.metadata,
          uid: 'abc',
          resourceVersion: '42',
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /apply-ready/i }));
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).not.toContain('status:');
    expect(editor.value).not.toContain('uid:');
    expect(editor.value).not.toContain('resourceVersion:');
    expect(editor.value).toContain('name: nginx');
    expect(editor.value).toContain('image: nginx:1.25');
  });

  it('JSON mode with Clean preset produces valid JSON without managedFields', () => {
    renderViewer();
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    const parsed = JSON.parse(editor.value);
    expect(parsed.kind).toBe('Pod');
    expect(parsed.metadata).not.toHaveProperty('managedFields');
    expect(parsed.status).toBeDefined();
  });

  it('JSON mode with Apply-ready preset strips status and uid', () => {
    renderViewer({
      resource: {
        ...podResource,
        metadata: { ...podResource.metadata, uid: 'abc' },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /apply-ready/i }));
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    const parsed = JSON.parse(editor.value);
    expect(parsed).not.toHaveProperty('status');
    expect(parsed.metadata).not.toHaveProperty('uid');
  });

  it('Edit mode forces preset=Raw and mode=YAML; Cancel restores both', () => {
    renderViewer({ editable: true, onSave: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: /apply-ready/i }));
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByRole('button', { name: /clean/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /apply-ready/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^raw$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^yaml$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^json$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /apply-ready/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^json$/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('YamlViewer — YamlCopyMenu integration', () => {
  beforeEach(() => {
    capturedMenuProps = null;
    copyMenuOnCopySpy.mockClear();
    fakeEditorCalls = {
      foldAllCalled: 0,
      unfoldAllCalled: 0,
      foldSelectedCalled: 0,
      cursorListeners: [],
    };
  });

  it('copy menu Clean item copies filtered YAML without managedFields', async () => {
    const user = userEvent.setup();
    renderViewer();
    await user.click(screen.getByRole('button', { name: /copy menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /copy as yaml \(clean\)/i }));
    const written = copyMenuOnCopySpy.mock.calls[0][1];
    expect(written).not.toContain('managedFields');
    expect(written).toContain('name: nginx');
  });

  it('copy menu Apply-ready item copies stripped YAML', async () => {
    const user = userEvent.setup();
    renderViewer({
      resource: {
        ...podResource,
        metadata: { ...podResource.metadata, uid: 'abc', resourceVersion: '42' },
      },
    });
    await user.click(screen.getByRole('button', { name: /copy menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /copy as yaml \(apply-ready\)/i }));
    const written = copyMenuOnCopySpy.mock.calls[0][1];
    expect(written).not.toContain('status:');
    expect(written).not.toContain('uid:');
    expect(written).not.toContain('resourceVersion:');
    expect(written).toContain('name: nginx');
  });

  it('copy menu Raw item copies unfiltered YAML with managedFields', async () => {
    const user = userEvent.setup();
    renderViewer();
    await user.click(screen.getByRole('button', { name: /copy menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /copy as yaml \(raw\)/i }));
    const written = copyMenuOnCopySpy.mock.calls[0][1];
    expect(written).toContain('managedFields');
  });

  it('copy menu JSON item copies valid apply-ready JSON', async () => {
    const user = userEvent.setup();
    renderViewer({
      resource: {
        ...podResource,
        metadata: { ...podResource.metadata, uid: 'abc' },
      },
    });
    await user.click(screen.getByRole('button', { name: /copy menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /copy as json/i }));
    const written = copyMenuOnCopySpy.mock.calls[0][1];
    const parsed = JSON.parse(written);
    expect(parsed.kind).toBe('Pod');
    expect(parsed.metadata).not.toHaveProperty('uid');
    expect(parsed).not.toHaveProperty('status');
  });

  it('copy menu kubectl apply item copies heredoc command', async () => {
    const user = userEvent.setup();
    renderViewer();
    await user.click(screen.getByRole('button', { name: /copy menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /kubectl apply/i }));
    const written = copyMenuOnCopySpy.mock.calls[0][1];
    expect(written).toContain("cat <<'EOF' | kubectl apply -f -");
    expect(written).toContain('EOF');
    expect(written).toContain('name: nginx');
  });
});

describe('YamlViewer — fold menu', () => {
  beforeEach(() => {
    capturedMenuProps = null;
    copyMenuOnCopySpy.mockClear();
    fakeEditorCalls = {
      foldAllCalled: 0,
      unfoldAllCalled: 0,
      foldSelectedCalled: 0,
      cursorListeners: [],
    };
  });

  it('Fold All menu item calls editor.foldAll', async () => {
    const user = userEvent.setup();
    renderViewer();
    await user.click(screen.getByRole('button', { name: /fold menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /^fold all$/i }));
    expect(fakeEditorCalls.foldAllCalled).toBe(1);
  });

  it('Unfold All menu item calls editor.unfoldAll', async () => {
    const user = userEvent.setup();
    renderViewer();
    await user.click(screen.getByRole('button', { name: /fold menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /^unfold all$/i }));
    expect(fakeEditorCalls.unfoldAllCalled).toBe(1);
  });

  it('Fold status menu item selects a line range then folds (in Raw preset)', async () => {
    const user = userEvent.setup();
    renderViewer();
    // Switch to Raw so `status:` is visible in the text.
    await user.click(screen.getByRole('button', { name: /^raw$/i }));
    await user.click(screen.getByRole('button', { name: /fold menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /fold status/i }));
    expect(fakeEditorCalls.lastSelection?.startLine).toBeGreaterThan(0);
    expect(fakeEditorCalls.foldSelectedCalled).toBe(1);
  });

  it('Fold managedFields item is disabled in Clean preset', async () => {
    const user = userEvent.setup();
    renderViewer();
    await user.click(screen.getByRole('button', { name: /fold menu/i }));
    const item = screen.getByRole('menuitem', { name: /fold managedfields/i });
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('YamlViewer — breadcrumb', () => {
  beforeEach(() => {
    capturedMenuProps = null;
    copyMenuOnCopySpy.mockClear();
    fakeEditorCalls = {
      foldAllCalled: 0,
      unfoldAllCalled: 0,
      foldSelectedCalled: 0,
      cursorListeners: [],
    };
  });

  it('breadcrumb updates when cursor moves', async () => {
    const user = userEvent.setup();
    renderViewer();
    // Switch to Raw so the full YAML (with top-level keys at known lines) is rendered.
    await user.click(screen.getByRole('button', { name: /^raw$/i }));
    // After re-render, the effect re-subscribes with fresh displayYaml and pushes a new listener.
    // Fire the most recent listener at line 4 (inside metadata: of the rawYaml fixture).
    const listener =
      fakeEditorCalls.cursorListeners[fakeEditorCalls.cursorListeners.length - 1];
    expect(listener).toBeDefined();
    listener({ position: { lineNumber: 4 } });
    // Assert a breadcrumb row is rendered. It's a div with font-mono class.
    // Use a role-agnostic query on the expected text content from the walker.
    const breadcrumb = await screen.findByText(/metadata/i);
    expect(breadcrumb).toBeInTheDocument();
  });
});

describe('YamlViewer — large-resource guard', () => {
  beforeEach(() => {
    capturedMenuProps = null;
    copyMenuOnCopySpy.mockClear();
    fakeEditorCalls = {
      foldAllCalled: 0,
      unfoldAllCalled: 0,
      foldSelectedCalled: 0,
      cursorListeners: [],
    };
  });

  it('renders banner when displayYaml exceeds 1 MB', () => {
    const bigYaml = 'x'.repeat(1_500_000);
    renderViewer({ yaml: bigYaml, resource: undefined });
    expect(screen.getByText(/large resource/i)).toBeInTheDocument();
  });

  it('banner is dismissable', async () => {
    const user = userEvent.setup();
    const bigYaml = 'x'.repeat(1_500_000);
    renderViewer({ yaml: bigYaml, resource: undefined });
    await user.click(screen.getByRole('button', { name: /dismiss large resource warning/i }));
    expect(screen.queryByText(/large resource/i)).not.toBeInTheDocument();
  });

  it('does not render banner when yaml is small', () => {
    renderViewer();
    expect(screen.queryByText(/large resource/i)).not.toBeInTheDocument();
  });
});
