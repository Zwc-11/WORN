// Size -> visible fit. Pure; tested in fit.test.ts.
//
// The size chart is Patagonia's men's tops chart (body measurements a size is cut for), from a
// Patagonia store's fit guide: https://patagoniabend.com/pages/mens-tops-size-chart-fit-guide
// Better Sweater 1/4-Zip is "Regular Fit: neither slim nor oversized".
//
// The person picks the size they normally wear (their body) and the size to try. The difference
// between the two sizes' chest and arm measurements becomes a plain description of how the garment
// sits ("sleeves cover the hands"), which the try-on prompt carries. It is an illustration from the
// size chart, not a tailoring prediction; the UI says so.

export type Size = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export const SIZES: readonly Size[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** inches: chest, arm length (shoulder to wrist) */
export const PATAGONIA_MENS_TOPS: Record<Size, { chest: number; arm: number }> = {
  XS: { chest: 35, arm: 32 },
  S: { chest: 37, arm: 33 },
  M: { chest: 40, arm: 34 },
  L: { chest: 44, arm: 35 },
  XL: { chest: 47, arm: 36 },
  XXL: { chest: 50, arm: 37 },
};

export interface Fit {
  chestDelta: number; // inches the garment is cut bigger (+) or smaller (-) than the body
  armDelta: number;
  body: string;
  sleeves: string;
  phrase: string; // '' when it is the person's own size
}

export function fitFor(wears: Size, tries: Size, chart = PATAGONIA_MENS_TOPS): Fit {
  const chestDelta = chart[tries].chest - chart[wears].chest;
  const armDelta = chart[tries].arm - chart[wears].arm;
  const body =
    chestDelta <= -5
      ? 'very tight, the knit stretched across the chest and shoulders, the hem riding up above the waist'
      : chestDelta <= -2
        ? 'snug and close-fitting across the chest, the hem sitting at the waist'
        : chestDelta < 2
          ? ''
          : chestDelta < 6
            ? 'loose and roomy through the body, shoulder seams slightly past the shoulders, the hem a little lower on the hips'
            : 'oversized and baggy, shoulder seams dropped well down the upper arms, the body hanging loose and the hem low on the hips';
  const sleeves =
    armDelta <= -2
      ? 'sleeves too short, ending well above the wrists'
      : armDelta <= -1
        ? 'sleeves a little short, ending just above the wrists'
        : armDelta < 1
          ? ''
          : armDelta < 2
            ? 'sleeves slightly long, bunching at the wrists'
            : 'sleeves too long, covering the hands down to the knuckles';
  const parts = [body, sleeves].filter(Boolean);
  const phrase = parts.length ? `fitting the person ${wears === tries ? 'true to size' : `as a size ${tries} on a size ${wears} body`}: ${parts.join(', ')}` : '';
  return { chestDelta, armDelta, body, sleeves, phrase };
}
