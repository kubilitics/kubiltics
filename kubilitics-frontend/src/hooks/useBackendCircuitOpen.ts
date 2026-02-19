/**
 * Reactive circuit-open state so queries can gate on it and re-enable when cooldown expires.
 * Polls every 2s so we detect when the circuit opens (after a failed request) and when it
 * closes (after BACKEND_DOWN_COOLDOWN_MS), avoiding request storms when backend is down.
 */
import { useState, useEffect } from 'react';
import { isBackendCircuitOpen } from '@/services/backendApiClient';

export function useBackendCircuitOpen(): boolean {
  const [open, setOpen] = useState(() => isBackendCircuitOpen());

  useEffect(() => {
    const interval = setInterval(() => {
      setOpen(isBackendCircuitOpen());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return open;
}
