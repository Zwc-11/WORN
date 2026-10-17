// Generates PLACEHOLDER stage illustrations as SVG. These stand in for C's lucy-image-2 stills.
// Replace the files in public/fixtures/stills/<id>/ with real WebP stills; frames.json paths stay the same.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const out = fileURLToPath(new URL('../public/fixtures/stills/', import.meta.url));

// Wear intensities per stage, 0..1. Keys match the taxonomy.
const PRODUCTS = {
  'amz-sample-hoodie': {
    base: '#1c1c1e', print: '#e8e2d6',
    stages: [
      { pilling: 0, fading: 0, cuff: 0, crack: 0 },
      { pilling: 0.35, fading: 0.08, cuff: 0, crack: 0 },
      { pilling: 0.7, fading: 0.4, cuff: 0.5, crack: 0.6 },
      { pilling: 1, fading: 0.65, cuff: 1, crack: 1 },
    ],
  },
  'uniqlo-sample-hoodie': {
    base: '#4a4a4f', print: null,
    stages: [
      { pilling: 0, fading: 0, cuff: 0, crack: 0 },
      { pilling: 0.3, fading: 0.05, cuff: 0, crack: 0 },
      { pilling: 0.7, fading: 0.15, cuff: 0.5, crack: 0 },
    ],
  },
  'zara-sample-hoodie': { base: '#d9cfbd', print: null, stages: [{ pilling: 0, fading: 0, cuff: 0, crack: 0 }] },
};

function mix(hex, target, k) {
  const a = hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = target.match(/\w\w/g).map((h) => parseInt(h, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

// Deterministic pseudo-random for pills.
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

function pills(cx, cy, rx, ry, n, color, seed) {
  const r = rng(seed); let s = '';
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    s += `<circle cx="${(cx + Math.cos(a) * rx * d).toFixed(1)}" cy="${(cy + Math.sin(a) * ry * d).toFixed(1)}" r="${(2 + r() * 3).toFixed(1)}" fill="${color}" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
  }
  return s;
}

function fray(x, y, w, k, color, seed) {
  const r = rng(seed); let s = '';
  const n = Math.round(k * 14);
  for (let i = 0; i < n; i++) {
    const px = x + r() * w;
    s += `<path d="M${px.toFixed(1)} ${y} l${(r() * 6 - 3).toFixed(1)} ${(6 + r() * 14).toFixed(1)}" stroke="${color}" stroke-width="1.6" fill="none" opacity="0.9"/>`;
  }
  return s;
}

function cracks(x, y, w, h, k, seed) {
  const r = rng(seed); let s = '';
  const n = Math.round(k * 9);
  for (let i = 0; i < n; i++) {
    const px = x + r() * w, py = y + r() * h;
    s += `<path d="M${px.toFixed(1)} ${py.toFixed(1)} l${(r() * 40 - 20).toFixed(1)} ${(r() * 30 - 15).toFixed(1)} l${(r() * 40 - 20).toFixed(1)} ${(r() * 30 - 15).toFixed(1)}" stroke="#1c1c1e" stroke-width="2" fill="none" opacity="${(0.6 + 0.4 * k).toFixed(2)}"/>`;
  }
  return s;
}

function svg(cfg, st) {
  const body = mix(cfg.base, '#8a8a8e', st.fading * 0.9);
  const collarFill = mix(cfg.base, '#9a9a9e', st.fading);
  const pillColor = mix(cfg.base, '#f3f0ea', 0.55);
  const W = 1200, H = 1600;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#F3F0EA"/>
<g stroke="#141414" stroke-width="3" stroke-linejoin="round">
  <!-- sleeves -->
  <path d="M330 640 L120 1000 L190 1180 L330 1130 L420 820 Z" fill="${body}"/>
  <path d="M870 640 L1080 1000 L1010 1180 L870 1130 L780 820 Z" fill="${body}"/>
  <!-- body -->
  <path d="M330 640 Q600 560 870 640 L870 1240 Q600 1280 330 1240 Z" fill="${body}"/>
  <!-- hood -->
  <path d="M400 640 Q380 360 600 300 Q820 360 800 640 Q600 700 400 640 Z" fill="${collarFill}"/>
  <path d="M470 630 Q500 470 600 450 Q700 470 730 630" fill="#F3F0EA" stroke="#141414"/>
  <!-- hem band -->
  <path d="M330 1200 Q600 1240 870 1200 L870 1240 Q600 1280 330 1240 Z" fill="${mix(body, '#141414', 0.15)}"/>
  <!-- cuffs -->
  <path d="M120 1000 L190 1180 L250 1160 L185 985 Z" fill="${mix(body, '#141414', 0.15)}"/>
  <path d="M1080 1000 L1010 1180 L950 1160 L1015 985 Z" fill="${mix(body, '#141414', 0.15)}"/>
  <!-- kangaroo pocket -->
  <path d="M430 1000 L770 1000 L740 1180 L460 1180 Z" fill="none" stroke-opacity="0.5"/>
  <!-- drawstrings -->
  <path d="M570 640 L560 820 M630 640 L640 820" fill="none" stroke-opacity="0.8"/>
</g>
${cfg.print ? `<rect x="470" y="720" width="260" height="140" rx="6" fill="${mix(cfg.print, body, st.fading * 0.3)}" opacity="${(1 - st.crack * 0.2).toFixed(2)}"/>` : ''}
${cfg.print && st.crack > 0 ? cracks(470, 720, 260, 140, st.crack, 7) : ''}
${st.pilling > 0 ? pills(360, 700, 60, 90, Math.round(st.pilling * 70), pillColor, 3) + pills(840, 700, 60, 90, Math.round(st.pilling * 70), pillColor, 5) : ''}
${st.cuff > 0 ? fray(130, 1178, 110, st.cuff, pillColor, 11) + fray(960, 1178, 110, st.cuff, pillColor, 13) : ''}
<text x="40" y="1560" font-family="monospace" font-size="28" fill="#141414" opacity="0.6">PLACEHOLDER ILLUSTRATION · not a photo</text>
</svg>`;
}

for (const [id, cfg] of Object.entries(PRODUCTS)) {
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  cfg.stages.forEach((st, i) => writeFileSync(join(dir, `stage-${i}.svg`), svg(cfg, st)));
}

// Placeholder "owner photos": clearly labelled, never styled as real photos.
const photoDir = join(out, 'sample-photos');
mkdirSync(photoDir, { recursive: true });
const photos = [
  ['photo-1', 900, 1200, 'pilling, underarm'], ['photo-2', 1200, 900, 'pilling, sleeve seam'],
  ['photo-3', 900, 1200, 'fading, collar'], ['photo-4', 1200, 900, 'fraying, cuff'],
];
for (const [name, w, h, label] of photos) {
  writeFileSync(join(photoDir, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="#e6e1d8"/>
<rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="#141414" stroke-width="3" stroke-dasharray="14 10"/>
<text x="${w / 2}" y="${h / 2 - 10}" text-anchor="middle" font-family="monospace" font-size="40" fill="#141414">SAMPLE PHOTO</text>
<text x="${w / 2}" y="${h / 2 + 44}" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#141414" opacity="0.7">${label}</text>
</svg>`);
}
console.log('stills written to', out);
