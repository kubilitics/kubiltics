/**
 * Reactive circuit-open state so queries can gate on it and re-enable when cooldown expires.
 * Polls every 2s so we detect when the circuit opens (after a failed request) and when it
 * closes (after BACKEND_DOWN_COOLDOWN_MS), avoiding request storms when backend is down.
 */
import { useState, useEffect, useCallback } from 'react';
import { isBackendCircuitOpen, getBackendCircuitCloseTime, resetBackendCircuit } from '@/services/backendApiClient';

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

/**
 * Richer circuit state hook: exposes isOpen, remaining countdown seconds, and a reset function.
 */
export function useBackendCircuitState(clusterId?: string | null) {
  const [isOpen, setIsOpen] = useState(() => isBackendCircuitOpen(clusterId));
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    const tick = () => {
      const open = isBackendCircuitOpen(clusterId);
      setIsOpen(open);
      if (open) {
        const closeTime = getBackendCircuitCloseTime(clusterId);
        setRemainingSeconds(Math.max(0, Math.ceil((closeTime - Date.now()) / 1000)));
      } else {
        setRemainingSeconds(0);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [clusterId]);

  const resetAndRetry = useCallback(() => {
    resetBackendCircuit(clusterId);
    setIsOpen(false);
    setRemainingSeconds(0);
  }, [clusterId]);

  return { isOpen, remainingSeconds, resetAndRetry };
}
