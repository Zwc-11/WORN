// Choose which generated variant each stage uses, then rewrite <id>.frames.json.
//   npm run pick -w pipeline -- --product sample-hoodie --pick 12=2,20=1
//   npm run pick -w pipeline -- --product sample-hoodie --person --pick 0=1
//   npm run pick -w pipeline -- --product patagonia-25523 --test --pick 10=2
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { args, FIXTURES_DIR, framesFrom, loadDossier, loadFrames, loadGarment, loadProduct, pathToUrl, testFramesFrom, writeJson } from './lib.ts';

const a = args();
const id = typeof a.product === 'string' ? a.product : '';
const pick = typeof a.pick === 'string' ? a.pick : '';
if (!id || !pick) {
  console.error('usage: npm run pick -w pipeline -- --product <id> --pick <t>=<variant>[,<t>=<variant>...] [--person]');
  process.exit(2);
}
const isPerson = a.person === true;
const isTest = a.test === true;
const kind = isTest ? 'test-frames' : isPerson ? 'person.frames' : 'frames';
const frames = loadFrames(id, kind);
if (!frames) throw new Error(`no fixtures/${id}.${kind}.json yet; run npm run frames first`);
const dir = resolve(FIXTURES_DIR, 'stills', id, ...(isPerson ? ['person'] : isTest ? ['test'] : []));
const varDir = resolve(dir, 'variants');
const files = existsSync(varDir) ? readdirSync(varDir) : [];

const chosen = new Map(pick.split(',').map((kv) => kv.split('=').map(Number) as [number, number]));
const stages = frames.stages.map((s) => {
  const v = chosen.get(s.t);
  if (v === undefined) return { t: s.t, image: s.image };
  const f = files.find((n) => n.startsWith(`${s.t}-v${v}.`));
  if (!f) throw new Error(`no variant ${v} for t=${s.t} in ${varDir}`);
  const to = resolve(dir, `${s.t}${f.slice(f.lastIndexOf('.'))}`);
  copyFileSync(resolve(varDir, f), to);
  console.log(`t=${s.t}: v${v}`);
  return { t: s.t, image: pathToUrl(to) };
});
const product = loadProduct(id);
writeJson(resolve(FIXTURES_DIR, `${id}.${kind}.json`), isTest ? testFramesFrom(id, stages) : framesFrom(product, loadDossier(id), stages, loadGarment(product)));
console.log(`updated fixtures/${id}.${kind}.json`);
