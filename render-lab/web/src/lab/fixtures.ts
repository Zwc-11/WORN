// Lab-only fixture loader (A and B own the real DataSource; this just reads public/fixtures).
import { DossierSchema, FramesSchema, ProductSchema, type Dossier, type Frames, type Product } from '../data/contract';
import type { GarmentOverride } from '../render/wear/prompts';

async function json(url: string): Promise<unknown | null> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null; // Vite serves index.html for missing files
  return res.json();
}

export async function loadProducts(): Promise<Product[]> {
  const raw = (await json('/fixtures/products.json')) as unknown[] | null;
  return (raw ?? []).map((p) => ProductSchema.parse(p));
}

export async function loadBundle(id: string): Promise<{ dossier: Dossier | null; frames: Frames | null }> {
  const [d, f] = await Promise.all([json(`/fixtures/${id}.dossier.json`), json(`/fixtures/${id}.frames.json`)]);
  return { dossier: d ? DossierSchema.parse(d) : null, frames: f ? FramesSchema.parse(f) : null };
}

/** Frozen-person stills (pipeline --person). Opt-in, so a missing file never logs a 404 in the demo. */
export async function loadPersonFrames(id: string): Promise<Frames | null> {
  const pf = await json(`/fixtures/${id}.person.frames.json`);
  return pf ? FramesSchema.parse(pf) : null;
}

/** Per-product garment text overrides (fixtures/tryon.json, keyed by product id). Always present, so no 404s. */
export async function loadGarmentOverrides(): Promise<Record<string, GarmentOverride>> {
  return ((await json('/fixtures/tryon.json')) as Record<string, GarmentOverride> | null) ?? {};
}

/** Gate-test stills (pipeline --test). Lab only. */
export async function loadTestFrames(id: string): Promise<Frames | null> {
  const f = await json(`/fixtures/${id}.test-frames.json`);
  return f ? FramesSchema.parse(f) : null;
}

export interface VariantIndex {
  productId: string;
  axis: string;
  resolution: string;
  generatedAt: string;
  stages: { t: number; prompt: string; files: string[]; basedOn: number }[];
}

export async function loadVariants(id: string, test = false): Promise<VariantIndex | null> {
  return (await json(`/fixtures/stills/${id}/${test ? 'test/' : ''}variants/index.json`)) as VariantIndex | null;
}

export async function apiConfigured(): Promise<boolean | null> {
  try {
    const r = await fetch('/api/decart/health');
    if (!r.ok) return null;
    return Boolean(((await r.json()) as { configured?: boolean }).configured);
  } catch {
    return null; // server not running
  }
}
