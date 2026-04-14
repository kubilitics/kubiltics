import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CopyAsDescribeButton } from './CopyAsDescribeButton';
import type { Diagnosis } from '@/lib/diagnose/types';

// Mock the toast import
vi.mock('@/components/ui/sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from '@/components/ui/sonner';

function makeDiagnosis(): Diagnosis {
  return {
    severity: 'broken',
    headline: 'Container keeps crashing',
    oneLine: 'busybox exited with code 128',
    reasons: [],
    containers: [],
    conditions: [],
    recentWarnings: [],
    computedAt: 0,
    kind: 'Pod',
    namespace: 'default',
    name: 'test-pod',
  };
}

const resource = {
  metadata: { name: 'test-pod', namespace: 'default' },
};

describe('CopyAsDescribeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with initial label', () => {
    render(<CopyAsDescribeButton diagnosis={makeDiagnosis()} resource={resource} />);
    expect(screen.getByRole('button', { name: /Copy diagnosis to clipboard/i })).toBeInTheDocument();
    expect(screen.getByText('Copy as describe')).toBeInTheDocument();
  });

  it('copies the describe text to the clipboard when clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyAsDescribeButton diagnosis={makeDiagnosis()} resource={resource} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    const passedText = writeText.mock.calls[0][0] as string;
    expect(passedText).toContain('Kubilitics Diagnose');
    expect(passedText).toContain('test-pod');
    expect(passedText).toContain('BROKEN');

    expect(toast.success).toHaveBeenCalledWith('Diagnosis copied to clipboard');
  });

  it('shows "Copied" state briefly after a successful copy', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<CopyAsDescribeButton diagnosis={makeDiagnosis()} resource={resource} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
  });

  it('shows error toast if clipboard fails', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    // Also disable execCommand so the legacy fallback doesn't "succeed"
    const originalExec = document.execCommand;
    document.execCommand = vi.fn(() => false);

    render(<CopyAsDescribeButton diagnosis={makeDiagnosis()} resource={resource} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to copy diagnosis');
    });

    document.execCommand = originalExec;
  });
});
