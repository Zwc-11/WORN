import { describe, expect, it } from 'vitest';
import { fitFor, SIZES } from './fit';

describe('fitFor', () => {
  it('own size adds nothing to the prompt', () => {
    for (const s of SIZES) expect(fitFor(s, s).phrase).toBe('');
  });
  it('two sizes up is oversized with long sleeves', () => {
    const f = fitFor('M', 'XL');
    expect(f.chestDelta).toBe(7);
    expect(f.armDelta).toBe(2);
    expect(f.phrase).toContain('as a size XL on a size M body');
    expect(f.phrase).toContain('oversized and baggy');
    expect(f.phrase).toContain('covering the hands');
  });
  it('one size up is roomy with slightly long sleeves', () => {
    const f = fitFor('M', 'L');
    expect(f.body).toContain('loose and roomy');
    expect(f.sleeves).toContain('slightly long');
  });
  it('sizes down are snug or tight with short sleeves', () => {
    expect(fitFor('M', 'S').body).toContain('snug');
    expect(fitFor('M', 'S').sleeves).toContain('a little short');
    expect(fitFor('L', 'XS').body).toContain('very tight');
    expect(fitFor('L', 'XS').sleeves).toContain('too short');
  });
  it('fit only ever grows with the size tried', () => {
    const order = SIZES.map((s) => fitFor('M', s).chestDelta);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });
});
