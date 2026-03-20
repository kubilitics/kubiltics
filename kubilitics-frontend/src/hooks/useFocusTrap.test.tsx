import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRef, useState } from 'react';
import { useFocusTrap } from './useFocusTrap';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function TrapHarness({
  onClose,
  enabled = true,
  autoFocus = true,
}: {
  onClose?: () => void;
  enabled?: boolean;
  autoFocus?: boolean;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({ enabled, onClose, autoFocus });

  return (
    <div ref={trapRef} data-testid="trap-container" tabIndex={-1}>
      <button data-testid="btn-first">First</button>
      <button data-testid="btn-second">Second</button>
      <button data-testid="btn-third">Third</button>
    </div>
  );
}

function EmptyTrapHarness({ onClose }: { onClose?: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>({ onClose });
  return (
    <div ref={trapRef} data-testid="empty-trap" tabIndex={-1}>
      <span>No focusable elements here</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFocusTrap', () => {
  afterEach(() => {
    cleanup();
  });

  it('wraps Tab from last element to first', async () => {
    render(<TrapHarness />);
    const third = screen.getByTestId('btn-third');
    third.focus();
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(screen.getByTestId('trap-container'), {
      key: 'Tab',
      shiftKey: false,
    });

    expect(document.activeElement).toBe(screen.getByTestId('btn-first'));
  });

  it('wraps Shift+Tab from first element to last', () => {
    render(<TrapHarness />);
    const first = screen.getByTestId('btn-first');
    first.focus();

    fireEvent.keyDown(screen.getByTestId('trap-container'), {
      key: 'Tab',
      shiftKey: true,
    });

    expect(document.activeElement).toBe(screen.getByTestId('btn-third'));
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<TrapHarness onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId('trap-container'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not trap focus when enabled=false', () => {
    const onClose = vi.fn();
    render(<TrapHarness enabled={false} onClose={onClose} />);

    const third = screen.getByTestId('btn-third');
    third.focus();

    // Tab should not be intercepted — no wrapping occurs
    fireEvent.keyDown(screen.getByTestId('trap-container'), {
      key: 'Tab',
      shiftKey: false,
    });

    // Focus remains on third (no wrapping happened because listener isn't attached)
    expect(document.activeElement).toBe(third);
    // Escape should not fire either
    fireEvent.keyDown(screen.getByTestId('trap-container'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('prevents Tab when there are no focusable children', () => {
    render(<EmptyTrapHarness />);
    const container = screen.getByTestId('empty-trap');
    container.focus();

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault');
    container.dispatchEvent(tabEvent);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('does not wrap Tab when focus is on a middle element', () => {
    render(<TrapHarness />);
    const second = screen.getByTestId('btn-second');
    second.focus();

    fireEvent.keyDown(screen.getByTestId('trap-container'), {
      key: 'Tab',
      shiftKey: false,
    });

    // Focus stays on second because the browser would naturally move it — we
    // only intercept at boundaries.
    expect(document.activeElement).toBe(second);
  });
});
