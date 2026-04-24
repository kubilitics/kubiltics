/**
 * Phase 6 task 6.2: /connect is deprecated. When FEATURE_PRESENCE_V2 is ON,
 * the legacy ClusterConnect page must render a dismissible banner at the
 * top that points users at the new /clusters picker. When the flag is OFF
 * (rollback), the banner must not render.
 *
 * We test the banner component directly to avoid pulling the entire
 * ClusterConnect render tree (which lazy-loads dozens of hooks & backend
 * adapters). The banner is exported from ClusterConnect.tsx solely for
 * this purpose.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import * as featureFlags from '@/lib/featureFlags';
import { ConnectDeprecationBanner } from './ClusterConnect';

function renderBanner() {
  return render(
    <MemoryRouter>
      <ConnectDeprecationBanner />
    </MemoryRouter>,
  );
}

describe('ConnectDeprecationBanner — Phase 6 task 6.2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when FEATURE_PRESENCE_V2 is OFF (rollback scenario)', () => {
    vi.spyOn(featureFlags, 'featurePresenceV2').mockReturnValue(false);
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders deprecation copy + "Go to clusters" CTA when the flag is ON', () => {
    vi.spyOn(featureFlags, 'featurePresenceV2').mockReturnValue(true);
    renderBanner();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/deprecated/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /go to clusters/i });
    expect(cta).toHaveAttribute('href', '/clusters');
  });

  it('can be dismissed; dismissing removes the banner from the DOM', async () => {
    vi.spyOn(featureFlags, 'featurePresenceV2').mockReturnValue(true);
    renderBanner();
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    await act(async () => {
      await userEvent.click(dismiss);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
