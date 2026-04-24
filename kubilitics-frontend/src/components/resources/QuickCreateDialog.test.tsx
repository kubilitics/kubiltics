import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QuickCreateDialog, type QuickCreateResourceKind } from './QuickCreateDialog';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock hooks and stores that the dialog depends on
vi.mock('@/hooks/useKubernetes', () => ({
  useCreateK8sResource: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      backendBaseUrl: '',
      isBackendConfigured: () => false,
      currentClusterId: null,
    }),
  getEffectiveBackendBaseUrl: (url: string) => url || '',
}));
vi.mock('@/stores/clusterPresenceStore', () => ({
  useActiveCluster: () => null,
  getActiveCluster: () => null,
  useClusterPresenceStore: () => ({
    discovered: [],
    registered: [],
    connected: [],
    availableClusters: () => [],
  }),
  setActiveClusterBySessionId: vi.fn(),
  __resetForTest: vi.fn(),
}));
vi.mock('@/services/backendApiClient', () => ({
  applyManifest: vi.fn(),
}));
vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderDialog(kind: QuickCreateResourceKind) {
  return render(
    <QuickCreateDialog open onOpenChange={vi.fn()} kind={kind} />,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QuickCreateDialog', () => {
  describe.each<QuickCreateResourceKind>([
    'Pod',
    'Deployment',
    'Service',
    'ConfigMap',
    'Namespace',
  ])('renders form for %s', (kind) => {
    it(`shows "Create ${kind}" title`, () => {
      renderDialog(kind);
      expect(screen.getByRole('heading', { name: `Create ${kind}` })).toBeInTheDocument();
    });

    it(`shows ${kind} Name input`, () => {
      renderDialog(kind);
      expect(screen.getByLabelText(new RegExp(`${kind}\\s+Name`, 'i'))).toBeInTheDocument();
    });
  });

  it('shows container image field for Pod', () => {
    renderDialog('Pod');
    expect(screen.getByLabelText(/container image/i)).toBeInTheDocument();
  });

  it('shows replicas field for Deployment', () => {
    renderDialog('Deployment');
    expect(screen.getByLabelText(/replicas/i)).toBeInTheDocument();
  });

  it('shows service type selector for Service', () => {
    renderDialog('Service');
    expect(screen.getByText('Service Type')).toBeInTheDocument();
  });

  it('shows data entries section for ConfigMap', () => {
    renderDialog('ConfigMap');
    expect(screen.getByText('Data Entries')).toBeInTheDocument();
  });

  describe('YAML mode toggle', () => {
    it('switches to YAML mode and back', async () => {
      const user = userEvent.setup();
      renderDialog('Pod');

      // Initially in form mode — Form button should be highlighted
      expect(screen.getByText('Form')).toBeInTheDocument();

      // Find the YAML toggle button (not the heading/other elements)
      const yamlToggle = screen.getByRole('button', { name: /YAML/i });
      expect(yamlToggle).toBeInTheDocument();

      // Switch to YAML mode
      await user.click(yamlToggle);
      expect(screen.getByText('Edit YAML')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/enter yaml/i)).toBeInTheDocument();

      // Switch back to Form mode
      await user.click(screen.getByRole('button', { name: /Form/i }));
      // Should show the pod name field again
      expect(screen.getByLabelText(/pod name/i)).toBeInTheDocument();
    });
  });

  describe('YAML generation', () => {
    it('generates YAML containing apiVersion and kind for Pod', async () => {
      const user = userEvent.setup();
      renderDialog('Pod');

      // Fill in required fields
      await user.type(screen.getByLabelText(/pod name/i), 'test-pod');
      await user.type(screen.getByLabelText(/container image/i), 'nginx:latest');

      // Switch to YAML to see generated output
      await user.click(screen.getByRole('button', { name: /YAML/i }));

      const textarea = screen.getByPlaceholderText(/enter yaml/i) as HTMLTextAreaElement;
      expect(textarea.value).toContain('apiVersion: v1');
      expect(textarea.value).toContain('kind: Pod');
      expect(textarea.value).toContain('name: test-pod');
      expect(textarea.value).toContain('image: nginx:latest');
    });
  });

  describe('YAML validation', () => {
    it('catches missing required fields in YAML mode', async () => {
      const user = userEvent.setup();
      renderDialog('Pod');

      // Switch to YAML mode
      await user.click(screen.getByRole('button', { name: /YAML/i }));

      // Clear the textarea and type invalid YAML
      const textarea = screen.getByPlaceholderText(/enter yaml/i);
      await user.clear(textarea);
      await user.type(textarea, 'foo: bar');

      // Should show validation errors
      expect(screen.getByText(/Missing required field: apiVersion/)).toBeInTheDocument();
      expect(screen.getByText(/Missing required field: kind/)).toBeInTheDocument();
    });

    it('shows empty YAML error', async () => {
      const user = userEvent.setup();
      renderDialog('Pod');

      await user.click(screen.getByRole('button', { name: /YAML/i }));

      const textarea = screen.getByPlaceholderText(/enter yaml/i);
      await user.clear(textarea);

      // The Create button should be disabled when YAML is invalid
      const createBtn = screen.getByRole('button', { name: /create pod/i });
      expect(createBtn).toBeDisabled();
    });
  });
});
