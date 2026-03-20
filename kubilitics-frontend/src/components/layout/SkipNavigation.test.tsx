import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkipNavigation } from './SkipNavigation';

describe('SkipNavigation', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView — stub it to prevent
    // "scrollIntoView is not a function" uncaught exceptions.
    Element.prototype.scrollIntoView = vi.fn();

    // Create the #main-content target in the test DOM
    const main = document.createElement('main');
    main.id = 'main-content';
    main.tabIndex = -1;
    document.body.appendChild(main);

    return () => {
      document.body.removeChild(main);
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a skip-nav link', () => {
    render(<SkipNavigation />);
    const link = screen.getByTestId('skip-navigation');
    expect(link).toBeDefined();
    expect(link.textContent).toBe('Skip to main content');
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('is visually hidden by default (has -translate-y-full class)', () => {
    render(<SkipNavigation />);
    const link = screen.getByTestId('skip-navigation');
    expect(link.className).toContain('-translate-y-full');
  });

  it('becomes visible on focus (has focus:translate-y-0 class)', () => {
    render(<SkipNavigation />);
    const link = screen.getByTestId('skip-navigation');
    expect(link.className).toContain('focus:translate-y-0');
  });

  it('focuses #main-content on click', () => {
    render(<SkipNavigation />);
    const link = screen.getByTestId('skip-navigation');
    const main = document.getElementById('main-content')!;
    const focusSpy = vi.spyOn(main, 'focus');

    fireEvent.click(link);
    expect(focusSpy).toHaveBeenCalled();
  });

  it('has high-contrast styles for visibility', () => {
    render(<SkipNavigation />);
    const link = screen.getByTestId('skip-navigation');
    expect(link.className).toContain('bg-primary');
    expect(link.className).toContain('text-primary-foreground');
    expect(link.className).toContain('text-base');
    expect(link.className).toContain('font-semibold');
  });

  it('includes dark mode ring-offset override', () => {
    render(<SkipNavigation />);
    const link = screen.getByTestId('skip-navigation');
    expect(link.className).toContain('dark:ring-offset-background');
  });
});
