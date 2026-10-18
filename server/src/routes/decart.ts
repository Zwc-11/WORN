// Decart client-token route. The browser asks here before every realtime connect/reconnect/upload;
// the permanent DECART_API_KEY stays on this server. B's Hono server can mount this as-is:
//   app.route('/api/decart', decartRoutes({ apiKey: process.env.DECART_API_KEY, ... }))
import { Hono, type Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createDecartClient, type CreateTokenOptions, type CreateTokenResponse } from '@decartai/sdk';

export interface DecartRouteDeps {
  apiKey?: string;
  /** Origins allowed to request tokens. Requests without an Origin header (curl, server-side) are allowed. */
  allowedOrigins: string[];
  /** Hard cap on one realtime session, seconds (billing guard). */
  maxSessionS: number;
  /** Injected in tests; defaults to the real SDK. */
  mint?: (opts: CreateTokenOptions) => Promise<CreateTokenResponse>;
  /** Max tokens per client IP per minute (one start = 1 token + 1 per uncached upload). */
  ratePerMin?: number;
  /** Injected in tests; defaults to client.files.upload with the permanent key. */
  upload?: (file: Blob) => Promise<{ id: string }>;
}

function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (fwd) return fwd;
  try {
    return getConnInfo(c).remote.address ?? 'local';
  } catch {
    return 'local'; // app.request() in tests has no socket
  }
}

export function decartRoutes(deps: DecartRouteDeps) {
  const app = new Hono();
  const mint =
    deps.mint ??
    (deps.apiKey ? ((client) => (o: CreateTokenOptions) => client.tokens.create(o))(createDecartClient({ apiKey: deps.apiKey })) : undefined);
  const upload =
    deps.upload ??
    (deps.apiKey ? ((client) => (b: Blob) => client.files.upload(b, { ttlSeconds: 6 * 3600 }))(createDecartClient({ apiKey: deps.apiKey })) : undefined);
  const hits = new Map<string, number[]>();
  const limit = deps.ratePerMin ?? 60;

  app.get('/health', (c) => c.json({ configured: Boolean(mint), maxSessionS: deps.maxSessionS }));

  // Reference images are uploaded here with the permanent key, so a realtime set() can send a short
  // "file_..." id instead of megabytes of base64. (SDK 0.2.11 does not send client tokens on HTTP uploads.)
  app.post('/upload', async (c) => {
    const origin = c.req.header('origin');
    if (origin && deps.allowedOrigins.length > 0 && !deps.allowedOrigins.includes(origin))
      return c.json({ error: { code: 'ORIGIN', message: `origin ${origin} not allowed` } }, 403);
    if (!upload) return c.json({ error: { code: 'NO_KEY', message: 'Server has no DECART_API_KEY.' } }, 503);
    const type = c.req.header('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return c.json({ error: { code: 'BAD_TYPE', message: `send raw image bytes with an image content-type (got ${type})` } }, 415);
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 12 * 1024 * 1024) return c.json({ error: { code: 'BAD_SIZE', message: 'image must be 1 byte to 12 MB' } }, 413);
    try {
      const f = await upload(new Blob([buf], { type }));
      return c.json({ id: f.id });
    } catch (e) {
      return c.json({ error: { code: (e as { code?: string })?.code ?? 'UPLOAD_FAILED', message: (e as { message?: string })?.message ?? String(e) } }, 502);
    }
  });

  app.post('/token', async (c) => {
    const origin = c.req.header('origin');
    if (origin && deps.allowedOrigins.length > 0 && !deps.allowedOrigins.includes(origin))
      return c.json({ error: { code: 'ORIGIN', message: `origin ${origin} not in ALLOWED_ORIGINS` } }, 403);
    if (!mint) return c.json({ error: { code: 'NO_KEY', message: 'Server has no DECART_API_KEY. Add it to .env at the repo root and restart.' } }, 503);

    const who = clientIp(c);
    const now = Date.now();
    const recent = (hits.get(who) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= limit) return c.json({ error: { code: 'RATE', message: 'too many token requests' } }, 429);
    recent.push(now);
    hits.set(who, recent);

    try {
      // 120 s covers an upload or a dial; a live session keeps running after its token expires.
      const t = await mint({ expiresIn: 120, constraints: { realtime: { maxSessionDuration: deps.maxSessionS } }, metadata: { app: 'worn' } });
      c.header('Cache-Control', 'no-store');
      return c.json({ apiKey: t.apiKey, expiresAt: t.expiresAt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      const code = (e as { code?: string })?.code ?? 'MINT_FAILED';
      return c.json({ error: { code, message: `token mint failed: ${msg}` } }, 502);
    }
  });

  return app;
}
