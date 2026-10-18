import type { Case, Dossier, Region } from '../data/contract';

export interface Pin {
  region: Region;
  /** Cases visible at this slider position: stated t <= sliderT, plus every time-unknown case. */
  cases: Case[];
  /** true when no visible case in this region has a stated time. */
  unknownOnly: boolean;
  /** Cases stated in the other unit; listed in the drawer, never placed on the slider. */
  otherUnit: Case[];
}

/** One pin per region. Cases with t !== null appear at or after t; t === null cases are present from 0. */
export function pinsFor(dossier: Dossier, sliderT: number): Pin[] {
  const byRegion = new Map<Region, Pin>();
  for (const c of dossier.cases) {
    const pin = byRegion.get(c.region) ?? { region: c.region, cases: [], unknownOnly: true, otherUnit: [] };
    byRegion.set(c.region, pin);
    if (c.unitStated && c.unitStated !== dossier.axis) {
      pin.otherUnit.push(c);
      continue;
    }
    if (c.t === null) pin.cases.push(c);
    else if (c.t <= sliderT) {
      pin.cases.push(c);
      pin.unknownOnly = false;
    }
  }
  return [...byRegion.values()].filter((p) => p.cases.length > 0 || p.otherUnit.length > 0);
}
