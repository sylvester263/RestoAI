/**
 * EventBus — lightweight in-process pub/sub for real-time events.
 *
 * Route handlers call `emit(channel, payload)` after mutations.
 * SSE-connected clients receive the event instantly.
 *
 * On Vercel serverless the process is short-lived, so SSE connections
 * only work within a single invocation lifetime. The client-side
 * `useEvents` hook falls back to adaptive polling when SSE is
 * unavailable, so the system degrades gracefully.
 *
 * When running as a long-lived Node process (local dev, Docker, VM)
 * SSE connections stay open and events stream in real time.
 */

const listeners = new Map(); // channel → Set<res>

export function subscribe(channel, res) {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(res);

  // Send an initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ channel, time: Date.now() })}\n\n`);

  // Keep-alive ping every 15 s so proxies don't drop the connection
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
  }, 15000);

  // Clean up when the client disconnects
  res.on('close', () => {
    clearInterval(keepAlive);
    listeners.get(channel)?.delete(res);
    if (listeners.get(channel)?.size === 0) listeners.delete(channel);
  });
}

export function emit(channel, event, data) {
  const clients = listeners.get(channel);
  if (!clients || clients.size === 0) return 0;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const res of clients) {
    try { res.write(payload); sent++; } catch { /* dead connection */ }
  }
  return sent;
}

export function subscriberCount(channel) {
  return listeners.get(channel)?.size || 0;
}
