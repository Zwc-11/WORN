// Validate every fixture against the contract (Plan v2: `npm run check:fixtures`).
// Also checks that every image a Frames file points at exists, and that basedOn matches the dossier.
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DossierSchema, FramesSchema, ProductSchema } from '../../web/src/data/contract.ts';
import { FIXTURES_DIR, loadGarment, readJson, stageBasedOn, urlToPath } from './lib.ts';

let bad = 0;
const fail = (m: string) => {
  bad++;
  console.error('  ✗ ' + m);
};
const products = readJson<unknown[]>(resolve(FIXTURES_DIR, 'products.json'));
for (const raw of products) {
  const r = ProductSchema.safeParse(raw);
  if (!r.success) {
    fail(`products.json: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  const p = r.data;
  console.log(`${p.id}`);
  for (const u of [p.image.hero, p.image.flat].filter(Boolean) as string[])
    if (!/^https?:/.test(u) && !existsSync(urlToPath(u))) fail(`${p.id}: image missing ${u}`);
}
for (const f of readdirSync(FIXTURES_DIR)) {
  const path = resolve(FIXTURES_DIR, f);
  if (f.endsWith('.dossier.json')) {
    const r = DossierSchema.safeParse(readJson(path));
    if (!r.success) fail(`${f}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    else console.log(`  ✓ ${f} (${r.data.cases.length} cases, axis ${r.data.axis}, sample ${r.data.sample})`);
  }
  if (f.endsWith('.test-frames.json')) {
    const r = FramesSchema.safeParse(readJson(path));
    if (!r.success) fail(`${f}: ${r.error.issues.map((i) => i.message).join('; ')}`);
    else if (r.data.stages.some((s) => s.basedOn.length > 0)) fail(`${f}: test frames must have basedOn [] (test wear is not evidence)`);
    else console.log(`  ✓ ${f} (gate test, ${r.data.stages.length} stages)`);
    continue;
  }
  if (f.endsWith('.frames.json')) {
    const r = FramesSchema.safeParse(readJson(path));
    if (!r.success) {
      fail(`${f}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }
    for (const s of r.data.stages) if (!/^https?:/.test(s.image) && !existsSync(urlToPath(s.image))) fail(`${f}: t=${s.t} image missing ${s.image}`);
    const dPath = resolve(FIXTURES_DIR, `${r.data.productId}.dossier.json`);
    if (existsSync(dPath)) {
      const d = DossierSchema.parse(readJson(dPath));
      const prod = ProductSchema.parse((products as { id?: string }[]).find((p) => p.id === r.data.productId));
      const garment = loadGarment(prod);
      for (const s of r.data.stages) {
        const want = stageBasedOn(d, s.t, prod, garment);
        if (JSON.stringify(want) !== JSON.stringify(s.basedOn)) fail(`${f}: t=${s.t} basedOn ${JSON.stringify(s.basedOn)} != dossier ${JSON.stringify(want)}`);
      }
    }
    console.log(`  ✓ ${f} (${r.data.stages.length} stages)`);
  }
}
if (bad) {
  console.error(`\n${bad} problem(s)`);
  process.exit(1);
}
console.log('\nall fixtures valid');
