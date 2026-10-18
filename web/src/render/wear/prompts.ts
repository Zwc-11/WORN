// Prompt builders. Deterministic text from (product, wear items, axis, t).
// Three consumers, three prompt styles:
//   vton  -> lucy-vton-latest realtime ("Substitute the upper body garment with ...", <= ~750 chars)
//   lucy  -> lucy-2.5 realtime general edit (fallback model)
//   flat  -> lucy-image-2 edit of the product photo, producing the aged reference / still
// The phrase table is the only place wording lives. Change it here, re-run the tests.

import type { Axis, DamageType, Product, Region } from '../../data/contract';
import { axisWord, type Severity, type WearItem } from './composeWear';

export const VTON_MAX_CHARS = 700; // docs: ~120 words / ~750 chars fit; keep headroom
export const IMAGE_MAX_CHARS = 1000; // lucy-image-2 schema max
/** How many wear items a prompt names: realtime prompts are short, image edits can carry more. */
export const MAX_WEAR_ITEMS = { realtime: 3, image: 5 } as const;

const REGION_NOUN: Record<Region, string> = {
  collar: 'neckline',
  cuffs: 'cuffs',
  armpit: 'underarm fabric',
  hem: 'hem',
  seams: 'side seams',
  chest_print: 'chest print',
};

const SEAM_NOUN: Record<Region, string> = {
  collar: 'collar seam',
  cuffs: 'cuff seam',
  armpit: 'underarm seam',
  hem: 'hem seam',
  seams: 'side seam',
  chest_print: 'seam',
};

const WHERE: Record<Region, string> = {
  collar: 'around the neckline',
  cuffs: 'on the cuffs',
  armpit: 'under the arms',
  hem: 'along the hem',
  seams: 'along the side seams',
  chest_print: 'on the chest',
};

const SEV: Record<DamageType, [string, string, string]> = {
  // measured on lucy-image-2 (Oct 17): words like "balls", "dense", "heavy" produce cartoon pom-poms or fur;
  // "lint pills" + a count word stays realistic. Change only with a re-run of the stills gate.
  pilling: ['a few small lint pills', 'small lint pills and light fuzz', 'many small lint pills and fuzz'],
  fading: ['slightly faded', 'faded', 'heavily faded, washed-out'],
  collar_deform: ['a slightly stretched', 'a stretched, wavy', 'a badly stretched, rippled'],
  cuff_wear: ['slightly worn', 'lightly frayed', 'frayed, with a few loose threads,'],
  seam_split: ['a small opening in the', 'an open split in the', 'a long open split with loose threads in the'],
  print_crack: ['fine cracks in the', 'visible cracking across the', 'heavy cracking and flaking in the'],
};

/** One wear item as a short noun phrase, e.g. "dense pilling and matted fuzz under the arms". */
export function wearPhrase(item: Pick<WearItem, 'type' | 'region' | 'severity'>, color?: string): string {
  const s = SEV[item.type][item.severity as Severity];
  switch (item.type) {
    case 'pilling':
      return `${s} ${WHERE[item.region]}`;
    case 'fading': {
      const what = color ? `${color.toLowerCase()} fabric` : 'fabric';
      return item.region === 'chest_print' ? `${s} chest print` : `${s} ${what} ${item.region === 'armpit' ? 'under the arms' : item.region === 'seams' ? 'along the seams' : 'across the body'}`;
    }
    case 'collar_deform':
      return `${s} neckline`;
    case 'cuff_wear':
      return `${s} ${REGION_NOUN[item.region]}`;
    case 'seam_split':
      return `${s} ${SEAM_NOUN[item.region]}`;
    case 'print_crack':
      return `${s} chest print`;
  }
}

/**
 * How the prompts name the garment.
 *   description: what the reference photo visibly shows (VTON guide: colour, fabric, closures, pockets, logos)
 *   noun:        short name used in image-edit prompts ("Show this exact <noun> after ...")
 *   styling:     how it is worn; VTON wants zips stated open or closed, hoods up or down
 * No brand names: VTON draws logos it is told about. A product's <id>.tryon.json can override any field.
 */
export interface GarmentSpec {
  description: string;
  noun: string;
  styling: string;
}

export type GarmentOverride = Partial<GarmentSpec>;

export function describeGarment(p: Pick<Product, 'color' | 'material' | 'type'>, override?: GarmentOverride | string): GarmentSpec {
  const o: GarmentOverride = typeof override === 'string' ? { description: override } : (override ?? {});
  const color = p.color ? p.color.toLowerCase() + ' ' : '';
  const material = p.material ? p.material.toLowerCase() + ' ' : '';
  const base: GarmentSpec =
    p.type === 'quarter_zip'
      ? { description: `a ${color}${material}quarter-zip pullover with a stand-up collar and a front zipper`, noun: 'quarter-zip pullover', styling: 'zipped closed' }
      : { description: `a ${color}${material}pullover hoodie with a drawstring hood, a front kangaroo pocket, ribbed cuffs and a ribbed hem`, noun: 'hoodie', styling: 'hood down' };
  return {
    description: o.description?.trim() || base.description,
    noun: o.noun?.trim() || base.noun,
    styling: o.styling?.trim() ?? base.styling,
  };
}

