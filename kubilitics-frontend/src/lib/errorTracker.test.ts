/**
 * Tests for ErrorTrackerService (errorTracker.ts).
 *
 * Because ErrorTrackerService is a singleton exported as `ErrorTracker`,
 * we import a fresh instance for each test by resetting the module.
 * We mock `uuid` to produce deterministic IDs and suppress console output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks ─────────────────────────────────────────────────────────────────── */

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// Suppress console noise from captureException / captureMessage
const consoleSpy = {
  group: vi.spyOn(console, 'group').mockImplementation(() => {}),
  groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  info: vi.spyOn(console, 'info').mockImplementation(() => {}),
  table: vi.spyOn(console, 'table').mockImplementation(() => {}),
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */

/**
 * Because ErrorTracker is a singleton, we need to reset the module between tests.
 * This function returns a fresh copy of the singleton by clearing the module cache.
 */
async function freshTracker() {
  vi.resetModules();
  uuidCounter = 0;
  const mod = await import('./errorTracker');
  return mod.ErrorTracker;
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe('ErrorTrackerService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Re-apply console suppression for next test
    consoleSpy.group = vi.spyOn(console, 'group').mockImplementation(() => {});
    consoleSpy.groupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    consoleSpy.error = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleSpy.warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleSpy.info = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleSpy.table = vi.spyOn(console, 'table').mockImplementation(() => {});
  });

  it('init() does not throw', async () => {
    const tracker = await freshTracker();
    expect(() => tracker.init()).not.toThrow();
  });

  it('init() can be called twice without error (idempotent)', async () => {
    const tracker = await freshTracker();
    tracker.init();
    expect(() => tracker.init()).not.toThrow();
  });

  it('captureException adds an entry and returns a unique ID', async () => {
    const tracker = await freshTracker();
    const id = tracker.captureException(new Error('test error'));

    expect(id).toBe('test-uuid-1');

    const errors = tracker.getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe('test-uuid-1');
    expect(errors[0].level).toBe('error');
    expect((errors[0].error as any).message).toBe('test error');
  });

  it('captureException handles non-Error values', async () => {
    const tracker = await freshTracker();
    tracker.captureException('string error');

    const errors = tracker.getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe('string error');
  });

  it('captureMessage stores info-level entries', async () => {
    const tracker = await freshTracker();
    const id = tracker.captureMessage('diagnostics note', 'info');

    expect(id).toBeTruthy();
    const errors = tracker.getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].level).toBe('info');
  });

  it('getRecentErrors returns a shallow copy (not a reference)', async () => {
    const tracker = await freshTracker();
    tracker.captureException(new Error('a'));

    const copy1 = tracker.getRecentErrors();
    const copy2 = tracker.getRecentErrors();
    expect(copy1).not.toBe(copy2);
    expect(copy1).toEqual(copy2);
  });

  it('ring buffer caps at 50 entries, evicting oldest', async () => {
    const tracker = await freshTracker();

    for (let i = 0; i < 60; i++) {
      tracker.captureException(new Error(`error-${i}`));
    }

    const errors = tracker.getRecentErrors();
    expect(errors).toHaveLength(50);
    // The oldest entry should be error-10 (0..9 were evicted)
    expect((errors[0].error as any).message).toBe('error-10');
    // The newest should be error-59
    expect((errors[49].error as any).message).toBe('error-59');
  });

  it('merges context tags from setTag and captureException', async () => {
    const tracker = await freshTracker();
    tracker.setTag('env', 'test');
    tracker.captureException(new Error('tagged'), { tags: { page: 'dashboard' } });

    const entry = tracker.getRecentErrors()[0];
    expect(entry.context.tags).toEqual({ env: 'test', page: 'dashboard' });
  });

  it('setUser persists user context across captures', async () => {
    const tracker = await freshTracker();
    tracker.setUser({ id: 'u1', username: 'admin' });
    tracker.captureException(new Error('with user'));

    const entry = tracker.getRecentErrors()[0];
    expect(entry.context.user?.id).toBe('u1');
    expect(entry.context.user?.username).toBe('admin');
  });

  it('setExtra persists extra context data', async () => {
    const tracker = await freshTracker();
    tracker.setExtra('route', '/pods');
    tracker.captureException(new Error('extra'));

    const entry = tracker.getRecentErrors()[0];
    expect(entry.context.extra?.route).toBe('/pods');
  });
});
