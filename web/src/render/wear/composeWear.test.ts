import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DossierSchema, FramesSchema, ProductSchema, type Case, type Dossier, type Product } from '../../data/contract';
import { activeWear, canRenderWear, pickStages, severityOf, stageIndexFor } from './composeWear';
import { describeGarment, flatEditPrompt, vtonPrompt, lucyPrompt, VTON_MAX_CHARS, wearPhrase } from './prompts';
import { planTryOn } from './plan';
import { planTest, TEST_STAGES } from './testWear';

const fx = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../public/fixtures', f), 'utf8'));
const sample: Dossier = DossierSchema.parse(fx('sample-hoodie.dossier.json'));
const product: Product = ProductSchema.parse(fx('products.json').find((p: { id: string }) => p.id === 'sample-hoodie'));

const mk = (id: string, t: number | null, extra: Partial<Case> = {}): Case => ({
  id,
  type: 'pilling',
  region: 'armpit',
  t,
  quote: `[sample] ${id}`,
  source: { site: 'amazon', url: 'https://example.com/r', date: '2026-01-01' },
  ...extra,
});
const dossierOf = (cases: Case[], axis: Dossier['axis'] = 'washes'): Dossier => ({
  productId: 'x',
  axis,
  reviewsRead: 100,
  reviewsWithPhotos: 0,
  cases,
  counts: { byType: {} as never, byRegion: {} as never },
  sample: true,
  updatedAt: '2026-10-17',
});

describe('fixtures', () => {
  it('sample dossier, product and frames pass the contract', () => {
    expect(sample.cases.length).toBeGreaterThanOrEqual(10);
    expect(product.id).toBe(sample.productId);
    expect(() => FramesSchema.parse(fx('sample-hoodie.frames.json'))).not.toThrow();
  });
  it('frames basedOn equals the cases named by each still edit prompt', () => {
    const frames = FramesSchema.parse(fx('sample-hoodie.frames.json'));
    for (const s of frames.stages) {
      const wear = activeWear(sample, s.t);
      const ids = s.t === 0 || wear.length === 0 ? [] : [...new Set(flatEditPrompt({ garment: describeGarment(product), color: product.color, wear, axis: 'washes', t: s.t }).used.flatMap((w) => w.caseIds))].sort();
      expect(s.basedOn).toEqual(ids);
    }
  });
});

describe('activeWear', () => {
  it('draws nothing before the first stated time', () => {
    expect(activeWear(sample, 0)).toEqual([]);
    expect(activeWear(sample, 2.9)).toEqual([]);
  });

  it('appears exactly at the stated time, not before', () => {
    expect(activeWear(sample, 3).map((w) => `${w.type}:${w.region}`)).toEqual(['pilling:armpit']);
  });

  it('never uses time-unknown cases or cases in the other unit', () => {
    const all = activeWear(sample, 1e9).flatMap((w) => w.caseIds);
    const nullIds = sample.cases.filter((c) => c.t === null).map((c) => c.id);
    const otherUnit = sample.cases.filter((c) => c.unitStated).map((c) => c.id);
    expect(nullIds.length).toBeGreaterThan(0);
    expect(otherUnit.length).toBeGreaterThan(0);
    for (const id of [...nullIds, ...otherUnit]) expect(all).not.toContain(id);
    // collar_deform exists only as a time-unknown case -> never rendered
    expect(activeWear(sample, 1e9).some((w) => w.type === 'collar_deform')).toBe(false);
  });

  it('is monotonic: wear reached at t is still there later, and never gets lighter', () => {
    let prev = new Map<string, number>();
    for (let t = 0; t <= 40; t++) {
      const now = new Map(activeWear(sample, t).map((w) => [`${w.type}:${w.region}`, w.severity]));
      for (const [k, sev] of prev) expect(now.get(k) ?? -1).toBeGreaterThanOrEqual(sev);
      prev = now;
    }
  });

  it('renders nothing with fewer than 3 cases (insufficient evidence)', () => {
    const d = dossierOf([mk('a', 1), mk('b', 2)]);
    expect(canRenderWear(d)).toBe(false);
    expect(activeWear(d, 10)).toEqual([]);
    expect(pickStages(d)).toEqual([0]);
  });

  it('renders nothing when the dossier has no axis', () => {
    const d = dossierOf([mk('a', null), mk('b', null), mk('c', null)], null);
    expect(activeWear(d, 10)).toEqual([]);
  });

  it('orders the most-reported wear first', () => {
    const w = activeWear(sample, 30);
    for (let i = 1; i < w.length; i++) expect(w[i - 1].reached).toBeGreaterThanOrEqual(w[i].reached);
    expect(w[0].reached).toBe(Math.max(...w.map((x) => x.reached)));
    expect(w.at(-1)?.type).toBe('seam_split'); // one owner -> last
  });
});

