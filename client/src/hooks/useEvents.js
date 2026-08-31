/**
 * useEvents — SSE client with automatic polling fallback.
 *
 * Connects to the server's SSE endpoint for real-time push.
 * If the SSE connection fails (e.g. Vercel serverless timeout),
 * falls back to the provided polling callback at a slower interval.
 *
 * Usage:
 *   useEvents('kitchen:abc123', () => loadOrders(), 10000);
 *   useEvents('pos:branch1', () => loadTabs(), 8000, { enabled: !!branchId });
 *
 * The `fallbackInterval` controls how often polling fires when SSE is
 * unavailable. When SSE IS connected, the callback only fires on events.
 */
import { useEffect, useRef, useCallback } from 'react';
import usePolling from './usePolling';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function useEvents(channel, callback, fallbackInterval = 10000, options = {}) {
  const { enabled = true } = options;

  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);

  const sseConnected = useRef(false);
  const esRef = useRef(null);

  // Always set up polling as a fallback — usePolling handles visibility
  // awareness, background throttling, and network recovery automatically.
  usePolling(callback, fallbackInterval, { enabled });

  const tryConnect = useCallback(() => {
    if (!enabled || !channel || sseConnected.current) return;

    try {
      const url = `${API_BASE}/events?channel=${encodeURIComponent(channel)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('connected', () => {
        sseConnected.current = true;
        // Immediate refresh on fresh connection
        callbackRef.current?.();
      });

      // Any domain event triggers a data refresh
      es.addEventListener('order:status', () => callbackRef.current?.());
      es.addEventListener('order:new', () => callbackRef.current?.());
      es.addEventListener('order:settled', () => callbackRef.current?.());
      es.addEventListener('tab:updated', () => callbackRef.current?.());
      es.addEventListener('tab:settled', () => callbackRef.current?.());
      es.addEventListener('tokens:changed', () => callbackRef.current?.());
      es.addEventListener('riders:changed', () => callbackRef.current?.());

      es.onerror = () => {
        // Connection failed or dropped — close and let polling handle it
        sseConnected.current = false;
        es.close();
        esRef.current = null;
      };
    } catch {
      // EventSource not available or URL construction failed — polling handles it
      sseConnected.current = false;
    }
  }, [channel, enabled, fallbackInterval]);

  useEffect(() => {
    if (!enabled) return;

    // Small delay to let polling start first; SSE is a bonus
    const timer = setTimeout(tryConnect, 1000);

    return () => {
      clearTimeout(timer);
      sseConnected.current = false;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [tryConnect, enabled]);
}
