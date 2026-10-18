import { describe, expect, it, vi } from 'vitest';
import { decartRoutes } from './decart';

const ok = vi.fn(async () => ({ apiKey: 'ek_test', expiresAt: '2026-10-17T23:00:00Z' }));
const base = { allowedOrigins: ['http://localhost:5173'], maxSessionS: 900 };
const post = (app: ReturnType<typeof decartRoutes>, headers: Record<string, string> = {}) => app.request('/token', { method: 'POST', headers });

describe('POST /token', () => {
  it('returns a client token and never the permanent key', async () => {
    const app = decartRoutes({ ...base, apiKey: 'PERMANENT', mint: ok });
    const res = await post(app, { origin: 'http://localhost:5173' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ apiKey: 'ek_test', expiresAt: '2026-10-17T23:00:00Z' });
    expect(JSON.stringify(body)).not.toContain('PERMANENT');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('caps session length and token lifetime', async () => {
    const mint = vi.fn(ok);
    await post(decartRoutes({ ...base, maxSessionS: 300, mint }));
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ expiresIn: 120, constraints: { realtime: { maxSessionDuration: 300 } } }));
  });

  it('503 NO_KEY when the server has no key', async () => {
    const res = await post(decartRoutes(base));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('NO_KEY');
  });

  it('403 for an origin not on the list', async () => {
    const res = await post(decartRoutes({ ...base, mint: ok }), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('502 with the reason when minting fails', async () => {
    const res = await post(decartRoutes({ ...base, mint: async () => Promise.reject(Object.assign(new Error('bad key'), { code: 'INVALID_API_KEY' })) }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: 'INVALID_API_KEY' });
  });

  it('rate limits per client', async () => {
    const app = decartRoutes({ ...base, mint: ok, ratePerMin: 2 });
    expect((await post(app)).status).toBe(200);
    expect((await post(app)).status).toBe(200);
    expect((await post(app)).status).toBe(429);
  });

  it('GET /health reports whether a key is configured', async () => {
    expect(await (await decartRoutes(base).request('/health')).json()).toMatchObject({ configured: false });
    expect(await (await decartRoutes({ ...base, mint: ok }).request('/health')).json()).toMatchObject({ configured: true });
  });
});

describe('POST /upload', () => {
  it('uploads with the server key and returns only the file id', async () => {
    const upload = vi.fn(async (b: Blob) => ({ id: `file_${b.size}` }));
    const app = decartRoutes({ ...base, apiKey: 'PERMANENT', mint: ok, upload });
    const res = await app.request('/upload', { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'file_3' });
  });
  it('rejects non-images and works only with a key', async () => {
    const app = decartRoutes({ ...base, upload: async () => ({ id: 'x' }) });
    expect((await app.request('/upload', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' })).status).toBe(415);
    expect((await decartRoutes(base).request('/upload', { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1]) })).status).toBe(503);
  });
});
