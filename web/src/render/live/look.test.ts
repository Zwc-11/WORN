import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DossierSchema, FramesSchema, ProductSchema } from '../../data/contract';
import { planTryOn } from '../wear/plan';
import { lookFor, preloadFor } from './look';

const fx = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../public/fixtures', f), 'utf8'));
const product = ProductSchema.parse(fx('products.json').find((p: { id: string }) => p.id === 'sample-hoodie'));
const plan = planTryOn(product, DossierSchema.parse(fx('sample-hoodie.dossier.json')), FramesSchema.parse(fx('sample-hoodie.frames.json')));

describe('lookFor', () => {
  it('reference-swap sends each stage its own aged image; prompt-only keeps the product photo', () => {
    expect(lookFor(plan, 3, 'lucy-vton-latest', 'reference-swap').image).toBe(plan.stages[3].image);
    expect(lookFor(plan, 3, 'lucy-vton-latest', 'prompt-only').image).toBe(plan.stages[0].image);
  });
  it('uses the prompt written for the chosen model', () => {
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap').prompt).toBe(plan.stages[2].prompts.vton);
    expect(lookFor(plan, 2, 'lucy-2.5', 'reference-swap').prompt).toBe(plan.stages[2].prompts.lucy);
  });
  it('keys are stable for the same look and differ across stages, models and strategies', () => {
    const a = lookFor(plan, 1, 'lucy-vton-latest', 'reference-swap');
    expect(lookFor(plan, 1, 'lucy-vton-latest', 'reference-swap').key).toBe(a.key);
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap').key).not.toBe(a.key);
    expect(lookFor(plan, 1, 'lucy-2.5', 'reference-swap').key).not.toBe(a.key);
    expect(lookFor(plan, 1, 'lucy-vton-latest', 'prompt-only').key).not.toBe(a.key);
  });
  it('clamps out-of-range stage indexes', () => {
    expect(lookFor(plan, 99, 'lucy-vton-latest', 'reference-swap').image).toBe(plan.stages.at(-1)!.image);
    expect(lookFor(plan, -3, 'lucy-vton-latest', 'reference-swap').image).toBe(plan.stages[0].image);
  });
  it('preloads every stage image only when swapping references', () => {
    expect(preloadFor(plan, 'reference-swap').length).toBe(plan.stages.length);
    expect(preloadFor(plan, 'prompt-only')).toEqual([plan.stages[0].image]);
  });
});

describe('text modes and custom references', () => {
  it('image mode sends no text, short mode one line, full mode the plan prompt', () => {
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'image').prompt).toBe('');
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'short').prompt).toBe('Substitute the upper body garment with the hoodie from the reference image, hood down.');
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'full').prompt).toBe(plan.stages[2].prompts.vton);
    const keys = (['full', 'short', 'image'] as const).map((m) => lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', m).key);
    expect(new Set(keys).size).toBe(3);
  });
  it('a custom reference replaces the stage image and changes the key', () => {
    const a = lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap');
    const b = lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'full', 'blob:http://localhost/x');
    expect(b.image).toBe('blob:http://localhost/x');
    expect(b.key).not.toBe(a.key);
  });
});

describe('fit', () => {
  it('appends the fit after the styling in full and short modes, and forces words in image mode', () => {
    const fit = 'fitting the person as a size XL on a size M body: oversized and baggy';
    const full = lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'full', undefined, fit).prompt;
    expect(full).toContain(`hood down, ${fit}`);
    expect(full.startsWith('Substitute the upper body garment with')).toBe(true);
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'short', undefined, fit).prompt).toContain(fit);
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'image', undefined, fit).prompt).toContain(fit);
    expect(lookFor(plan, 2, 'lucy-vton-latest', 'reference-swap', 'image').prompt).toBe('');
  });
});

describe('fit within the prompt budget', () => {
  it('falls back to the short line plus fit when the full prompt would exceed VTON_MAX_CHARS', () => {
    const fit = 'fitting the person as a size XL on a size M body: ' + 'x'.repeat(650);
    const p = lookFor(plan, plan.stages.length - 1, 'lucy-vton-latest', 'reference-swap', 'full', undefined, fit).prompt;
    expect(p.startsWith('Substitute the upper body garment with the ')).toBe(true);
    expect(p).toContain('from the reference image');
    expect(p).toContain(fit);
  });
});
