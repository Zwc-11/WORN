import { describe, expect, it } from 'vitest';
import { pinsFor } from './pinsFor';
import type { Case, Dossier } from '../data/contract';

const mk = (id: string, region: Case['region'], t: number | null, unitStated?: Case['unitStated']): Case => ({
  id, region, t, unitStated, type: 'pilling', quote: '[sample]',
  source: { site: 'amazon', url: 'https://example.com', date: '2025-01-01' },
});

const dossier: Dossier = {
  productId: 'p', axis: 'washes', reviewsRead: 10, reviewsWithPhotos: 1, sample: true, updatedAt: '2026-10-17',
  cases: [mk('a', 'armpit', 10), mk('b', 'armpit', null), mk('c', 'cuffs', 25), mk('d', 'collar', null, 'months')],
  counts: { byType: { pilling: 4, fading: 0, collar_deform: 0, cuff_wear: 0, seam_split: 0, print_crack: 0 },
            byRegion: { collar: 1, cuffs: 1, armpit: 2, hem: 0, seams: 0, chest_print: 0 } },
};

describe('pinsFor', () => {
  it('shows time-unknown cases from t=0 and stated ones at or after t', () => {
    const at0 = pinsFor(dossier, 0);
    const armpit = at0.find((p) => p.region === 'armpit')!;
    expect(armpit.cases.map((c) => c.id)).toEqual(['b']);
    expect(armpit.unknownOnly).toBe(true);
    expect(at0.find((p) => p.region === 'cuffs')).toBeUndefined();
    const at10 = pinsFor(dossier, 10).find((p) => p.region === 'armpit')!;
    expect(at10.cases.map((c) => c.id)).toEqual(['a', 'b']);
    expect(at10.unknownOnly).toBe(false);
  });
  it('keeps other-unit cases off the slider but in the pin', () => {
    const collar = pinsFor(dossier, 99).find((p) => p.region === 'collar')!;
    expect(collar.cases).toEqual([]);
    expect(collar.otherUnit.map((c) => c.id)).toEqual(['d']);
  });
});
