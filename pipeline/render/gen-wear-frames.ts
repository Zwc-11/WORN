// Generate the aged garment stills for one product with Decart lucy-image-2.
//
// The same images serve two consumers:
//   1. A's GarmentStage cross-fades them (Frames, P0/P1 path);
//   2. the live try-on swaps them in as the VTON reference image per slider stage (C's live path).
//
// Usage (from repo root):
//   npm run frames -- --product sample-hoodie --dry-run          # prompts + cost, no key, no calls
//   npm run frames -- --product sample-hoodie                    # 3 variants per stage, picks v0
//   npm run frames -- --product sample-hoodie --variants 2 --max 4 --resolution 480p
//   npm run frames -- --product sample-hoodie --person me.jpg    # frozen-person stills (after flats exist)
//   npm run frames -- --product patagonia-25523 --test           # GATE TEST wear (fixed spec, not evidence)
//   npm run frames -w pipeline -- ... is the same thing.
// Then review variants in the lab (http://localhost:5173/lab.html, "Stills" tab) and pick:
//   npm run pick -w pipeline -- --product sample-hoodie --pick 12=2,20=1

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDecartClient, models } from '@decartai/sdk';
import type { Axis } from '../../web/src/data/contract.ts';
import { activeWear, basedOn, pickStages, type WearItem } from '../../web/src/render/wear/composeWear.ts';
import { flatEditPrompt, personEditPrompt } from '../../web/src/render/wear/prompts.ts';
import { TEST_AXIS, TEST_STAGES, testWearAt } from '../../web/src/render/wear/testWear.ts';
import {
  args,
  extFor,
  fileBlob,
  FIXTURES_DIR,
  framesFrom,
  loadDossier,
  loadFrames,
  loadGarment,
  loadProduct,
  pathToUrl,
  pool,
  testFramesFrom,
  urlToPath,
  withRetry,
  writeJson,
} from './lib.ts';

const a = args();
const productId = typeof a.product === 'string' ? a.product : '';
if (!productId) {
  console.error('usage: npm run frames -- --product <id> [--dry-run] [--test] [--variants 3] [--max 5] [--stages 0,6,12] [--resolution 720p|480p] [--person photo.jpg]');
  process.exit(2);
}
const dry = a['dry-run'] === true;
const test = a.test === true;
const variants = Math.max(1, Number(a.variants ?? 3));
const resolution = a.resolution === '480p' ? '480p' : '720p';
const pricePerImage = resolution === '480p' ? 0.01 : 0.02; // docs pricing page, Oct 2026
const concurrency = Math.max(1, Number(a.concurrency ?? 3));

const product = loadProduct(productId);
const garment = loadGarment(product);
const flatUrl = product.image.flat ?? product.image.hero;
if (!/^https?:/.test(flatUrl) && !existsSync(urlToPath(flatUrl))) throw new Error(`product photo not found: ${urlToPath(flatUrl)}`);

// Where the wear comes from: owner evidence (dossier) or the fixed gate-test spec.
interface WearSource {
  label: string;
  axis: Axis;
  stages: number[];
  wearAt: (t: number) => WearItem[];
  dir: string;
  framesFile: string;
  frames: (stages: { t: number; image: string }[]) => ReturnType<typeof testFramesFrom>;
}
function evidenceSource(): WearSource {
  const dossier = loadDossier(productId);
  if (dossier.axis === null) throw new Error(`${productId}: no case states a time, so there is nothing to age on a slider. Use --test for the capability gate.`);
  const stages =
    typeof a.stages === 'string' ? a.stages.split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0) : pickStages(dossier, Number(a.max ?? 5));
  if (stages[0] !== 0) stages.unshift(0);
  return {
    label: `owner evidence (${dossier.cases.length} cases${dossier.sample ? ', sample data' : ''})`,
    axis: dossier.axis,
    stages,
    wearAt: (t) => activeWear(dossier, t),
    dir: resolve(FIXTURES_DIR, 'stills', productId),
    framesFile: `${productId}.frames.json`,
    frames: (st) => framesFrom(product, dossier, st, garment),
  };
}
function testSource(): WearSource {
  return {
    label: 'GATE TEST WEAR (fixed spec, not evidence)',
    axis: TEST_AXIS,
    stages: [0, ...TEST_STAGES.map((s) => s.t)],
    wearAt: testWearAt,
    dir: resolve(FIXTURES_DIR, 'stills', productId, 'test'),
    framesFile: `${productId}.test-frames.json`,
    frames: (st) => testFramesFrom(productId, st),
  };
}
const source = test ? testSource() : evidenceSource();

if (!dry && !process.env.DECART_API_KEY) {
  console.error('DECART_API_KEY is not set. Put it in .env at the repo root (see .env.example), or run with --dry-run.');
  process.exit(2);
}
const client = dry ? null : createDecartClient({ apiKey: process.env.DECART_API_KEY });
const varDir = resolve(source.dir, 'variants');

async function edit(prompt: string, data: Blob | string, seed: number, reference?: Blob | string): Promise<Blob> {
  return withRetry(`seed ${seed}`, () =>
    client!.process({
      model: models.image('lucy-image-2'),
      prompt,
      data,
      ...(reference ? { reference_image: reference } : {}),
      seed,
      resolution,
      enhance_prompt: false,
    }),
  );
}

const src = (url: string) => (/^https?:/.test(url) ? url : fileBlob(urlToPath(url)));

