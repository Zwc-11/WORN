# WORN · render lane (C)

Puts the hoodie on a person live on camera and ages it along the slider, using only wear that owners reported. Built to Plan v2's contract (`Product`, `Case`, `Dossier`, `Frames`), so it drops into the team repo without changing A's or B's code.

## Run it

Needs Node 20.6 or newer and Chrome.

```
npm install
copy .env.example .env          (PowerShell: Copy-Item .env.example .env) then paste DECART_API_KEY
npm run dev                     web on http://localhost:5173, token server on :8787
```

| Page | What it is |
|---|---|
| `http://localhost:5173/lab.html` | Render lab: gate tests, every internal visible, record clips, review stills |
| `http://localhost:5173/stage.html` | The live stage the way the demo shows it (`?engine=mock` works with no key) |

Checks: `npm test` (66 web + 13 server tests) · `npm run typecheck` · `npm run check:fixtures` · `npm run frames:dry`

## How it works

```
B: <id>.dossier.json ──► composeWear (pure, tested) ──► wear per slider stage
   cases with stated t      activeWear(dossier, t)         + prompt text per model
                            pickStages(dossier)
                                   │
              ┌────────────────────┴─────────────────────┐
              ▼                                          ▼
 pipeline/render/gen-wear-frames.ts             LiveGarmentStage (browser)
 lucy-image-2 edits the product photo           webcam ─► Decart realtime (WebRTC)
 once per stage, 3 variants                     lucy-vton-latest, initialState = stage 0
   ─► stills/<id>/<t>.png                       slider ─► LookScheduler (latest wins)
   ─► <id>.frames.json  ──────────────────────►   ─► rt.set({ prompt, image: file id })
      (A's stills stage uses the same files)    fails? ─► fallback = A's stills stage
```

**Why aged reference images:** Decart's VTON guide says "the reference image is the source of truth", so the model copies what the garment photo shows. Changing only the prompt probably won't make wear show up. So each slider stage swaps in that stage's aged still as the reference, plus text naming the same wear. All stills are uploaded once per session (`files.upload`), so a slider stop sends only a file id. Whether VTON actually follows an aged reference is the first thing the gate test checks. `prompt-only` and `lucy-2.5` are kept as alternatives you can switch to in the lab.

