import { describe, expect, it } from 'vitest';
import { frameFor, stageIndexFor } from './frameFor';
import type { Frames } from '../data/contract';

const frames: Frames = {
  productId: 'p', axis: 'washes', generated: true, label: 'illustration',
  stages: [
    { t: 0, image: 's0', basedOn: [] },
    { t: 10, image: 's1', basedOn: ['c1'] },
    { t: 25, image: 's2', basedOn: ['c2', 'c1'] },
  ],
};

describe('frameFor', () => {
  it('sits between the two nearest stages', () => {
    expect(frameFor(frames, 5)).toMatchObject({ a: 's0', b: 's1', mix: 0.5 });
    expect(frameFor(frames, 20)).toMatchObject({ a: 's1', b: 's2' });
    expect(frameFor(frames, 20).mix).toBeCloseTo(10 / 15);
  });
  it('clamps at the ends', () => {
    expect(frameFor(frames, 0)).toMatchObject({ a: 's0', b: 's1', mix: 0 });
    expect(frameFor(frames, 99)).toMatchObject({ a: 's2', b: 's2', mix: 0 });
  });
  it('handles a single stage (photo only)', () => {
    const one: Frames = { ...frames, stages: [frames.stages[0]] };
    expect(frameFor(one, 12)).toMatchObject({ a: 's0', b: 's0', mix: 0 });
  });
  it('unions basedOn of passed stages without duplicates', () => {
    expect(frameFor(frames, 30).basedOn).toEqual(['c1', 'c2']);
    expect(frameFor(frames, 3).basedOn).toEqual([]);
  });
});

describe('stageIndexFor', () => {
  it('returns the stage at or before t, clamped', () => {
    expect(stageIndexFor(frames, 0)).toBe(0);
    expect(stageIndexFor(frames, 9.9)).toBe(0);
    expect(stageIndexFor(frames, 10)).toBe(1);
    expect(stageIndexFor(frames, 24)).toBe(1);
    expect(stageIndexFor(frames, 25)).toBe(2);
    expect(stageIndexFor(frames, 99)).toBe(2);
  });
  it('is 0 for a single stage', () => {
    expect(stageIndexFor({ ...frames, stages: [frames.stages[0]] }, 50)).toBe(0);
  });
});
