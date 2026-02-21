/**
 * Tauri desktop detection and utilities
 */

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return !!(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

/**
 * TASK-FE-003: invokeWithRetry — wraps `invoke` with exponential-backoff retries.
 *
 * On cold start there is a race between the JS bundle finishing evaluation and
 * the Tauri command handler being registered. The first invoke() can throw
 * "Command X not found" even though it will succeed 200ms later. Retrying with
 * backoff eliminates this class of startup error without requiring arbitrary
 * fixed sleeps in every caller.
 *
 * @param cmd  — Tauri command name
 * @param args — optional arguments object
 * @param opts.maxAttempts — total tries (default 5)
 * @param opts.baseDelayMs — initial delay ms, doubles each attempt (default 200)
 */
export async function invokeWithRetry<T>(
  cmd: string,
  args?: Record<string, unknown>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const { maxAttempts = 5, baseDelayMs = 200 } = opts;
  const { invoke } = await import('@tauri-apps/api/core');

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      lastError = err;
      // Only retry on "command not found" / IPC initialisation errors.
      const msg = String(err).toLowerCase();
      const isStartupRace =
        msg.includes('not found') ||
        msg.includes('channel closed') ||
        msg.includes('invoke_key') ||
        msg.includes('ipc');
      if (!isStartupRace || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}