**Honesty rules, enforced in `composeWear.ts` and covered by tests:**
- wear appears only for cases with a stated `t` on the dossier's axis, at or after that `t`;
- `t: null` cases and cases stated in the other unit never drive the render;
- fewer than 3 cases means nothing is drawn (the insufficient-evidence state);
- severity = min(how many owners reported it by `t`, what share of that region's dated reports has been reached). One owner alone never draws heavy wear;
- the caption counts only the cases the prompt actually names (`basedOn`). Prompt length limits cut the weakest items, and those cut items are not counted.

## Gate tests (Plan v2: "lucy-image-2 draws localized wear", live try-on P2)

1. **Hero photo.** Get a clean garment-only product photo, at least 512 px, on a plain background (Amazon `meta.images[0].large` works). Put it at `web/public/fixtures/products/<id>/flat.jpg` and add the product to `products.json`. Put B's `<id>.dossier.json` next to it. Run `npm run check:fixtures`.
2. **Stills.** Run `npm run frames -- --product <id> --dry-run` and read the prompts and the cost (about $0.24 for 4 stages × 3 variants at 720p). Then run it without `--dry-run`. In the lab's **Stills** tab, pick the variant per stage where wear is in the named regions and nothing else changed, then paste the `npm run pick ...` command it builds. Fails → Plan v2 fallback: hand-edit the stills; the same files feed live.
3. **Live matrix** (lab **Live** tab, about 1 minute each, about $1.20/min): plain top, even light, plain wall.

   | Run | model | wear | what decides it |
   |---|---|---|---|
   | 1 | lucy-vton-latest | reference-swap | expected winner |
   | 2 | lucy-vton-latest | prompt-only | does the text alone show wear? |
   | 3 | lucy-2.5 | reference-swap | fallback model |
   | 4 | lucy-2.5 | prompt-only, self-anchor off | last resort |

   For each run: Start, wait for the garment, turn side to side, click through the stage buttons, **Record sweep** (15 s clip through every stage), tick the gate boxes, **Copy result**, and paste it into `demo/decisions.md`.
4. **Decide.** If a run passes all five boxes, set its `model` and `strategy` on `<LiveGarmentStage>`. If none passes, live is out of the demo and the recorded clip goes in the video only (Plan v2 rule). Optional: `npm run frames -- --product <id> --person me.jpg` pre-generates stills of you wearing each stage. `stage.html?person=1` then uses them as the fallback.

Tune the garment text in the lab (it is sent live as you type). Name color, fabric and visible details, and no brand names, because VTON draws logos it is told about.

## Sizes (fit on the body)

`web/src/render/wear/fit.ts` turns "you wear M, trying XL" into fit text, using the Patagonia men's tops chart (chest and arm inches per size). Example: M→XL is chest +7 in and sleeves +2 in, which becomes "oversized and baggy, shoulder seams dropped well down the upper arms ... sleeves too long, covering the hands down to the knuckles". The text goes right after the garment in the live prompt and is sent with `set()`, so changing size doesn't reconnect. If garment + wear + fit would exceed the VTON length budget (700 chars), the prompt switches to the short form ("the {noun} from the reference image") plus the fit, because the reference image already carries the garment's look.

No per-size images: official product pages show one photo set per color, and a flat photo looks the same in every size anyway.

**Gate result (Oct 17): generative fit changes the garment.** Tested live with one person and one reference: VTON with fit text, lucy-2.5 with fit text, and lucy-image-2 editing an on-body frame into XL/XS (`POST /api/clean/fit`). In every case the garment changed along with the fit (collar lining, colour, pockets; XS became a short-sleeve polo), and VTON mostly ignored "tight/short". Details and images: `demo/decisions.md`, `demo/evidence/size-tests/`. Keep the size picker at your own size (no fit text) for the demo. Proposed replacement: chart-based cuff/hem markers on the live video, with the garment left untouched.

The fit text comes from a size chart, not from your measurements. It is an illustration, not a fit prediction.

## For A (frontend)

```tsx
<LiveGarmentStage product={p} dossier={d} frames={f} t={sliderT}
  fallback={<GarmentStage product={p} frames={f} t={sliderT} />}   // your stills stage
  model="lucy-vton-latest" strategy="reference-swap"
  size={{ wears: 'M', tries: 'XL' }} />            // optional; omit = no fit text
```

- Same inputs as `GarmentStage`. The fallback stays on screen until the first live frame and again whenever live fails, so the page never shows a black box.
- No model, API or engine names reach the page. Captions use Plan v2 wording ("Illustration composed from N owner reports").
- `engine="mock"` runs with no key and no cost (webcam plus the stage still), for building layout.
- `live-stage.css` reads `--paper`, `--ink`, `--accent`, `--font-ui` and `--font-mono` from your tokens when they exist.

## For B (data / server)

- `server/src/routes/decart.ts` mounts in your Hono server: `app.route('/api/decart', decartRoutes({ apiKey, allowedOrigins, maxSessionS }))`. The browser only ever sees 120 s client tokens.
- `gen-wear-frames` reads your `<id>.dossier.json`. Rerun it after the dossier changes; `check:fixtures` fails if `frames.basedOn` no longer matches the dossier.
- Contract gap: there is no `body` region, so a fading case gets the region the owner named and is drawn garment-wide (except `chest_print`). Tell me if you'd rather add a region.

## Costs and guardrails

- Realtime: $0.02/s ($1.20/min), fast mode 2×. The engine ends a session after 10 min of live time (`maxSessionMs`), and ends it when the server sends "generation ended" instead of letting the SDK redial with a new token. Tokens also carry `DECART_MAX_SESSION_S` (default 900 s). The lab shows billed seconds.
- The camera turns off whenever a session ends or fails.
- Image uploads are cached per page for 5 h, so Retry or a product switch doesn't re-upload or mint extra tokens. The token route allows 60 tokens per minute per IP.
- Stills: $0.02 per image at 720p, $0.01 at 480p.
- Connect gives up after 30 s with no progress; queue and capacity updates count as progress. A connect that lands after that is closed at once, and its callbacks are ignored.

## Layout

```
web/src/data/contract.ts                 Plan v2 contract + zod (delete if the team copy exists)
web/src/render/wear/composeWear.ts       activeWear, pickStages, stageIndexFor, severity
web/src/render/wear/prompts.ts           phrase table; vton / lucy / flat / person prompts with length budgets
web/src/render/wear/plan.ts              planTryOn: stages, reference image, prompts, basedOn
web/src/render/live/types.ts             TryOnEngine interface, snapshot store
web/src/render/live/DecartTryOn.ts       real engine (@decartai/sdk 0.2.12)
web/src/render/live/MockTryOn.ts         offline engine
web/src/render/live/LookScheduler.ts     latest-wins set() coalescing, min gap
web/src/render/live/useTryOn.ts          React hook: camera + engine lifecycle
web/src/modules/stage/LiveGarmentStage.tsx   the stage component
web/src/lab/*                            lab, stage demo, fixture loader
server/src/routes/decart.ts              client-token route
pipeline/render/*                        gen-wear-frames, pick-frames, check-fixtures
web/public/fixtures/                     sample hoodie (placeholder art, sample: true)
```

## Verified vs. not yet

- Verified here: 66 web + 13 server tests (composer, prompts, fit, scheduler, engine against a fake SDK including timeout/late-connect/cap/ended paths, token route), plus an independent review of every SDK call against the SDK source; typecheck; production build; lab and stage driven in Chromium with a fake camera on the mock engine, with no console errors; the no-key path falls back to the stills.
- Verified on Caesar's machine with a real key: live VTON shows the garment (remote stream about 1 s after connect, reference swap applied in about 230 ms). This needs the `decartFrameMetadataWorker` plugin in `web/vite.config.ts`; without it, no frames come back (see `demo/decisions.md`).
- Not verified yet: whether VTON shows wear from an aged reference (owner photo at stages 10 and 25 under "gate test wear"), and whether it follows fit text.
- The sample hoodie art is a drawn placeholder. Replace it with the real hero photo before generating stills.
