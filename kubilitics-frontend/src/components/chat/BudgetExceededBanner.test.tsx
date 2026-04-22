import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { BudgetExceededBanner, isBudgetExceededError } from './BudgetExceededBanner';

describe('BudgetExceededBanner', () => {
  it('renders the alert with spend/cap context', () => {
    render(<BudgetExceededBanner spentUSD={4.2} capUSD={4.0} />);
    const banner = screen.getByTestId('budget-exceeded-banner');
    expect(banner).toHaveTextContent('Monthly AI budget reached');
    expect(banner).toHaveTextContent('$4.20 of $4.00 used');
  });

  it('renders without cost line when cap is missing', () => {
    render(<BudgetExceededBanner />);
    expect(screen.getByTestId('budget-exceeded-banner')).toBeInTheDocument();
  });

  it('fires onOpenSettings when the CTA is clicked', () => {
    const cb = vi.fn();
    render(<BudgetExceededBanner onOpenSettings={cb} />);
    fireEvent.click(screen.getByTestId('budget-exceeded-open-settings'));
    expect(cb).toHaveBeenCalledOnce();
  });

  it('isBudgetExceededError recognizes the wire code', () => {
    expect(isBudgetExceededError('budget_exceeded')).toBe(true);
    expect(isBudgetExceededError('router_error')).toBe(false);
    expect(isBudgetExceededError(undefined)).toBe(false);
  });
});