async function flats() {
  const plan = source.stages
    .filter((t) => t > 0)
    .map((t) => ({ t, wear: source.wearAt(t) }))
    .filter((s) => s.wear.length > 0)
    .map((s) => {
      const p = flatEditPrompt({ garment, color: product.color, wear: s.wear, axis: source.axis, t: s.t });
      return { ...s, prompt: p.text, used: p.used };
    });

  console.log(`\n${product.brand} ${product.name}  (${productId}, axis: ${source.axis})`);
  console.log(`wear source: ${source.label}`);
  console.log(`garment: ${garment.noun} · ${garment.description}${garment.styling ? ` · ${garment.styling}` : ''}`);
  console.log(`stages: ${[0, ...plan.map((p) => p.t)].join(' · ')} ${source.axis}   (stage 0 = product photo, not generated)`);
  for (const p of plan) {
    console.log(`\n  t=${p.t}  composed from ${basedOn(p.used).length} owner reports`);
    for (const w of p.wear)
      console.log(`    ${p.used.includes(w) ? '•' : '-'} ${w.type}@${w.region}  sev ${w.severity}  ${w.reached}/${w.dated} dated owners reached${p.used.includes(w) ? '' : '  (not drawn: prompt budget)'}`);
    console.log(`    prompt: ${p.prompt}`);
  }
  if (plan.length === 0) throw new Error('no stage has wear to draw');
  const calls = plan.length * variants;
  console.log(`\n${calls} lucy-image-2 calls at ${resolution} ≈ $${(calls * pricePerImage).toFixed(2)}`);
  if (dry) return;

  mkdirSync(varDir, { recursive: true });
  const data = src(flatUrl);
  const index: { t: number; prompt: string; files: string[]; basedOn: number }[] = [];
  const started = Date.now();
  for (const p of plan) {
    const results = await pool(
      concurrency,
      Array.from({ length: variants }, (_, v) => async () => {
        const t0 = Date.now();
        const blob = await edit(p.prompt, data, 1000 + p.t * 10 + v);
        const file = resolve(varDir, `${p.t}-v${v}${extFor(blob.type)}`);
        writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
        console.log(`  t=${p.t} v${v}  ${((Date.now() - t0) / 1000).toFixed(1)} s  -> ${pathToUrl(file)}`);
        return pathToUrl(file);
      }),
    );
    const files = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    for (const r of results) if (r.status === 'rejected') console.error(`  t=${p.t} variant failed:`, (r.reason as Error)?.message ?? r.reason);
    if (files.length === 0) throw new Error(`every variant failed for t=${p.t}; ${source.framesFile} not written`);
    index.push({ t: p.t, prompt: p.prompt, files, basedOn: basedOn(p.used).length });
  }
  writeJson(resolve(varDir, 'index.json'), { productId, axis: source.axis, resolution, test, generatedAt: new Date().toISOString(), stages: index });

  // default pick: first successful variant of each stage; change with `npm run pick`
  const picked = index.map((s) => {
    const from = urlToPath(s.files[0]);
    const to = resolve(source.dir, `${s.t}${from.slice(from.lastIndexOf('.'))}`);
    copyFileSync(from, to);
    return { t: s.t, image: pathToUrl(to) };
  });
  const frames = source.frames([{ t: 0, image: flatUrl }, ...picked]);
  writeJson(resolve(FIXTURES_DIR, source.framesFile), frames);
  console.log(`\nwrote fixtures/${source.framesFile} (${frames.stages.length} stages) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.log(`review variants in the lab "Stills" tab${test ? ' (gate test wear on)' : ''}, then: npm run pick -w pipeline -- --product ${productId}${test ? ' --test' : ''} --pick <t>=<v>,...`);
}

async function person(photo: string) {
  if (test) throw new Error('--person uses owner evidence; run it without --test');
  const dossier = loadDossier(productId);
  const frames = loadFrames(productId);
  if (!frames || frames.stages.length < 2) throw new Error('generate the aged flats first (run without --person)');
  // npm runs workspace scripts inside pipeline/; INIT_CWD is where you typed the command
  const photoPath = resolve(process.env.INIT_CWD ?? process.cwd(), photo);
  if (!existsSync(photoPath)) throw new Error(`person photo not found: ${photoPath}`);
  const pdir = resolve(FIXTURES_DIR, 'stills', productId, 'person');
  mkdirSync(resolve(pdir, 'variants'), { recursive: true });
  const personBlob = fileBlob(photoPath);
  const promptAt = (t: number) => personEditPrompt({ garment, color: product.color, wear: activeWear(dossier, t), axis: frames.axis, t }).text;
  console.log(`person stills: ${frames.stages.length} stages × ${variants} variants ≈ $${(frames.stages.length * variants * pricePerImage).toFixed(2)}`);
  for (const s of frames.stages) console.log(`  t=${s.t}: ${promptAt(s.t)}`);
  if (dry) return;
  const picked: { t: number; image: string }[] = [];
  for (const s of frames.stages) {
    const results = await pool(
      concurrency,
      Array.from({ length: variants }, (_, v) => async () => {
        const blob = await edit(promptAt(s.t), personBlob, 5000 + s.t * 10 + v, src(s.image));
        const file = resolve(pdir, 'variants', `${s.t}-v${v}${extFor(blob.type)}`);
        writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
        console.log(`  t=${s.t} v${v} -> ${pathToUrl(file)}`);
        return file;
      }),
    );
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (ok.length === 0) throw new Error(`every person variant failed for t=${s.t}`);
    const to = resolve(pdir, `${s.t}${ok[0].slice(ok[0].lastIndexOf('.'))}`);
    copyFileSync(ok[0], to);
    picked.push({ t: s.t, image: pathToUrl(to) });
  }
  writeJson(resolve(FIXTURES_DIR, `${productId}.person.frames.json`), framesFrom(product, dossier, picked, garment));
  console.log(`wrote fixtures/${productId}.person.frames.json`);
}

(typeof a.person === 'string' ? person(a.person) : flats()).catch((e) => {
  const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
  console.error('\nFAILED:', msg);
  process.exit(1);
});
