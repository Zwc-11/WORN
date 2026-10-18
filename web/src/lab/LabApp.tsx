// WORN render lab: the gate-test harness for lane C. Internal tool; shows every internal on purpose.
//   Live tab   -> try VTON vs lucy-2.5, reference-swap vs prompt-only, on your own webcam; record clips.
//   Stills tab -> review the lucy-image-2 variants and build the `npm run pick` command.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dossier, Frames, Product } from '../data/contract';
import { stageIndexFor } from '../render/wear/composeWear';
import { planTryOn } from '../render/wear/plan';
import { describeGarment, wearPhrase } from '../render/wear/prompts';
import { lookFor, preloadFor, type TextMode } from '../render/live/look';
import { fitFor, SIZES, type Size } from '../render/wear/fit';
import { describeVideo, type ModelChoice, type Strategy } from '../render/live/types';
import { CAMERA_HELP, useTryOn } from '../render/live/useTryOn';
import { DecartTryOn } from '../render/live/DecartTryOn';
import { cleanGarment, type CleanResult } from './imageTools';
import { apiConfigured, loadBundle, loadGarmentOverrides, loadProducts, loadTestFrames, loadVariants, type VariantIndex } from './fixtures';
import { planTest } from '../render/wear/testWear';
import type { GarmentOverride } from '../render/wear/prompts';
import './lab.css';

const PRICE_PER_S = 0.02;
const GATES = [
  'Hoodie appears on me within 10 s of Start',
  'Holds for 10 s while I turn side to side',
  'Last stage shows the wear (fading / pilling / cuffs)',
  'Face, hair and background unchanged',
  'Stage switch looks right within ~1 s of releasing the slider',
  'Fit: at XL (you wear M) the sleeves reach the knuckles and the body hangs looser than at M',
  'Fit: at S/XS the sleeves end above the wrists',
];

export function LabApp() {
  const [tab, setTab] = useState<'live' | 'stills'>('live');
  const [products, setProducts] = useState<Product[]>([]);
  const [pid, setPid] = useState('');
  const [bundle, setBundle] = useState<{ dossier: Dossier | null; frames: Frames | null } | null>(null);
  const [keyOk, setKeyOk] = useState<boolean | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [overrides, setOverrides] = useState<Record<string, GarmentOverride> | null>(null);
  const [testWear, setTestWearState] = useState(new URLSearchParams(location.search).get('test') === '1');
  // Kept in the URL so a refresh stays in the same mode.
  const setTestWear = (on: boolean) => {
    setTestWearState(on);
    const u = new URL(location.href);
    if (on) u.searchParams.set('test', '1');
    else u.searchParams.delete('test');
    history.replaceState(null, '', u);
  };

  useEffect(() => {
    loadProducts()
      .then((p) => {
        setProducts(p);
        setPid(new URLSearchParams(location.search).get('product') ?? p[0]?.id ?? '');
      })
      .catch((e) => setLoadErr(String(e)));
    apiConfigured().then(setKeyOk);
    loadGarmentOverrides().then(setOverrides);
  }, []);
  useEffect(() => {
    if (!pid) return;
    setBundle(null);
    loadBundle(pid)
      .then(setBundle)
      .catch((e) => setLoadErr(String(e)));
  }, [pid]);

  const product = products.find((p) => p.id === pid);
  return (
    <div className="lab">
      <header className="lab__bar">
        <strong>WORN render lab</strong>
        <nav>
          <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
            Live
          </button>
          <button className={tab === 'stills' ? 'on' : ''} onClick={() => setTab('stills')}>
            Stills
          </button>
        </nav>
        <select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="product">
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} · {p.name}
            </option>
          ))}
        </select>
        <label className="lab__chk" title="Fixed wear spec for the capability gate. Not owner evidence; never used by the stage.">
          <input type="checkbox" checked={testWear} onChange={(e) => setTestWear(e.target.checked)} /> test wear (owner photos)
        </label>
        <span className={`pill ${keyOk ? 'ok' : 'bad'}`}>
          {keyOk === null ? 'token server not running (npm run dev starts it)' : keyOk ? 'Decart key set' : 'no DECART_API_KEY in .env'}
        </span>
      </header>
      {loadErr && <p className="lab__err">{loadErr}</p>}
      {testWear && <p className="lab__test">GATE TEST WEAR: fixed wear spec for the capability test, not owner evidence. Captions count 0 reports.</p>}
      {product && bundle && overrides && tab === 'live' && (
        <LiveTab
          key={product.id}
          product={product}
          dossier={bundle.dossier}
          frames={bundle.frames}
          keyOk={keyOk}
          override={overrides[product.id]}
          test={testWear}
          onUseTest={() => setTestWear(true)}
        />
      )}
      {product && tab === 'stills' && <StillsTab key={`${product.id}-${testWear}`} product={product} frames={bundle?.frames ?? null} test={testWear} />}
    </div>
  );
}

