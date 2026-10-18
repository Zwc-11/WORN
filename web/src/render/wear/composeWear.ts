// Pure functions that turn owner cases into "what wear is visible at slider value t".
// Shared by the live try-on (prompts + reference swap), the stills pipeline and the lab.
// No I/O, no randomness: same dossier + same t => same output. Unit-tested in composeWear.test.ts.
//
// Honesty rules (from Plan v2), enforced here so no caller can break them:
//  - wear exists only where an owner reported it, at or after the time the owner stated;
//  - cases with t === null ("time unknown") or stated in the other unit never drive the render;
//  - fewer than MIN_CASES cases => nothing is drawn (the "insufficient evidence" state);
//  - severity comes from how many owners reported it by t, never from a model or a rate.

import type { Axis, Case, DamageType, Dossier, Region } from '../../data/contract';

export const MIN_CASES = 3; // Plan v2: "Insufficient evidence: fewer than 3 cases"

export type Severity = 0 | 1 | 2; // light | clear | heavy

export interface WearItem {
  type: DamageType;
  region: Region;
  severity: Severity;
  reached: number; // owners whose stated time is <= t
  dated: number; // owners in this type+region who stated a time on this axis
  caseIds: string[]; // the reached cases: what this item is "based on"
  firstT: number; // earliest stated time in the group
}

const TYPE_ORDER: DamageType[] = ['fading', 'pilling', 'cuff_wear', 'collar_deform', 'print_crack', 'seam_split'];

/** Cases that may drive the render: a stated time on the dossier's own axis. */
export function datedCases(d: Dossier): Case[] {
  if (d.axis === null) return [];
  return d.cases.filter((c) => c.t !== null && c.unitStated === undefined);
}

export function canRenderWear(d: Dossier): boolean {
  return d.axis !== null && d.cases.length >= MIN_CASES && datedCases(d).length > 0;
}

/**
 * Severity grows with the number of owners who reported this wear by t, and with the share of
 * this group's dated reports already reached. min() of both, so one owner alone never draws
 * "heavy" wear, and an early report alone never draws the late-stage look.
 */
export function severityOf(reached: number, dated: number): Severity {
  const frac = dated === 0 ? 0 : reached / dated;
  const byShare: Severity = frac < 1 / 3 ? 0 : frac < 2 / 3 ? 1 : 2;
  const byCount: Severity = reached >= 4 ? 2 : reached >= 2 ? 1 : 0;
  return Math.min(byShare, byCount) as Severity;
}

/** Wear visible at slider value t, strongest first. Empty when the dossier can't support a render. */
export function activeWear(d: Dossier, t: number): WearItem[] {
  if (!canRenderWear(d)) return [];
  const groups = new Map<string, Case[]>();
  for (const c of datedCases(d)) {
    const k = `${c.type}:${c.region}`;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const items: WearItem[] = [];
  for (const g of groups.values()) {
    const reached = g.filter((c) => (c.t as number) <= t + 1e-9);
    if (reached.length === 0) continue;
    items.push({
      type: g[0].type,
      region: g[0].region,
      severity: severityOf(reached.length, g.length),
      reached: reached.length,
      dated: g.length,
      caseIds: reached.map((c) => c.id).sort(),
      firstT: Math.min(...g.map((c) => c.t as number)),
    });
  }
  return items.sort(
    (a, b) =>
      b.reached - a.reached ||
      b.severity - a.severity ||
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      a.region.localeCompare(b.region),
  );
}

/**
 * Slider stages (t values) worth rendering: 0, then the times at which a new owner report is
 * reached, thinned to at most `max` stages by quantile so the last stage is the latest report.
 */
export function pickStages(d: Dossier, max = 5): number[] {
  if (max < 1) throw new Error('max must be >= 1');
  if (!canRenderWear(d)) return [0];
  const times = [...new Set(datedCases(d).map((c) => c.t as number))].filter((t) => t > 0).sort((a, b) => a - b);
  if (times.length <= max - 1) return [0, ...times];
  const k = max - 1;
  const picked: number[] = [];
  for (let i = 1; i <= k; i++) picked.push(times[Math.round((i * times.length) / k) - 1]);
  return [0, ...new Set(picked)];
}

/** Index of the stage to show at slider value t: the last stage whose t is <= the slider. */
export function stageIndexFor(stages: readonly { t: number }[], t: number): number {
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (stages[i].t <= t + 1e-9) idx = i;
  return idx;
}

export function axisWord(axis: Axis, t: number): string {
  if (axis === 'washes') return t === 1 ? 'wash' : 'washes';
  return t === 1 ? 'month' : 'months';
}

export function basedOn(items: WearItem[]): string[] {
  return [...new Set(items.flatMap((i) => i.caseIds))].sort();
}
