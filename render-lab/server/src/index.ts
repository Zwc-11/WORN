import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { decartRoutes } from './routes/decart';
import { cleanRoutes } from './routes/clean';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: resolve(root, '.env') });

const port = Number(process.env.API_PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = new Hono();
app.route(
  '/api/decart',
  decartRoutes({ apiKey: process.env.DECART_API_KEY || undefined, allowedOrigins, maxSessionS: Number(process.env.DECART_MAX_SESSION_S ?? 900) }),
);
app.route('/api/clean', cleanRoutes({ apiKey: process.env.DECART_API_KEY || undefined, publicDir: resolve(root, 'web/public'), allowedOrigins }));
app.get('/api/health', (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port }, () => {
  console.log(`[api] http://localhost:${port}  decart key: ${process.env.DECART_API_KEY ? 'set' : 'MISSING (live try-on will fall back; add it to .env)'}`);
});
