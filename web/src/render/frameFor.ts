import type { Frames } from '../data/contract';

export interface FramePair {
  a: string;
  b: string;
  /** 0 = show a, 1 = show b. */
  mix: number;
  /** Case ids the visible wear is composed from (union of stages at or before t). */
  basedOn: string[];
}

/** Find the two stages around t and how far t sits between them. Works with 1..n stages. */
export function frameFor(frames: Frames, t: number): FramePair {
  const s = frames.stages;
  if (s.length === 1) return { a: s[0].image, b: s[0].image, mix: 0, basedOn: s[0].basedOn };
  let i = 0;
  while (i < s.length - 1 && s[i + 1].t <= t) i++;
  const a = s[i];
  const b = s[Math.min(i + 1, s.length - 1)];
  const span = b.t - a.t;
  const mix = span <= 0 ? 0 : clamp((t - a.t) / span, 0, 1);
  const basedOn = [...new Set(s.filter((st) => st.t <= t).flatMap((st) => st.basedOn))];
  return { a: a.image, b: b.image, mix, basedOn };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
