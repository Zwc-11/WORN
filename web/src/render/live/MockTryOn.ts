// Mock engine: no network, no key, no cost. Draws the webcam (mirrored) and the current stage's
// garment image over the torso, so the whole stage, slider and fallback logic can be built and
// tested before Decart is wired. It is visibly a mock ("MOCK" badge) and never used in the demo.

import { SnapshotStore, type Look, type StartInput, type TryOnEngine } from './types';

export interface MockOptions {
  applyLatencyMs?: number; // simulated set() latency, default 180
  failOnStart?: boolean; // simulate a connect failure (tests the fallback)
  endAfterMs?: number; // simulate the server ending the session
  mirror?: boolean;
}

export class MockTryOn implements TryOnEngine {
  readonly name = 'mock' as const;
  private store = new SnapshotStore();
  private raf = 0;
  private video: HTMLVideoElement | null = null;
  private images = new Map<string, HTMLImageElement>();
  private look: Look | null = null;
  private seq = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: MockOptions = {}) {}

  snapshot() {
    return this.store.get();
  }
  subscribe(fn: Parameters<SnapshotStore['subscribe']>[0]) {
    return this.store.subscribe(fn);
  }

  private img(url: string): HTMLImageElement {
    let im = this.images.get(url);
    if (!im) {
      im = new Image();
      im.src = url;
      this.images.set(url, im);
    }
    return im;
  }

  async start({ camera, look, preload }: StartInput) {
    this.store.patch({ status: 'preparing', error: null, detail: 'mock: loading images' });
    for (const u of preload) this.img(u);
    await new Promise((r) => setTimeout(r, 150));
    this.store.patch({ status: 'connecting', detail: 'mock: connecting' });
    await new Promise((r) => setTimeout(r, 250));
    if (this.opts.failOnStart) {
      const error = { code: 'MOCK_FAIL', message: 'mock engine told to fail on start' };
      this.store.patch({ status: 'error', error, detail: error.message });
      throw Object.assign(new Error(error.message), { code: error.code });
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = camera;
    await video.play().catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    this.video = video;
    this.look = look;
    const mirror = this.opts.mirror ?? true;
    const draw = () => {
      ctx.save();
      if (mirror) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      else {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
      const cur = this.look;
      if (cur?.image) {
        const im = this.img(cur.image);
        if (im.complete && im.naturalWidth) {
          const h = canvas.height * 0.62;
          const w = (im.naturalWidth / im.naturalHeight) * h;
          ctx.globalAlpha = 0.92;
          ctx.drawImage(im, (canvas.width - w) / 2, canvas.height - h - 8, w, h);
          ctx.globalAlpha = 1;
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(12, 12, 360, 30);
      ctx.fillStyle = '#fff';
      ctx.font = '16px ui-monospace, monospace';
      ctx.fillText(`MOCK ENGINE · ${cur?.key ?? ''}`, 22, 33);
      this.raf = requestAnimationFrame(draw);
    };
    draw();
    const stream = canvas.captureStream(30);
    this.store.patch({ status: 'live', stream, appliedKey: look.key, detail: 'mock: live' });
    if (this.opts.endAfterMs)
      this.endTimer = setTimeout(() => this.store.patch({ status: 'ended', error: { code: 'SESSION_ENDED', message: 'mock session limit' } }), this.opts.endAfterMs);
  }

  setLook(look: Look) {
    if (this.store.get().status !== 'live') return;
    const seq = ++this.seq;
    this.store.patch({ pendingKey: look.key });
    const t0 = performance.now();
    setTimeout(() => {
      if (seq !== this.seq) return; // latest wins
      this.look = look;
      this.store.patch({ appliedKey: look.key, pendingKey: null, lastApplyMs: Math.round(performance.now() - t0), detail: `mock: applied ${look.key}` });
    }, this.opts.applyLatencyMs ?? 180);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.store.get().stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.store.patch({ status: 'idle', stream: null, pendingKey: null });
  }
}
