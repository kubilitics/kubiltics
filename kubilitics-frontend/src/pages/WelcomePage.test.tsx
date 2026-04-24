import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { WelcomePage } from './WelcomePage';

function renderWelcome() {
  return render(
    <MemoryRouter>
      <WelcomePage />
    </MemoryRouter>,
  );
}

describe('WelcomePage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('renders one primary "Add a cluster" action (not three equal tiles)', () => {
    // The redesigned Welcome page has a single, visually dominant CTA — the
    // old three-equal-tile layout was the POC look we deliberately removed.
    renderWelcome();
    const primary = screen.getByTestId('welcome-primary-add-cluster');
    expect(primary).toBeInTheDocument();
    // There is only ONE button with the Add-a-cluster label on the page —
    // the sr-only fallback Button is aria-hidden so it doesn't count.
    const visibleAddButtons = screen.queryAllByRole('button', {
      name: /^add a cluster$/i,
    });
    expect(visibleAddButtons).toHaveLength(1);
  });

  it('opens the AddClusterDialog in place (no routing) when primary CTA is clicked', () => {
    renderWelcome();
    fireEvent.click(screen.getByTestId('welcome-primary-add-cluster'));
    // Dialog renders in-place; user stays on /welcome.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('surfaces deferred flows honestly as "soon" tiles, not disabled buttons', () => {
    // Previous contract: two disabled Buttons + tooltip. New contract:
    // informational tiles with explicit "soon" pills. The flows are named
    // so a returning operator can still find them, but they no longer look
    // like broken interactive elements.
    renderWelcome();
    expect(screen.getByText(/local cluster/i)).toBeInTheDocument();
    expect(screen.getByText(/guided tour/i)).toBeInTheDocument();

    // No disabled buttons anywhere on the page — deferred flows are not
    // pretending to be clickable.
    const disabled = screen
      .queryAllByRole('button')
      .filter((el) => el.hasAttribute('disabled'));
    expect(disabled).toHaveLength(0);
  });

  it('renders the fingerprint strip (backend URL + presence status)', () => {
    // The micro-telemetry line is the detail that distinguishes this from
    // a generic empty state. If it ever disappears, the page regresses to
    // "POC look" and we should fail loud.
    renderWelcome();
    const fingerprint = screen.getByLabelText(/system fingerprint/i);
    expect(fingerprint).toBeInTheDocument();
    // Backend host segment is present (tests run with the default store
    // URL, which at minimum emits "backend · something").
    expect(fingerprint.textContent ?? '').toMatch(/backend/i);
  });

  it('Cmd/Ctrl+N opens the AddClusterDialog', () => {
    // Keyboard shortcut is part of the hierarchy — it signals that this
    // is a tool, not a landing page. macOS UA string so the handler takes
    // the metaKey path.
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    renderWelcome();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