/** A prompt plus the wear items it actually names. `used` is what a caption may count as "based on". */
export interface Prompt {
  text: string;
  used: WearItem[];
}

function fit(build: (items: WearItem[]) => string, items: WearItem[], maxChars: number, cap: number, minItems = 0): Prompt {
  let used = items.slice(0, cap);
  let text = build(used);
  while (text.length > maxChars && used.length > minItems) {
    used = used.slice(0, -1);
    text = build(used);
  }
  if (text.length > maxChars) throw new Error(`prompt exceeds ${maxChars} chars even without wear; shorten the garment description`);
  return { text, used };
}

export interface PromptInput {
  garment: GarmentSpec;
  color?: string;
  wear: WearItem[];
  axis: Axis | null;
  t: number;
}

const joinPhrases = (items: WearItem[], color?: string) => items.map((i) => wearPhrase(i, color)).join(', ');
const fresh = (items: WearItem[], axis: Axis | null, t: number) => items.length === 0 || axis === null || t === 0;
const worn = (g: GarmentSpec) => (g.styling ? `, ${g.styling}` : '');

/** lucy-vton-latest. The reference image already shows the wear; the text names it so the two agree. */
export function vtonPrompt({ garment, color, wear, axis, t }: PromptInput): Prompt {
  return fit(
    (items) =>
      fresh(items, axis, t)
        ? `Substitute the upper body garment with ${garment.description}${worn(garment)}.`
        : `Substitute the upper body garment with ${garment.description}${worn(garment)}, visibly worn after ${t} ${axisWord(axis!, t)}: ${joinPhrases(items, color)}.`,
    wear,
    VTON_MAX_CHARS,
    MAX_WEAR_ITEMS.realtime,
  );
}

/** lucy-2.5 general realtime edit (fallback when VTON ignores wear). */
export function lucyPrompt({ garment, color, wear, axis, t }: PromptInput): Prompt {
  return fit(
    (items) =>
      fresh(items, axis, t)
        ? `Substitute the person's top with ${garment.description}, brand new${worn(garment)}. Keep the face, hair, body, background and lighting unchanged.`
        : `Substitute the person's top with ${garment.description}${worn(garment)}, worn after ${t} ${axisWord(axis!, t)}: ${joinPhrases(items, color)}. Keep the face, hair, body, background and lighting unchanged.`,
    wear,
    VTON_MAX_CHARS,
    MAX_WEAR_ITEMS.realtime,
  );
}

/**
 * lucy-image-2 edit of a photo of the presenter, with the stage's garment image as reference_image.
 * Produces the frozen-person fallback stills (pre-generated, so the demo never waits on a call).
 */
export function personEditPrompt({ garment, color, wear, axis, t }: PromptInput): Prompt {
  return fit(
    (items) =>
      fresh(items, axis, t)
        ? `Substitute the person's upper body garment with the ${garment.noun} from the reference image, brand new${worn(garment)}. Keep the person's face, hair, pose, background and lighting unchanged.`
        : `Substitute the person's upper body garment with the ${garment.noun} from the reference image${worn(garment)}, worn after ${t} ${axisWord(axis!, t)}: ${joinPhrases(items, color)}. Keep the person's face, hair, pose, background and lighting unchanged.`,
    wear,
    IMAGE_MAX_CHARS,
    MAX_WEAR_ITEMS.image,
  );
}

/**
 * lucy-image-2 edit of the product photo -> aged still and aged VTON reference. Not used for t = 0.
 * Measured Oct 17 on the Better Sweater: "Show this exact X after N washes ..." often regenerated a different
 * garment; "Add <wear> to this X ... Everything else stays exactly the same: ..." kept the garment and
 * localized the edit to the named regions.
 */
export function flatEditPrompt({ garment, color, wear, axis, t }: PromptInput): Prompt {
  if (fresh(wear, axis, t)) throw new Error('flatEditPrompt needs wear and t > 0; stage 0 is the product photo itself');
  const colour = color ? `${color.toLowerCase()} color and ` : '';
  return fit(
    (items) =>
      `Add realistic wear to this ${garment.noun}, as it looks after ${t} ${axisWord(axis!, t)} of everyday use: ${joinPhrases(items, color)}. ` +
      `Everything else stays exactly the same: the same ${garment.noun}, the same ${colour}fabric texture, zipper, logo, shape, framing, lighting and plain background.`,
    wear,
    IMAGE_MAX_CHARS,
    MAX_WEAR_ITEMS.image,
    1,
  );
}