describe('severityOf', () => {
  it('one owner alone never draws heavy wear', () => {
    expect(severityOf(1, 1)).toBe(0);
  });
  it('grows with owners and share reached', () => {
    expect(severityOf(2, 4)).toBe(1);
    expect(severityOf(4, 4)).toBe(2);
    expect(severityOf(4, 20)).toBe(0);
  });
});

describe('pickStages / stageIndexFor', () => {
  it('starts at 0, ascends, ends at the latest report, respects max', () => {
    const s = pickStages(sample, 5);
    expect(s).toEqual([0, 6, 12, 20, 30]);
    expect(pickStages(sample, 3).length).toBeLessThanOrEqual(3);
    expect(pickStages(sample, 3).at(-1)).toBe(30);
  });
  it('keeps every time when there are few', () => {
    const d = dossierOf([mk('a', 4), mk('b', 8), mk('c', 8)]);
    expect(pickStages(d, 5)).toEqual([0, 4, 8]);
  });
  it('maps a slider value to the last stage at or below it', () => {
    const st = [0, 6, 12, 20, 30].map((t) => ({ t }));
    expect(stageIndexFor(st, 0)).toBe(0);
    expect(stageIndexFor(st, 5.99)).toBe(0);
    expect(stageIndexFor(st, 6)).toBe(1);
    expect(stageIndexFor(st, 29)).toBe(3);
    expect(stageIndexFor(st, 99)).toBe(4);
  });
});

describe('prompts', () => {
  const garment = describeGarment(product);
  it('describes the garment without a brand name', () => {
    expect(garment.description).toContain('black');
    expect(garment.description.toLowerCase()).not.toContain(product.brand.toLowerCase());
    expect(garment).toMatchObject({ noun: 'hoodie', styling: 'hood down' });
  });
  it('a quarter-zip gets its own noun and styling, and overrides win', () => {
    const qz = describeGarment({ type: 'quarter_zip', color: 'Moonrise Taupe' });
    expect(qz.noun).toBe('quarter-zip pullover');
    expect(qz.styling).toBe('zipped closed');
    expect(qz.description).not.toMatch(/hood/);
    expect(describeGarment({ type: 'quarter_zip' }, { description: 'X', noun: 'Y' })).toEqual({ description: 'X', noun: 'Y', styling: 'zipped closed' });
    expect(vtonPrompt({ garment: qz, wear: [], axis: 'washes', t: 0 }).text).toBe(`Substitute the upper body garment with ${qz.description}, zipped closed.`);
    const flat = flatEditPrompt({ garment: qz, wear: activeWear(sample, 12), axis: 'washes', t: 12 }).text;
    expect(flat).toContain('Add realistic wear to this quarter-zip pullover, as it looks after 12 washes');
    expect(flat).not.toMatch(/hoodie/);
  });
  it('stage 0 is the plain substitution', () => {
    expect(vtonPrompt({ garment, wear: [], axis: 'washes', t: 0 }).text).toBe(`Substitute the upper body garment with ${garment.description}, hood down.`);
  });
  it('names the wear and the axis at later stages, within the VTON budget', () => {
    for (const t of [6, 12, 20, 30]) {
      const p = vtonPrompt({ garment, color: product.color, wear: activeWear(sample, t), axis: 'washes', t }).text;
      expect(p).toContain(`after ${t} washes`);
      expect(p.length).toBeLessThanOrEqual(VTON_MAX_CHARS);
      expect(lucyPrompt({ garment, color: product.color, wear: activeWear(sample, t), axis: 'washes', t }).text.length).toBeLessThanOrEqual(VTON_MAX_CHARS);
    }
    const p30 = vtonPrompt({ garment, color: product.color, wear: activeWear(sample, 30), axis: 'washes', t: 30 }).text;
    expect(p30).toContain('under the arms');
    expect(p30).toContain('faded');
  });
  it('drops the weakest wear items instead of overflowing', () => {
    const long = { ...garment, description: 'a hoodie ' + 'with many details '.repeat(30) };
    const wear = activeWear(sample, 30);
    const p = vtonPrompt({ garment: long, wear, axis: 'washes', t: 30 });
    expect(p.text.length).toBeLessThanOrEqual(VTON_MAX_CHARS);
    expect(p.used.length).toBeLessThan(3);
    expect(p.used[0]).toBe(wear[0]); // the strongest item survives
    expect(() => vtonPrompt({ garment: { ...garment, description: 'x'.repeat(800) }, wear, axis: 'washes', t: 30 })).toThrow(/shorten/);
  });
  it('flat edit prompt refuses stage 0 and is >= 20 words otherwise', () => {
    expect(() => flatEditPrompt({ garment, wear: [], axis: 'washes', t: 0 })).toThrow();
    const p = flatEditPrompt({ garment, color: 'Black', wear: activeWear(sample, 20), axis: 'washes', t: 20 });
    expect(p.text.split(/\s+/).length).toBeGreaterThanOrEqual(20);
    expect(p.used.length).toBe(4); // image prompts carry up to 5 items
  });
  it('wear phrases read naturally', () => {
    expect(wearPhrase({ type: 'pilling', region: 'armpit', severity: 2 })).toBe('many small lint pills and fuzz under the arms');
    expect(wearPhrase({ type: 'cuff_wear', region: 'cuffs', severity: 1 })).toBe('lightly frayed cuffs');
    expect(wearPhrase({ type: 'fading', region: 'hem', severity: 2 }, 'Black')).toBe('heavily faded, washed-out black fabric across the body');
  });
});

