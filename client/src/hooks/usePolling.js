/**
 * usePolling — visibility-aware adaptive polling hook.
 *
 * Replaces blind setInterval polling with smart behaviour:
 *  • Active tab  → polls at the requested `interval` (default 3 s)
 *  • Background tab → slows to `bgInterval` (default 30 s)
 *  • Window refocus / tab becoming visible → immediate refresh
 *  • Network recovery → immediate refresh
 *  • Cleans up automatically on unmount
 *
 * Usage:
 *   usePolling(() => loadOrders(), 3000);
 *   usePolling(loadOrders, 3000, { bgInterval: 30000, enabled: !!branchId });
 */
import { useEffect, useRef, useCallback } from 'react';

export default function usePolling(callback, interval = 3000, options = {}) {
  const { bgInterval = 30000, enabled = true } = options;

  const callbackRef = useRef(callback);
  const timerRef = useRef(null);
  const activeInterval = interval;

  // Keep callback ref fresh without re-starting the timer
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const tick = useCallback(() => {
    callbackRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function getInterval() {
      return document.hidden ? bgInterval : activeInterval;
    }

    function start() {
      stop();
      timerRef.current = setInterval(tick, getInterval());
    }

    function stop() {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    function handleVisibility() {
      // Immediately refresh when tab becomes visible, then restart timer
      // at the active rate.
      if (!document.hidden) {
        tick();
      }
      start();
    }

    function handleOnline() {
      // Network came back — refresh immediately
      tick();
      start();
    }

    // Initial fetch
    tick();
    start();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [enabled, activeInterval, bgInterval, tick]);
}
