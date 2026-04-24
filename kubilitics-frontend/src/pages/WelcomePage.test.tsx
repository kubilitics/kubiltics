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

  it('renders the three primary CTAs', () => {
    renderWelcome();
    expect(
      screen.getByRole('button', { name: /create a local cluster/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add an existing cluster/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /take the tour/i }),
    ).toBeInTheDocument();
  });

  it('clicking "Add an existing cluster" opens the AddClusterDialog (no routing)', () => {
    renderWelcome();
    fireEvent.click(
      screen.getByRole('button', { name: /add an existing cluster/i }),
    );
    // Dialog opens in-place; user stays on /welcome.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add a cluster')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('"Create a local cluster" is disabled (route not available yet)', () => {
    renderWelcome();
    const btn = screen.getByRole('button', { name: /create a local cluster/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('"Take the tour" is disabled (demo mode coming later)', () => {
    renderWelcome();
    const btn = screen.getByRole('button', { name: /take the tour/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
