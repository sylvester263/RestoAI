/**
 * SSE (Server-Sent Events) endpoint for real-time push.
 *
 * GET /api/events?channel=kitchen:123
 * GET /api/events?channel=pos:123
 * GET /api/events?channel=riders
 *
 * The client connects via EventSource and receives events instantly.
 * Falls back to polling on Vercel serverless (short-lived connections).
 */
import { Router } from 'express';
import { subscribe } from '../services/event-bus.js';

const router = Router();

router.get('/', (req, res) => {
  const channel = req.query.channel;
  if (!channel) {
    return res.status(400).json({ error: 'channel query parameter is required' });
  }

  // SSE headers — disable caching and enable streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx proxy passthrough

  // Flush immediately — don't let express buffer
  res.flushHeaders();

  subscribe(channel, res);
});

export default router;
