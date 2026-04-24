import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClusterUnreachableBoundary } from './ClusterUnreachableBoundary';

describe('ClusterUnreachableBoundary', () => {
  it('renders children plainly when reachable', () => {
    render(
      <ClusterUnreachableBoundary
        isReachable
        isStale={false}
        errorMessage={null}
        onSwitchCluster={() => {}}
        onRetry={() => {}}
      >
        <p>body</p>
      </ClusterUnreachableBoundary>,
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders banner when unreachable', () => {
    render(
      <ClusterUnreachableBoundary
        isReachable={false}
        isStale
        errorMessage="connection refused"
        onSwitchCluster={() => {}}
        onRetry={() => {}}
      >
        <p>body</p>
      </ClusterUnreachableBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();
    // Children still render so "last known" data stays visible.
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('retry button calls onRetry', () => {
    const retry = vi.fn();
    render(
      <ClusterUnreachableBoundary
        isReachable={false}
        isStale
        errorMessage="x"
        onSwitchCluster={() => {}}
        onRetry={retry}
      >
        <p>body</p>
      </ClusterUnreachableBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('switch cluster button calls onSwitchCluster', () => {
    const sw = vi.fn();
    render(
      <ClusterUnreachableBoundary
        isReachable={false}
        isStale
        errorMessage="x"
        onSwitchCluster={sw}
        onRetry={() => {}}
      >
        <p>body</p>
      </ClusterUnreachableBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /switch/i }));
    expect(sw).toHaveBeenCalledOnce();
  });
});
