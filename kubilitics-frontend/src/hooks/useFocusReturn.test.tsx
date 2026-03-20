import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { useFocusReturn } from './useFocusReturn';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function Harness() {
  const [isOpen, setIsOpen] = useState(false);
  useFocusReturn({ isOpen });

  return (
    <div>
      <button data-testid="trigger" onClick={() => setIsOpen(true)}>
        Open
      </button>
      {isOpen && (
        <div data-testid="dialog" role="dialog">
          <p>Dialog content</p>
          <button data-testid="close-btn" onClick={() => setIsOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFocusReturn', () => {
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRAF() {
    rafCallbacks.forEach((cb) => cb(performance.now()));
    rafCallbacks = [];
  }

  it('restores focus to the trigger after the dialog closes', () => {
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');

    // Focus the trigger, then open the dialog
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger); // opens dialog
    expect(screen.getByTestId('dialog')).toBeDefined();

    // Close the dialog
    fireEvent.click(screen.getByTestId('close-btn'));

    // Flush rAF so the focus restore runs
    flushRAF();

    expect(document.activeElement).toBe(trigger);
  });

  it('does not throw when the previously focused element is removed from the DOM', () => {
    // Create a detached element scenario
    const detached = document.createElement('button');
    // Not in the DOM — isConnected will be false
    Object.defineProperty(detached, 'isConnected', { value: false });

    function DetachedHarness() {
      const [isOpen, setIsOpen] = useState(false);
      useFocusReturn({ isOpen });
      return (
        <div>
          <button data-testid="open" onClick={() => { (detached as any).focus?.(); setIsOpen(true); }}>Open</button>
          {isOpen && <button data-testid="close" onClick={() => setIsOpen(false)}>Close</button>}
        </div>
      );
    }

    render(<DetachedHarness />);
    fireEvent.click(screen.getByTestId('open'));
    fireEvent.click(screen.getByTestId('close'));

    // Should not throw
    expect(() => flushRAF()).not.toThrow();
  });
});
