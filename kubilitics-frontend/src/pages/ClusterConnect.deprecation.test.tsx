/**
 * Phase 7: /connect is on its way out (Task 7.4). Until the route is removed,
 * the deprecation banner always renders (FEATURE_PRESENCE_V2 flag deleted in
 * Task 7.5) so legacy-bookmark users are steered to /clusters.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ConnectDeprecationBanner } from './ClusterConnect';

function renderBanner() {
  return render(
    <MemoryRouter>
      <ConnectDeprecationBanner />
    </MemoryRouter>,
  );
}

describe('ConnectDeprecationBanner — Phase 7 unconditional', () => {
  it('renders deprecation copy + "Go to clusters" CTA', () => {
    renderBanner();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/deprecated/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /go to clusters/i });
    expect(cta).toHaveAttribute('href', '/clusters');
  });

  it('can be dismissed; dismissing removes the banner from the DOM', async () => {
    renderBanner();
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    await act(async () => {
      await userEvent.click(dismiss);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
