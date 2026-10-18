// TryOnPlan: everything the live renderer needs, computed once per product from the contract.
// One stage = one slider stop = one reference image + one prompt per model.

import type { Axis, Dossier, Frames, Product } from '../../data/contract';
import { activeWear, basedOn, canRenderWear, pickStages, type WearItem } from './composeWear';
import { describeGarment, lucyPrompt, vtonPrompt, type GarmentOverride, type GarmentSpec } from './prompts';

export type EvidenceState = 'ok' | 'thin' | 'none';

export interface TryOnStage {
  t: number;
  /** Reference garment image for this stage: the aged flat from Frames, or the product photo. */
  image: string;
  /** True when `image` actually shows this stage's wear (an aged flat), false when it is the new product photo. */
  imageShowsWear: boolean;
  wear: WearItem[];
  /** Case ids this stage's look is composed from (what the caption counts). */
  basedOn: string[];
  prompts: { vton: string; lucy: string };
}

export interface TryOnPlan {
  productId: string;
  axis: Axis | null;
  evidence: EvidenceState;
  garment: GarmentSpec;
  /** True for the lab's gate-test plan: wear from a fixed test spec, not from owner evidence. */
  test?: boolean;
  stages: TryOnStage[];
}

export function evidenceState(p: Product, d: Dossier | null): EvidenceState {
  if (!d || p.evidence === 'none' || d.cases.length === 0) return 'none';
  return canRenderWear(d) ? 'ok' : 'thin';
}

/**
 * Build the plan. Stage t values come from Frames when stills exist (so the reference image and the
 * prompt always describe the same moment), otherwise from pickStages(dossier).
 */
export function planTryOn(product: Product, dossier: Dossier | null, frames: Frames | null, opts: { garment?: GarmentOverride | string; maxStages?: number } = {}): TryOnPlan {
  const garment = describeGarment(product, opts.garment);
  const photo = product.image.flat ?? product.image.hero;
  const evidence = evidenceState(product, dossier);
  const axis = dossier?.axis ?? null;

  const useFrames = frames && dossier && frames.productId === product.id && frames.axis === axis && frames.stages.length > 0;
  const ts = useFrames ? frames.stages.map((s) => s.t) : dossier && evidence === 'ok' ? pickStages(dossier, opts.maxStages) : [0];

  const stages: TryOnStage[] = ts.map((t, i) => {
    const wear = dossier && evidence === 'ok' ? activeWear(dossier, t) : [];
    const frame = useFrames ? frames.stages[i] : undefined;
    const input = { garment, color: product.color, wear, axis, t };
    const vton = vtonPrompt(input);
    const imageShowsWear = Boolean(frame) && i > 0 && wear.length > 0;
    return {
      t,
      image: frame?.image ?? photo,
      imageShowsWear,
      wear,
      // an aged reference shows what the still was composed from; a prompt-only stage shows what its text names
      basedOn: imageShowsWear ? frame!.basedOn : basedOn(vton.used),
      prompts: { vton: vton.text, lucy: lucyPrompt(input).text },
    };
  });

  return { productId: product.id, axis, evidence, garment, stages };
}
