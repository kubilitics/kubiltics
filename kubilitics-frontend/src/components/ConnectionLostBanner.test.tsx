import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Mocks — must be declared before importing the component ────────────────

const mockConnectionStatus = { isConnected: true };
const mockOfflineMode = { isOffline: false };

vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => mockConnectionStatus,
}));

vi.mock('@/hooks/useOfflineMode', () => ({
  useOfflineMode: () => mockOfflineMode,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { ConnectionLostBanner } from './ConnectionLostBanner';

// ── Tests ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ConnectionLostBanner', () => {
  beforeEach(() => {
    // Reset to default connected state
    mockConnectionStatus.isConnected = true;
    mockOfflineMode.isOffline = false;
  });

  it('shows nothing when connected', () => {
    mockConnectionStatus.isConnected = true;
    const { container } = render(<ConnectionLostBanner />);
    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
  });

  it('shows nothing on first load before ever being connected', () => {
    // Never connected — wasConnected is false
    mockConnectionStatus.isConnected = false;
    const { container } = render(<ConnectionLostBanner />);
    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
  });

  it('shows banner when disconnected after being connected', () => {
    // First render: connected
    mockConnectionStatus.isConnected = true;
    const { rerender } = render(<ConnectionLostBanner />);

    // Second render: disconnected
    mockConnectionStatus.isConnected = false;
    rerender(<ConnectionLostBanner />);

    expect(screen.getByText('Cluster connection lost.')).toBeInTheDocument();
    expect(screen.getByText('Showing cached data.')).toBeInTheDocument();
  });

  it('shows reconnect button when disconnected', () => {
    mockConnectionStatus.isConnected = true;
    const { rerender } = render(<ConnectionLostBanner />);

    mockConnectionStatus.isConnected = false;
    rerender(<ConnectionLostBanner />);

    expect(screen.getByText('Reconnect')).toBeInTheDocument();
  });

  it('shows "last connected" time when disconnected', () => {
    mockConnectionStatus.isConnected = true;
    const { rerender } = render(<ConnectionLostBanner />);

    mockConnectionStatus.isConnected = false;
    rerender(<ConnectionLostBanner />);

    // The elapsed timer starts immediately — after the first tick it shows "0s ago" or "1s ago"
    expect(screen.getByText(/Last connected/)).toBeInTheDocument();
  });

  it('shows "Switch cluster" link', () => {
    mockConnectionStatus.isConnected = true;
    const { rerender } = render(<ConnectionLostBanner />);

    mockConnectionStatus.isConnected = false;
    rerender(<ConnectionLostBanner />);

    const link = screen.getByText('Switch cluster');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/clusters');
  });
});
