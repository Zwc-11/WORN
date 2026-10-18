// npm run check:fixtures — validates every fixture against the zod schemas and cross-checks ids and counts.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DossierSchema, FramesSchema, ProductListSchema, DAMAGE_TYPES, REGIONS, type Dossier } from '../src/data/contract.ts';

const root = fileURLToPath(new URL('../public/fixtures/', import.meta.url));
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
let errors = 0;
const fail = (m: string) => { errors++; console.error('✗', m); };
const assetExists = (p: string, where: string) => { if (p.startsWith('/') && !existsSync(join(pub, p))) fail(`${where}: missing asset ${p}`); };

const products = ProductListSchema.parse(read('products.json'));
const ids = new Set(products.map((p) => p.id));
for (const p of products) assetExists(p.image.hero, `product ${p.id}`);

for (const f of readdirSync(root).filter((f) => f.endsWith('.dossier.json'))) {
  const d: Dossier = DossierSchema.parse(read(f));
  if (!ids.has(d.productId)) fail(`${f}: unknown productId ${d.productId}`);
  const product = products.find((p) => p.id === d.productId);
  if (product?.evidence === 'none') fail(`${f}: product has evidence 'none' but a dossier exists`);
  const caseIds = new Set<string>();
  for (const c of d.cases) {
    if (caseIds.has(c.id)) fail(`${f}: duplicate case id ${c.id}`);
    caseIds.add(c.id);
    if (c.unitStated && c.unitStated === d.axis) fail(`${f}: case ${c.id} unitStated equals dossier.axis`);
    if (c.unitStated && c.t !== null) fail(`${f}: case ${c.id} has t but unitStated differs; t must be null`);
    if (d.axis === null && c.t !== null) fail(`${f}: case ${c.id} has t but dossier.axis is null`);
    if (d.sample && !c.quote.startsWith('[sample]') && !c.source.url.startsWith('https://www.')) fail(`${f}: case ${c.id} sample quote must start with "[sample]" unless copied from a real review URL`);
    if (c.photo) assetExists(c.photo.url, `${f} case ${c.id}`);
  }
  for (const t of DAMAGE_TYPES) { const n = d.cases.filter((c) => c.type === t).length; if (d.counts.byType[t] !== n) fail(`${f}: counts.byType.${t}=${d.counts.byType[t]} but ${n} cases`); }
  for (const r of REGIONS) { const n = d.cases.filter((c) => c.region === r).length; if (d.counts.byRegion[r] !== n) fail(`${f}: counts.byRegion.${r}=${d.counts.byRegion[r]} but ${n} cases`); }
  if (d.reviewsWithPhotos > d.reviewsRead) fail(`${f}: reviewsWithPhotos > reviewsRead`);

  const ff = f.replace('.dossier.json', '.frames.json');
  if (existsSync(join(root, ff))) {
    const fr = FramesSchema.parse(read(ff));
    if (fr.productId !== d.productId) fail(`${ff}: productId mismatch`);
    if (d.axis && fr.axis !== d.axis) fail(`${ff}: axis ${fr.axis} differs from dossier axis ${d.axis}`);
    if (fr.stages[0].t !== 0) fail(`${ff}: stage 0 must have t=0 (the product photo)`);
    if (product && fr.stages[0].image !== product.image.hero) fail(`${ff}: stage 0 image should equal product.image.hero`);
    fr.stages.forEach((s, i) => {
      if (i > 0 && s.t <= fr.stages[i - 1].t) fail(`${ff}: stages not ascending at index ${i}`);
      assetExists(s.image, `${ff} stage ${i}`);
      for (const id of s.basedOn) if (!caseIds.has(id)) fail(`${ff}: stage ${i} basedOn unknown case ${id}`);
    });
  }
}
console.log(errors ? `${errors} problem(s)` : `✓ fixtures valid: ${products.length} products`);
process.exit(errors ? 1 : 0);
