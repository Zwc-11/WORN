// Minimal stills stage for the lab and stage demo: two layered <img>, cross-faded by slider position.
// Stand-in for A's GarmentStage (same Frames input); the live stage takes A's component as `fallback`.
import type { Frames } from '../data/contract';

export function frameFor(frames: Frames, t: number): { a: string; b: string; mix: number } {
  const s = frames.stages;
  if (t <= s[0].t) return { a: s[0].image, b: s[0].image, mix: 0 };
  for (let i = 0; i < s.length - 1; i++) {
    if (t < s[i + 1].t) return { a: s[i].image, b: s[i + 1].image, mix: (t - s[i].t) / (s[i + 1].t - s[i].t) };
  }
  const last = s[s.length - 1].image;
  return { a: last, b: last, mix: 0 };
}

export function FrozenPreview({ frames, t, fallbackImage }: { frames: Frames | null; t: number; fallbackImage: string }) {
  const f = frames ? frameFor(frames, t) : { a: fallbackImage, b: fallbackImage, mix: 0 };
  const img: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' };
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <img src={f.a} alt="" style={img} />
      <img src={f.b} alt="" style={{ ...img, opacity: f.mix }} />
    </div>
  );
}
