# Decisions

Paste gate results from the lab ("Copy result") here, newest first.

### Stills gate: lucy-image-2 localized wear on Patagonia Better Sweater 1/4-Zip (Oct 17, ~4:30 PM)
Result: **FAIL for realistic pilling.** 22 generations at 720p, ~10 s each (Decart runs one per key at a time), $0.02 each.
- A square product photo is cropped to 1280×720. Fix: pad it to 16:9 first (`products/patagonia-25523/flat-16x9.jpg`).
- "Show this exact X after N washes ... keep unchanged": mostly no visible change; about 1 in 3 seeds regenerates a different garment (navy or grey fleece).
- Words like "balls", "dense", "heavy" give cartoon pom-poms or faux fur.
- "Add <wear> to <region> ... Everything else stays exactly the same: ..." keeps the garment and keeps the edit in the named region, but makes it exaggerated (furry cuffs and hem). This is now the template in prompts.ts, with milder "lint pills" wording.
- Decision: realistic pilling stills will be hand-composed (Plan v2 fallback). The exaggerated but localized edits are used only as gate-test references for the live test.
- Evidence: 0 qualifying cases for this product so far (see demo/evidence/patagonia-25523.md).

### Live gate blocker found: @decartai/sdk 0.2.12 never streams (Oct 17, ~4:55 PM)
Symptom: connects (signalling, ICE, DTLS all up), encodes ~28 fps, sends 0 bytes; Decart never starts generating; no error event.
Bisect on Caesar's machine and key, same synthetic video:
- 0.2.12: all models, 0 bytes, no generation.
- 0.2.11, 0.2.8, 0.2.4: generating within about 2 s, transformed video comes back.
- 0.2.4 with lucy-vton-latest + sweater image: generating in 2.5 s.
Not the cause: network (Decart preflight: UDP, good, 39 ms RTT), quota (no concurrent-session limit), Decart status (no incidents).
Decision: pin 0.2.11 everywhere. 0.2.11 sends no client token on HTTP uploads (422 missing x-api-key), so reference images now go through the server (`POST /api/decart/upload`, permanent key) and the browser sends only file ids.

### CORRECTION: the real cause was Vite, not SDK 0.2.12 (Oct 17, ~5:10 PM)
The 4:55 PM entry blamed SDK 0.2.12. That was wrong: 0.2.11 failed the same way once installed locally. The versions that "worked" had been loaded from a CDN, which keeps the SDK's file layout.
Root cause: in Chromium the SDK pipes every outgoing video frame through a Web Worker loaded with
`new URL('./frame-metadata-worker.js', import.meta.url)`. Vite's dependency pre-bundling moves the SDK into
`node_modules/.vite/deps/`, where that file doesn't exist. The worker 404s, frames are encoded but never sent, and Decart never starts generating. No error is raised.
Fix: a Vite dev plugin (`web/vite.config.ts`) serves the SDK's own worker file at that path. Production builds were never affected (Rollup copies the worker as an asset).
Verified on Caesar's machine with our engine: transformed video ~1 s after connect, generating, reference swap applied in 232 ms.
SDK stays pinned to 0.2.11 (tested); reference uploads stay server-side.

### Live resolution measured (Oct 17, ~5:40 PM)
Measured from Caesar's laptop and network, with a 1280x720 canvas as the camera: received 1280x720 at ~20 fps and ~1.5 Mbps, sent 1280x720 at 30 fps, upload estimate 2.2 to 7 Mbps. Output is sharp at stage 0 and at stage 25 (owner photo). Images: `demo/evidence/size-tests/output-stage0.jpg` and `output-stage25.jpg`.
The SDK publishes the camera at 1280x720 plus 640x360 and 320x180 simulcast layers. When upload or CPU can't keep up, Chrome drops the top layer and Decart gets 320x180, which looks like "180p". The lab's stats panel now shows camera / received / sent resolution and the limit reason (`cpu` or `bandwidth`). Read that line when it looks blurry.

### Sizes gate: generative fit changes the garment (Oct 17, ~6:00 PM) - FAIL
Setup: same person (stock photo as camera), same New Navy reference, you wear M.
- `lucy-vton-latest` + fit text (`size-text-test-M-XL-XS-shortXL.jpg`): XL adds bulk and bunched sleeves, but the collar lining turns light grey-blue and the knit turns into fleece. XS looks almost the same as M. Short-text mode behaves the same.
- `lucy-image-2` editing the M output frame into XL / XS ("Change only how the garment fits ... Everything else stays exactly the same", `size-image-edit-test-M-XL-XS.jpg`): XL gets longer, looser sleeves but turns blue-grey. XS turns into a grey short-sleeve polo.
- `lucy-2.5` + fit text (`size-lucy25-test-M-XL-XS.jpg`): pockets, piping and texture change at every size.
Decision: don't show sizes by regenerating the garment. Keep one prompt and one reference. Proposed replacement: pose-tracked cuff/hem markers placed from the size chart (e.g. "XL: sleeve ends 2 in past your wrist"). Cost of these tests: about $1.70.
