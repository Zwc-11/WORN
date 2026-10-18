// Shared helpers for the render pipeline scripts. Node 20+, run with tsx.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { DossierSchema, FramesSchema, ProductSchema, type Dossier, type Frames, type Product } from '../../web/src/data/contract.ts';
import { activeWear, basedOn } from '../../web/src/render/wear/composeWear.ts';
import { describeGarment, flatEditPrompt, type GarmentOverride, type GarmentSpec } from '../../web/src/render/wear/prompts.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
export const PUBLIC_DIR = resolve(ROOT, 'web/public');
export const FIXTURES_DIR = resolve(PUBLIC_DIR, 'fixtures');

loadEnv({ path: resolve(ROOT, '.env') });

export function args(argv = process.argv.slice(2)): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
export function writeJson(p: string, v: unknown) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

export function loadProduct(id: string): Product {
  const list = readJson<unknown[]>(resolve(FIXTURES_DIR, 'products.json')).map((p) => ProductSchema.parse(p));
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error(`product "${id}" not in fixtures/products.json (have: ${list.map((x) => x.id).join(', ')})`);
  return p;
}

/** fixtures/tryon.json: per-product garment text overrides tuned in the lab. */
export function loadGarment(p: Product): GarmentSpec {
  const path = resolve(FIXTURES_DIR, 'tryon.json');
  const all = existsSync(path) ? readJson<Record<string, GarmentOverride>>(path) : {};
  return describeGarment(p, all[p.id]);
}

export function loadDossier(id: string): Dossier {
  const path = resolve(FIXTURES_DIR, `${id}.dossier.json`);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return DossierSchema.parse(readJson(path));
}

export function loadFrames(id: string, kind: 'frames' | 'person.frames' | 'test-frames' = 'frames'): Frames | null {
  const path = resolve(FIXTURES_DIR, `${id}.${kind}.json`);
  return existsSync(path) ? FramesSchema.parse(readJson(path)) : null;
}

/** "/fixtures/x.png" (URL as the web app sees it) <-> absolute file path under web/public. */
export const urlToPath = (url: string) => resolve(PUBLIC_DIR, url.replace(/^\//, ''));
export const pathToUrl = (p: string) => '/' + p.slice(PUBLIC_DIR.length + 1).split('\\').join('/');

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export function fileBlob(p: string): Blob {
  const type = MIME[extname(p).toLowerCase()];
  if (!type) throw new Error(`unsupported image type ${p} (use png, jpg or webp)`);
  return new Blob([readFileSync(p)], { type });
}
export const extFor = (mime: string) => (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg');

/** The case ids a stage's still is composed from: the wear its edit prompt names. [] for stage 0 or no wear. */
export function stageBasedOn(dossier: Dossier, t: number, product: Product, garment: GarmentSpec): string[] {
  const wear = activeWear(dossier, t);
  if (t === 0 || wear.length === 0 || dossier.axis === null) return [];
  return basedOn(flatEditPrompt({ garment, color: product.color, wear, axis: dossier.axis, t }).used);
}

/** Frames with basedOn computed from the dossier, so the caption count is always the real case count. */
export function framesFrom(product: Product, dossier: Dossier, stages: { t: number; image: string }[], garment: GarmentSpec): Frames {
  if (dossier.axis === null) throw new Error('dossier has no axis: nothing to render on a slider');
  return FramesSchema.parse({
    productId: product.id,
    axis: dossier.axis,
    stages: stages.map((s) => ({ t: s.t, image: s.image, basedOn: stageBasedOn(dossier, s.t, product, garment) })),
    generated: true,
    label: 'illustration',
  } satisfies Frames);
}

/** Gate-test frames: same shape, basedOn always [] (test wear is not evidence). */
export function testFramesFrom(productId: string, stages: { t: number; image: string }[]): Frames {
  return FramesSchema.parse({ productId, axis: 'washes', stages: stages.map((s) => ({ ...s, basedOn: [] })), generated: true, label: 'illustration' } satisfies Frames);
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // SDK errors are plain {code, message} objects, e.g. {code:'PROCESSING_ERROR', message:'Processing failed: 401 - ...'}
      const code = String((e as { code?: unknown })?.code ?? '');
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      const permanent =
        ['INVALID_API_KEY', 'INVALID_INPUT', 'INVALID_OPTIONS', 'MODEL_NOT_FOUND'].includes(code) ||
        /Processing failed: (400|401|402|403|404|413|422)\b/.test(msg) ||
        /insufficient|credits/i.test(msg);
      if (permanent) break; // retrying won't help
      console.warn(`  ${label}: attempt ${i + 1} failed: ${msg}`);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** Run tasks with at most `n` in flight. */
export async function pool<T>(n: number, tasks: (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}