describe('planTryOn', () => {
  const frames = FramesSchema.parse(fx('sample-hoodie.frames.json'));
  it('uses Frames t values and images when they match the product', () => {
    const plan = planTryOn(product, sample, frames);
    expect(plan.evidence).toBe('ok');
    expect(plan.stages.map((s) => s.t)).toEqual(frames.stages.map((s) => s.t));
    expect(plan.stages[0].image).toBe(frames.stages[0].image);
    expect(plan.stages[0].imageShowsWear).toBe(false);
    expect(plan.stages[2].imageShowsWear).toBe(true);
    expect(plan.stages[2].basedOn).toEqual(frames.stages[2].basedOn);
  });
  it('prompt-only stages count only the cases their prompt names', () => {
    const plan = planTryOn(product, sample, null);
    const last = plan.stages.at(-1)!;
    const named = vtonPrompt({ garment: plan.garment, color: product.color, wear: last.wear, axis: 'washes', t: last.t }).used;
    expect(last.basedOn).toEqual([...new Set(named.flatMap((w) => w.caseIds))].sort());
    expect(last.basedOn.length).toBeLessThan(new Set(last.wear.flatMap((w) => w.caseIds)).size);
  });
  it('falls back to the product photo with prompt-only stages when there are no frames', () => {
    const plan = planTryOn(product, sample, null);
    expect(plan.stages.length).toBe(5);
    expect(new Set(plan.stages.map((s) => s.image))).toEqual(new Set([product.image.flat]));
    expect(plan.stages.every((s) => !s.imageShowsWear)).toBe(true);
  });
  it('thin and none evidence give a single new-garment stage', () => {
    const thin = planTryOn({ ...product, evidence: 'live' }, dossierOf([mk('a', 1), mk('b', 2)]), null);
    expect(thin.evidence).toBe('thin');
    expect(thin.stages.length).toBe(1);
    const none = planTryOn({ ...product, evidence: 'none' }, null, null);
    expect(none.evidence).toBe('none');
    expect(none.stages[0].wear).toEqual([]);
  });
});

describe('gate-test wear (not evidence)', () => {
  const pata = ProductSchema.parse(fx('products.json').find((p: { id: string }) => p.id === 'patagonia-25523'));
  const override = fx('tryon.json')['patagonia-25523'];
  it('the Patagonia fixture is valid, has no evidence, and its own garment text', () => {
    expect(pata.type).toBe('quarter_zip');
    expect(pata.evidence).toBe('none');
    const plan = planTryOn(pata, null, null, { garment: override });
    expect(plan.evidence).toBe('none');
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0].prompts.vton).toContain('zipped closed');
    expect(plan.stages[0].prompts.vton).not.toMatch(/hood|patagonia/i);
    expect(plan.stages[0].prompts.vton.length).toBeLessThanOrEqual(VTON_MAX_CHARS);
  });
  it('test plan never claims reports and is flagged as a test', () => {
    const plan = planTest(pata, null, { garment: override });
    expect(plan.test).toBe(true);
    expect(plan.stages.map((s) => s.t)).toEqual([0, ...TEST_STAGES.map((s) => s.t)]);
    expect(plan.stages.every((s) => s.basedOn.length === 0)).toBe(true);
    expect(plan.stages.at(-1)!.prompts.vton).toContain('after 25 washes');
    for (const s of plan.stages) expect(s.prompts.vton.length).toBeLessThanOrEqual(VTON_MAX_CHARS);
  });
});
