import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { AddClusterDialog } from './AddClusterDialog';

// Mock the backend call — we only want to verify the dialog forwards the
// right kubeconfig + context to it.
vi.mock('@/services/backendApiClient', () => ({
  addClusterWithUpload: vi.fn(async () => ({
    id: 'uuid-test',
    name: 'test-cluster',
    status: 'connected',
  })),
}));

// Mock the toast so it doesn't try to mount a portal in jsdom.
vi.mock('@/components/ui/sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { addClusterWithUpload } from '@/services/backendApiClient';
const addClusterWithUploadMock = vi.mocked(addClusterWithUpload);

describe('AddClusterDialog', () => {
  beforeEach(() => {
    addClusterWithUploadMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders nothing when open=false', () => {
    render(<AddClusterDialog open={false} onClose={() => {}} />);
    // Dialog primitives don't render their content when closed.
    expect(screen.queryByText('Add a cluster')).not.toBeInTheDocument();
  });

  it('renders tabs when open', () => {
    render(<AddClusterDialog open={true} onClose={() => {}} />);
    expect(screen.getByText('Add a cluster')).toBeInTheDocument();
    // Both tab triggers present (role=tab is provided by Radix).
    expect(screen.getByRole('tab', { name: /upload/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /paste/i })).toBeInTheDocument();
  });

  it('submits pasted kubeconfig and calls onAdded', async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(<AddClusterDialog open={true} onClose={onClose} onAdded={onAdded} />);

    // Switch to paste tab
    await user.click(screen.getByRole('tab', { name: /paste/i }));

    const textarea = await screen.findByTestId('add-cluster-paste-area');
    const singleContext =
      'apiVersion: v1\nkind: Config\ncurrent-context: only\ncontexts:\n- name: only\n  context:\n    cluster: c\n    user: u\nclusters: []\nusers: []\n';
    // userEvent.type is slow for large strings — paste directly.
    await user.click(textarea);
    await user.paste(singleContext);

    await user.click(screen.getByTestId('add-cluster-paste-submit'));

    await waitFor(() => {
      expect(addClusterWithUploadMock).toHaveBeenCalledTimes(1);
    });
    const [, base64, contextName] = addClusterWithUploadMock.mock.calls[0];
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
    expect(contextName).toBe('only');
    expect(onAdded).toHaveBeenCalledWith('only');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without submitting when Cancel is clicked on paste tab', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AddClusterDialog open={true} onClose={onClose} />);
    await user.click(screen.getByRole('tab', { name: /paste/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(addClusterWithUploadMock).not.toHaveBeenCalled();
  });
});
