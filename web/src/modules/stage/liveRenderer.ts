/**
 * Live try-on renderer slot (P2, owner C).
 *
 * LiveStage talks to the model ONLY through `LiveRenderer`. It never imports a model SDK, never
 * shows a model or API name, and never changes the data contract. To plug the real renderer in:
 *
 *   1. Implement `LiveRenderer` in a new file next to this one (e.g. `decartRenderer.ts`):
 *      - `start(stream, product)`: open your session, feed `stream` to it, and set `output` to the
 *        <video> element that plays the model's returned frames. Resolve once the first frame plays.
 *      - `setStage(stageIndex, prompt)`: LiveStage calls this whenever the slider moves to a new
 *        stage (index into `frames.stages`, same logic as the stills via `stageIndexFor`). Swap the
 *        session prompt here. It is also called with the still-image mode's stage so the frozen
 *        photo can be re-rendered per stage.
 *      - `stop()`: close the session and release the stream tracks you own. Must be idempotent.
 *   2. Return it from `createLiveRenderer()` below (keep `NullRenderer` as the fallback when the
 *      session cannot be opened, so the stage degrades to the mirrored camera instead of an error).
 *   3. Prompts: `stagePrompt()` below is a PLACEHOLDER built from `frames.stages[i].basedOn.length`.
 *      Replace its body with the real per-stage prompt (the lucy-2.5 prompt derived from the dossier
 *      cases in `basedOn`, which the backend or the frames payload should carry). Keep the signature
 *      so LiveStage does not change. Prompts are never rendered on the page.
 */
import type { Frames, Product } from '../../data';

export interface LiveRenderer {
  /** Begin rendering from the camera stream. Must set `output` before resolving. */
  start(stream: MediaStream, product: Product): Promise<void>;
  /** The slider moved into stage `stageIndex` (0-based index into frames.stages). */
  setStage(stageIndex: number, prompt: string): void;
  /** Tear down; safe to call twice. */
  stop(): void;
  /** The element LiveStage mounts into the stage. Null until `start` resolves and after `stop`. */
  output: HTMLVideoElement | null;
}

/** Passes the camera through untouched. What the stage shows until a real renderer is wired in. */
export class NullRenderer implements LiveRenderer {
  output: HTMLVideoElement | null = null;

  async start(stream: MediaStream): Promise<void> {
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.output = video;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.onloadedmetadata = () => resolve();
    });
    await video.play().catch(() => { /* autoplay refused: the stage still shows the frame once the user interacts */ });
  }

  setStage(): void { /* nothing to redraw: the pass-through ignores stages */ }

  stop(): void {
    if (this.output) {
      this.output.pause();
      this.output.srcObject = null;
      this.output.remove();
    }
    this.output = null;
  }
}

/** The one place that decides which renderer the stage uses. C swaps the implementation here. */
export function createLiveRenderer(): LiveRenderer {
  return new NullRenderer();
}

/**
 * PLACEHOLDER prompt for stage `i`. Only the shape matters to LiveStage; C replaces the body.
 * Derived from how many owner reports the stage is composed of, so it already varies per stage.
 */
export function stagePrompt(frames: Frames, i: number): string {
  const stage = frames.stages[Math.min(Math.max(i, 0), frames.stages.length - 1)];
  const n = stage.basedOn.length;
  return n === 0
    ? 'the same hoodie, new, as sold'
    : `the same hoodie after ${frames.axis === 'months' ? `${stage.t} months` : `${stage.t} washes`}, with wear composed from ${n} owner ${n === 1 ? 'report' : 'reports'}`;
}
