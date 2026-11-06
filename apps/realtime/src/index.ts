import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import Redis from 'ioredis';
import pino from 'pino';
import { Server } from 'socket.io';
import type { Health } from '@gitcity/shared';

config({ path: resolve(__dirname, '../../../.env') });

const log = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });
const port = Number(process.env.REALTIME_PORT ?? 4001);
const frontend = process.env.FRONTEND_URL;
const redisUrl = process.env.REDIS_URL;
if (!frontend) throw new Error('FRONTEND_URL is required (see .env.example)');

// Redis is optional in development (single instance); required for multi-instance scaling.
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 1, retryStrategy: (n) => Math.min(n * 500, 5000) }) : null;
redis?.on('error', () => undefined);
if (!redis) log.warn('REDIS_URL not set: running without Redis (dev only)');

const http = createServer(async (req, res) => {
  if (req.url === '/health') {
    let redisUp = false;
    try {
      redisUp = redis ? (await redis.ping()) === 'PONG' : false;
    } catch {
      /* down */
    }
    const ok = !redis || redisUp;
    const body: Health = {
      status: ok ? 'ok' : 'degraded',
      service: 'realtime',
      uptime: process.uptime(),
      checks: { redis: !redis ? 'skipped' : redisUp ? 'up' : 'down' },
    };
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404).end();
});

// Phase 6 will add socket authentication (session cookie), world rooms and the Redis adapter.
const io = new Server(http, { cors: { origin: frontend, credentials: true } });
io.on('connection', (socket) => {
  log.debug({ id: socket.id }, 'socket connected (unauthenticated placeholder until Phase 6)');
  socket.disconnect(true);
});

http.listen(port, () => log.info(`realtime listening on :${port}`));
