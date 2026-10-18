import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanPrompt, cleanRoutes, fitPrompt } from './clean';

const png = new File([new Uint8Array([137, 80, 78, 71])], 'owner.png', { type: 'image/png' });
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describe('POST /garment', () => {
  it('saves the original and the cleaned results, and returns their URLs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'worn-'));
    const edit = vi.fn(async () => new Blob(['clean'], { type: 'image/png' }));
    const app = cleanRoutes({ publicDir: dir, allowedOrigins: [], edit, seeds: [1, 2] });
    const res = await app.request('/garment', { method: 'POST', body: form({ image: png, productId: 'patagonia-25523', noun: 'quarter-zip fleece pullover' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleaned).toHaveLength(2);
    expect(body.prompt).toBe(cleanPrompt('quarter-zip fleece pullover'));
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('Extract only the quarter-zip fleece pullover'), seed: 1 }));
    const saved = resolve(dir, body.cleaned[0].replace(/^\//, ''));
    expect(existsSync(saved)).toBe(true);
    expect(readFileSync(saved, 'utf8')).toBe('clean');
    expect(existsSync(resolve(dir, body.original.replace(/^\//, '')))).toBe(true);
  });

  it('keeps the prompt honest about wear', () => {
    expect(cleanPrompt('sweater')).toMatch(/every visible sign of wear, pilling and damage exactly as in the photo/);
  });

  it('rejects bad input before spending anything', async () => {
    const edit = vi.fn();
    const app = cleanRoutes({ publicDir: tmpdir(), allowedOrigins: [], edit: edit as never });
    expect((await app.request('/garment', { method: 'POST', body: form({ productId: 'x' }) })).status).toBe(400);
    expect((await app.request('/garment', { method: 'POST', body: form({ image: png, productId: '../etc' }) })).status).toBe(400);
    const gif = new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' });
    expect((await app.request('/garment', { method: 'POST', body: form({ image: gif, productId: 'x' }) })).status).toBe(415);
    expect(edit).not.toHaveBeenCalled();
  });

  it('503 without a key, 502 when every attempt fails', async () => {
    expect((await cleanRoutes({ publicDir: tmpdir(), allowedOrigins: [] }).request('/garment', { method: 'POST', body: form({ image: png, productId: 'x' }) })).status).toBe(503);
    const app = cleanRoutes({ publicDir: mkdtempSync(join(tmpdir(), 'worn-')), allowedOrigins: [], edit: async () => Promise.reject(new Error('boom')), seeds: [1] });
    const res = await app.request('/garment', { method: 'POST', body: form({ image: png, productId: 'x' }) });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain('boom');
  });
});

describe('POST /fit', () => {
  it('edits the fit only, saves base and result, and returns the image URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'worn-'));
    const edit = vi.fn(async () => new Blob(['xl'], { type: 'image/png' }));
    const app = cleanRoutes({ publicDir: dir, allowedOrigins: [], edit });
    const fit = 'as a size XL on a size M body: oversized and baggy';
    const res = await app.request('/fit', { method: 'POST', body: form({ image: png, productId: 'patagonia-25523', noun: 'quarter-zip fleece pullover', size: 'XL', fit }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompt).toBe(fitPrompt('quarter-zip fleece pullover', fit));
    expect(body.prompt).toMatch(/Everything else stays exactly the same: the same person/);
    expect(readFileSync(resolve(dir, body.image.replace(/^\//, '')), 'utf8')).toBe('xl');
    expect(existsSync(resolve(dir, body.original.replace(/^\//, '')))).toBe(true);
  });
  it('rejects a missing size before spending anything', async () => {
    const edit = vi.fn();
    const app = cleanRoutes({ publicDir: mkdtempSync(join(tmpdir(), 'worn-')), allowedOrigins: [], edit });
    expect((await app.request('/fit', { method: 'POST', body: form({ image: png, productId: 'p', fit: 'x' }) })).status).toBe(400);
    expect(edit).not.toHaveBeenCalled();
  });
});