function LiveTab({
  product,
  dossier,
  frames,
  keyOk,
  override,
  test,
  onUseTest,
}: {
  product: Product;
  dossier: Dossier | null;
  frames: Frames | null;
  keyOk: boolean | null;
  override?: GarmentOverride;
  test: boolean;
  onUseTest: () => void;
}) {
  const q = new URLSearchParams(location.search);
  const [engine, setEngine] = useState<'decart' | 'mock'>((q.get('engine') as 'mock') ?? (keyOk ? 'decart' : 'mock'));
  const [model, setModel] = useState<ModelChoice>((q.get('model') as ModelChoice) ?? 'lucy-vton-latest');
  const [strategy, setStrategy] = useState<Strategy>((q.get('strategy') as Strategy) ?? 'reference-swap');
  const [mirror, setMirror] = useState(true);
  const [selfAnchor, setSelfAnchor] = useState(true);
  const [fast, setFast] = useState(false);
  const [codec, setCodec] = useState<'h264' | 'vp8' | 'vp9'>((q.get('codec') as 'vp9') ?? 'h264');
  const [garment, setGarment] = useState(() => describeGarment(product, override).description);
  const [textMode, setTextMode] = useState<TextMode>((q.get('text') as TextMode) ?? 'full');
  const [customRefs, setCustomRefs] = useState<Record<number, string>>({}); // stage t -> object URL of a dropped image
  const [wears, setWears] = useState<Size>((q.get('wears') as Size) ?? 'M');
  const [tries, setTries] = useState<Size>((q.get('size') as Size) ?? 'M');
  const fit = fitFor(wears, tries);
  const [testFrames, setTestFrames] = useState<Frames | null>(null);
  useEffect(() => {
    if (test) loadTestFrames(product.id).then(setTestFrames);
  }, [test, product.id]);
  const [t, setT] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [checks, setChecks] = useState<boolean[]>(GATES.map(() => false));
  const [notes, setNotes] = useState('');
  const [firstFrameS, setFirstFrameS] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const startedAt = useRef(0);
  const outRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (keyOk && !q.get('engine')) setEngine('decart');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyOk]);

  const addLog = useCallback((line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 80)), []);
  const plan = useMemo(
    () => (test ? planTest(product, testFrames, { garment: { ...override, description: garment } }) : planTryOn(product, dossier, frames, { garment: { ...override, description: garment } })),
    [test, product, dossier, frames, testFrames, override, garment],
  );
  const idx = stageIndexFor(plan.stages, t);
  const stage = plan.stages[idx];
  const look = useMemo(
    () => lookFor(plan, idx, model, strategy, textMode, customRefs[stage.t], fit.phrase),
    [plan, idx, model, strategy, textMode, customRefs, stage.t, fit.phrase],
  );
  const { snapshot, camera, preview, start, stop, setLook } = useTryOn({ engine, model, mirror, selfAnchor, fast, codec, debug: true, log: addLog });
  const [netBusy, setNetBusy] = useState(false);
  const networkCheck = async () => {
    setNetBusy(true);
    addLog('network check: testing WebRTC to Decart (5 s)…');
    try {
      const r = await DecartTryOn.checkNetwork({ model });
      addLog(`network check: quality ${r.quality}, transport ${r.metrics.transport}, rtt ${r.metrics.rttMs ?? '–'} ms${r.reasons.length ? ` · ${r.reasons.join('; ')}` : ''}`);
      if (r.metrics.transport === 'failed') addLog('network check: WebRTC media cannot get through this network. Try a phone hotspot.');
    } catch (e) {
      addLog(`network check failed: ${(e as { code?: string })?.code ?? ''} ${(e as Error)?.message ?? e}`);
    } finally {
      setNetBusy(false);
    }
  };

  // open the camera as soon as the lab loads, so you can frame yourself (and see camera problems) before Start
  useEffect(() => {
    preview().then((ok) => addLog(ok ? 'camera preview on' : 'camera preview failed (see the message on the video)'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const maxT = plan.stages.at(-1)!.t || 1;

  useEffect(() => {
    if (snapshot.status === 'live') setLook(look);
  }, [look, snapshot.status, setLook]);
  // main view: the transformed stream once it exists, the raw camera before that
  const mainStream = snapshot.stream ?? camera;
  const showingRaw = !snapshot.stream && Boolean(camera);
  useEffect(() => {
    if (outRef.current && outRef.current.srcObject !== mainStream) outRef.current.srcObject = mainStream;
  }, [mainStream]);
  useEffect(() => {
    if (camRef.current && camRef.current.srcObject !== camera) camRef.current.srcObject = camera;
  }, [camera]);
  useEffect(() => {
    if (snapshot.error) addLog(`ERROR ${snapshot.error.code}: ${snapshot.error.message}`);
  }, [snapshot.error, addLog]);

  const onStart = async () => {
    setFirstFrameS(null);
    startedAt.current = performance.now();
    const cs = camera?.getVideoTracks()[0]?.getSettings();
    addLog(`start: engine=${engine} model=${model} strategy=${strategy} mirror=${mirror} selfAnchor=${selfAnchor} fast=${fast} codec=${codec} camera=${cs ? `${cs.width}x${cs.height}@${cs.frameRate}` : '?'}`);
    await start(look, preloadFor(plan, strategy));
  };
  const onPlaying = () => {
    if (firstFrameS === null && startedAt.current && snapshot.stream) {
      const s = (performance.now() - startedAt.current) / 1000;
      setFirstFrameS(s);
      addLog(`first transformed frame ${s.toFixed(1)} s after Start`);
    }
  };

  const record = (seconds: number, sweep: boolean) => {
    const stream = snapshot.stream;
    if (!stream) return;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      setRecording(false);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      a.download = `worn-${product.id}-${model}-${strategy}-${Date.now()}.webm`;
      a.click();
      addLog(`clip saved (${seconds} s${sweep ? ', stage sweep' : ''})`);
    };
    rec.start(250);
    setRecording(true);
    if (sweep) {
      const per = (seconds * 1000) / plan.stages.length;
      plan.stages.forEach((s, i) => setTimeout(() => setT(s.t), i * per));
    }
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000);
  };

  const snapPng = () => {
    const v = outRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `worn-${product.id}-t${stage.t}-${model}-${strategy}.png`;
    a.click();
  };

  const result = () =>
    [
      `### Live gate ${new Date().toLocaleString()}`,
      `engine ${engine} · model ${model} · strategy ${strategy} · mirror ${mirror} · selfAnchor ${selfAnchor} · fast ${fast} · codec ${codec}`,
      `video: ${describeVideo(snapshot.video)}`,
      `product ${product.id}${dossier?.sample ? ' (sample data)' : ''} · first frame ${firstFrameS?.toFixed(1) ?? '–'} s · last set() ${snapshot.lastApplyMs ?? '–'} ms · billed ${snapshot.billedSeconds} s`,
      ...GATES.map((g, i) => `- [${checks[i] ? 'x' : ' '}] ${g}`),
      notes ? `notes: ${notes}` : '',
      `garment text: ${garment}`,
      `size: wears ${wears}, tries ${tries}${fit.phrase ? ` (${fit.phrase})` : ''}`,
      `prompt sent: ${look.prompt || '(image only)'}`,
      test ? 'wear source: GATE TEST WEAR (fixed spec, not evidence)' : `wear source: dossier (${plan.evidence})`,
    ].join('\n');

  const busy = ['camera', 'preparing', 'connecting'].includes(snapshot.status);
  const running = snapshot.status === 'live' || snapshot.status === 'reconnecting' || busy;
  const cost = snapshot.billedSeconds * PRICE_PER_S * (fast ? 2 : 1);

  return (
    <main className="lab__live">
      <section className="lab__screen">
        <div className="lab__video">
          <video ref={outRef} autoPlay playsInline muted onPlaying={onPlaying} style={{ transform: showingRaw && mirror ? 'scaleX(-1)' : undefined }} />
          {showingRaw && <span className="lab__rawtag">camera preview (not transformed yet){busy ? ` · ${snapshot.status}…` : ' · press Start'}</span>}
          {!mainStream && (
            <div className="lab__placeholder">
              {snapshot.error && CAMERA_HELP[snapshot.error.code] ? (
                <div className="lab__camerr">
                  <b>{snapshot.error.code}</b>
                  <p>{CAMERA_HELP[snapshot.error.code]}</p>
                  <button onClick={() => preview()}>Try the camera again</button>
                </div>
              ) : busy ? (
                `${snapshot.status}…`
              ) : (
                'waiting for the camera…'
              )}
            </div>
          )}
          <video ref={camRef} className="lab__cam" autoPlay playsInline muted style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />
          {recording && <span className="lab__rec">● REC</span>}
        </div>
        <div className="lab__slider">
          <label>
            {plan.axis ?? 'no axis'} <b>{t}</b> → stage t={stage.t}
          </label>
          {plan.stages.length === 1 && (
            <p className="lab__locked">
              Slider locked: {plan.evidence === 'none' ? 'no owner reports with a stated time for this product yet' : 'fewer than 3 owner reports with a stated time'}, so the
              product page shows no wear (honesty rule). In the lab you can still test aging with the owner photos:{' '}
              <button className="lab__unlock" onClick={onUseTest}>
                Unlock slider with owner photos (0 / 1 / 10 / 25 washes)
              </button>
              {' '}This is test wear: it works while live, and it never reaches the product page.
            </p>
          )}
          <input type="range" min={0} max={maxT} step={1} value={t} onChange={(e) => setT(Number(e.target.value))} aria-valuetext={`${t} ${plan.axis ?? ''}`} />
          <div className="lab__ticks">
            {plan.stages.map((s, i) => (
              <button key={s.t} className={i === idx ? 'on' : ''} onClick={() => setT(s.t)}>
                {s.t}
              </button>
            ))}
          </div>
        </div>
        <div className="lab__sent">
          <img src={look.image ?? ''} alt="reference" />
          <div>
            <div className="lab__k">prompt sent ({look.prompt.length} chars) · key {look.key}</div>
            <p>{look.prompt || '(no text: the model dresses you from the reference image alone)'}</p>
            <div className="lab__k">
              wear at this stage ({plan.evidence}) · based on {stage.basedOn.length} reports · reference {stage.imageShowsWear ? 'shows wear (aged still)' : 'is the new product photo'}
            </div>
            <ul>
              {stage.wear.map((w) => (
                <li key={w.type + w.region}>
                  {wearPhrase(w, product.color)} — {w.reached}/{w.dated} dated owners
                </li>
              ))}
              {stage.wear.length === 0 && <li>none</li>}
            </ul>
          </div>
        </div>
      </section>

      <aside className="lab__panel">
        <fieldset disabled={running}>
          <legend>Session (set before Start)</legend>
          <Radio label="engine" value={engine} set={setEngine} opts={['decart', 'mock']} />
          <Radio label="model" value={model} set={setModel} opts={['lucy-vton-latest', 'lucy-2.5']} />
          <Radio label="codec (next Start)" value={codec} set={setCodec} opts={['h264', 'vp8', 'vp9']} />
          <Radio label="wear" value={strategy} set={setStrategy} opts={['reference-swap', 'prompt-only']} />
          <label className="lab__chk">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> mirror
          </label>
          <label className="lab__chk">
            <input type="checkbox" checked={selfAnchor} onChange={(e) => setSelfAnchor(e.target.checked)} /> self-anchor (lucy-2.5)
          </label>
          <label className="lab__chk">
            <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> fast mode (2× price)
          </label>
        </fieldset>
        <div className="lab__radio" role="radiogroup" aria-label="text">
          <span>text</span>
          {(['full', 'short', 'image'] as TextMode[]).map((m) => (
            <label key={m} title={m === 'full' ? 'garment description + wear (Decart guide)' : m === 'short' ? 'one line; the image carries the rest' : 'no text, reference image only'}>
              <input type="radio" checked={textMode === m} onChange={() => setTextMode(m)} /> {m === 'image' ? 'image only' : m}
            </label>
          ))}
        </div>
        <fieldset className="lab__size">
          <legend>Size (Patagonia men's chart, regular fit)</legend>
          <div className="lab__radio" role="radiogroup" aria-label="you wear">
            <span>you wear</span>
            {SIZES.map((s) => (
              <label key={s}>
                <input type="radio" checked={wears === s} onChange={() => setWears(s)} /> {s}
              </label>
            ))}
          </div>
          <div className="lab__radio" role="radiogroup" aria-label="try on">
            <span>try on</span>
            {SIZES.map((s) => (
              <label key={s}>
                <input type="radio" checked={tries === s} onChange={() => setTries(s)} /> {s}
              </label>
            ))}
          </div>
          <div className="lab__k">
            {fit.phrase ? `chest ${fit.chestDelta > 0 ? '+' : ''}${fit.chestDelta} in, sleeves ${fit.armDelta > 0 ? '+' : ''}${fit.armDelta} in → ${[fit.body, fit.sleeves].filter(Boolean).join('; ')}` : 'your size: no fit text added'}
          </div>
        </fieldset>
        <RefPicker
          t={stage.t}
          productId={product.id}
          noun={plan.garment.noun}
          current={customRefs[stage.t]}
          onUse={(url) => setCustomRefs((r) => ({ ...r, [stage.t]: url }))}
          onReset={() => setCustomRefs(({ [stage.t]: _drop, ...rest }) => rest)}
          log={addLog}
        />
        <label className="lab__k" htmlFor="garment">
          garment text (sent live as you edit; paste the winner into the product's tryon override)
        </label>
        <textarea id="garment" rows={3} value={garment} onChange={(e) => setGarment(e.target.value)} />
        <div className="lab__row">
          {!running ? (
            <button className="primary" onClick={onStart}>
              Start
            </button>
          ) : (
            <button
              onClick={() => {
                stop();
                void preview();
              }}
            >
              Stop
            </button>
          )}
          <button disabled={netBusy || engine !== 'decart'} onClick={networkCheck} title="Decart's WebRTC preflight: can video get through this Wi-Fi?">
            Network check
          </button>
          <button disabled={!snapshot.stream || recording} onClick={() => record(10, false)}>
            Record 10 s
          </button>
          <button disabled={!snapshot.stream || recording} onClick={() => record(15, true)}>
            Record sweep
          </button>
          <button disabled={!snapshot.stream} onClick={snapPng}>
            PNG
          </button>
        </div>
        <dl className="lab__stats">
          <dt>video</dt>
          <dd>
            {(() => {
              const cs = camera?.getVideoTracks()[0]?.getSettings();
              return `camera ${cs?.width ?? '?'}x${cs?.height ?? '?'} | ${describeVideo(snapshot.video)}`;
            })()}
          </dd>
          <dt>status</dt>
          <dd>
            {snapshot.status}
            {snapshot.queuePosition ? ` (queue ${snapshot.queuePosition})` : ''}
          </dd>
          <dt>first frame</dt>
          <dd>{firstFrameS === null ? '–' : `${firstFrameS.toFixed(1)} s`}</dd>
          <dt>applied / pending</dt>
          <dd>
            {snapshot.appliedKey ?? '–'} / {snapshot.pendingKey ?? '–'}
          </dd>
          <dt>last set()</dt>
          <dd>{snapshot.lastApplyMs === null ? '–' : `${snapshot.lastApplyMs} ms`}</dd>
          <dt>billed</dt>
          <dd>
            {snapshot.billedSeconds} s ≈ ${cost.toFixed(2)}
          </dd>
          <dt>error</dt>
          <dd>{snapshot.error ? `${snapshot.error.code}: ${snapshot.error.message}` : '–'}</dd>
        </dl>
        <fieldset>
          <legend>Gate (Plan v2 P2 live try-on)</legend>
          {GATES.map((g, i) => (
            <label key={g} className="lab__chk">
              <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((x, j) => (j === i ? e.target.checked : x)))} /> {g}
            </label>
          ))}
          <textarea rows={2} placeholder="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button onClick={() => navigator.clipboard.writeText(result()).then(() => addLog('gate result copied'))}>Copy result (markdown)</button>
        </fieldset>
        <pre className="lab__log">{log.join('\n')}</pre>
      </aside>
    </main>
  );
}

function Radio<T extends string>({ label, value, set, opts }: { label: string; value: T; set: (v: T) => void; opts: T[] }) {
  return (
    <div className="lab__radio" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      {opts.map((o) => (
        <label key={o}>
          <input type="radio" checked={value === o} onChange={() => set(o)} /> {o}
        </label>
      ))}
    </div>
  );
}

function StillsTab({ product, frames, test }: { product: Product; frames: Frames | null; test: boolean }) {
  const [idx, setIdx] = useState<VariantIndex | null | undefined>(undefined);
  const [pick, setPick] = useState<Record<number, number>>({});
  const [testFrames, setTestFrames] = useState<Frames | null>(null);
  useEffect(() => {
    loadVariants(product.id, test).then(setIdx);
    if (test) loadTestFrames(product.id).then(setTestFrames);
  }, [product.id, test]);
  if (test) frames = testFrames;
  const cmd = `npm run pick -w pipeline -- --product ${product.id}${test ? ' --test' : ''} --pick ${Object.entries(pick)
    .map(([t, v]) => `${t}=${v}`)
    .join(',')}`;
  return (
    <main className="lab__stills">
      <h2>Current frames ({frames ? `${frames.stages.length} stages, axis ${frames.axis}` : 'none yet'})</h2>
      <div className="lab__strip">
        {frames?.stages.map((s) => (
          <figure key={s.t}>
            <img src={s.image} alt={`t=${s.t}`} />
            <figcaption>
              t={s.t} · {s.basedOn.length} reports
            </figcaption>
          </figure>
        ))}
      </div>
      {idx === undefined && <p>loading…</p>}
      {idx === null && (
        <p>
          No variants yet. Run <code>npm run frames -- --product {product.id}{test ? ' --test' : ''}</code> (add <code>--dry-run</code> first to see prompts and cost).
        </p>
      )}
      {idx && (
        <>
          <h2>
            Variants ({idx.resolution}, {new Date(idx.generatedAt).toLocaleString()}) — click one per stage
          </h2>
          {idx.stages.map((s) => (
            <section key={s.t} className="lab__vrow">
              <div className="lab__k">
                t={s.t} · {s.basedOn} reports · {s.prompt}
              </div>
              <div className="lab__strip">
                {s.files.map((f, v) => (
                  <figure key={f} className={pick[s.t] === v ? 'on' : ''} onClick={() => setPick((p) => ({ ...p, [s.t]: v }))}>
                    <img src={f} alt={`t=${s.t} v${v}`} />
                    <figcaption>v{v}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
          <div className="lab__row">
            <code className="lab__cmd">{Object.keys(pick).length ? cmd : 'pick at least one variant'}</code>
            <button disabled={!Object.keys(pick).length} onClick={() => navigator.clipboard.writeText(cmd)}>
              Copy
            </button>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * Replace the reference image for one stage: a file as-is, or "Clean it" (lucy-image-2 extracts the
 * garment from an owner photo onto a plain background, the way Decart's VTON guide recommends).
 */
function RefPicker({
  t,
  productId,
  noun,
  current,
  onUse,
  onReset,
  log,
}: {
  t: number;
  productId: string;
  noun: string;
  current?: string;
  onUse: (url: string) => void;
  onReset: () => void;
  log: (s: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [err, setErr] = useState('');
  const clean = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    setResult(null);
    log(`cleaning ${file.name} with lucy-image-2 (2 tries, ~20 s, ~$0.04)…`);
    try {
      const r = await cleanGarment(file, productId, noun);
      setResult(r);
      log(`cleaned: ${r.cleaned.length} result(s) saved under ${r.cleaned[0].replace(/[^/]+$/, '')}${r.errors.length ? ` · ${r.errors.join('; ')}` : ''}`);
    } catch (e) {
      setErr((e as Error).message);
      log(`clean failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="lab__ref">
      <legend>Reference image for t={t}</legend>
      <div className="lab__row">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setFileUrl(f ? URL.createObjectURL(f) : null);
            setResult(null);
            setErr('');
            e.target.value = '';
          }}
        />
        {current && <button onClick={onReset}>use planned image</button>}
      </div>
      {fileUrl && (
        <div className="lab__row">
          <img className="lab__thumb" src={fileUrl} alt="your photo" />
          <button onClick={() => onUse(fileUrl)} title="Send the photo exactly as it is">
            Use as-is
          </button>
          <button className="primary" disabled={busy} onClick={clean} title="Extract the garment onto a plain background first">
            {busy ? 'Cleaning…' : 'Clean it'}
          </button>
        </div>
      )}
      {result && (
        <div className="lab__row">
          {result.cleaned.map((u) => (
            <img key={u} className={`lab__thumb pick ${current === u ? 'on' : ''}`} src={u} alt="cleaned" title="Click to use this as the reference" onClick={() => onUse(u)} />
          ))}
          <span className="lab__k">click one to use it</span>
        </div>
      )}
      {err && <p className="lab__err">{err}</p>}
    </fieldset>
  );
}
