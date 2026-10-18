// GATE-TEST WEAR. Not owner evidence.
//
// Plan v2's 5:00 PM gate asks a capability question: "does the model draw localized wear on this
// garment, and does that wear survive onto a person live?" That question needs a fixed wear spec,
// independent of how many reviews we have collected. This file is that spec.
//
// It is only reachable from the lab (lab.html, "Gate test wear" on) and from `npm run frames -- --test`.
// Its stills go to stills/<id>/test/ and <id>.test-frames.json, never to <id>.frames.json, and every
// stage has basedOn: [] so nothing downstream can count it as reports.

import type { DamageType, Frames, Product, Region } from '../../data/contract';
import type { Severity, WearItem } from './composeWear';
import type { TryOnPlan } from './plan';
import { describeGarment, lucyPrompt, vtonPrompt, type GarmentOverride } from './prompts';

export const TEST_AXIS = 'washes' as const;

/** Knit-fleece wear in the forms pilling-prone fleece shows it. Severity grows with the stage. */
export const TEST_STAGES: { t: number; wear: [DamageType, Region, Severity][] }[] = [
  { t: 1, wear: [['pilling', 'armpit', 0]] },
  { t: 10, wear: [['pilling', 'armpit', 1], ['pilling', 'cuffs', 0], ['pilling', 'hem', 0]] },
  { t: 25, wear: [['pilling', 'armpit', 2], ['pilling', 'cuffs', 1], ['pilling', 'hem', 1], ['fading', 'hem', 0]] },
];

export function testWearAt(t: number): WearItem[] {
  const stage = [...TEST_STAGES].reverse().find((s) => s.t <= t);
  if (!stage) return [];
  return stage.wear.map(([type, region, severity]) => ({ type, region, severity, reached: 0, dated: 0, caseIds: [], firstT: stage.t }));
}

export function planTest(product: Product, frames: Frames | null, opts: { garment?: GarmentOverride | string } = {}): TryOnPlan {
  const garment = describeGarment(product, opts.garment);
  const photo = product.image.flat ?? product.image.hero;
  const ts = [0, ...TEST_STAGES.map((s) => s.t)];
  const usable = frames && frames.productId === product.id && frames.axis === TEST_AXIS ? frames : null;
  return {
    productId: product.id,
    axis: TEST_AXIS,
    evidence: 'ok',
    garment,
    test: true,
    stages: ts.map((t) => {
      const wear = testWearAt(t);
      const frame = usable?.stages.find((s) => s.t === t);
      const input = { garment, color: product.color, wear, axis: TEST_AXIS, t };
      return {
        t,
        image: frame?.image ?? photo,
        imageShowsWear: Boolean(frame) && t > 0,
        wear,
        basedOn: [],
        prompts: { vton: vtonPrompt(input).text, lucy: lucyPrompt(input).text },
      };
    }),
  };
}
