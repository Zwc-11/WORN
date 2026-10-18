// Real engine: Decart realtime (WebRTC) with @decartai/sdk 0.2.11.
// Needs the Vite plugin in web/vite.config.ts: under Vite's dep pre-bundling the SDK's frame-metadata
// Web Worker 404s, every outgoing frame gets stuck in it (0 bytes sent) and Decart never generates.
//
// Flow: preflight -> upload every stage image once (files.upload -> "file_..." ids, cached per page)
// -> connect with the first look as initialState (no raw-camera flash) -> set({prompt, image: id})
// per stage via the latest-wins scheduler. set() REPLACES the whole state, so every call carries
// prompt AND image.
//
// The permanent API key never reaches the browser: apiKeyProvider asks our server for a client
// token before every connect, reconnect and upload (tokens live 120 s; live sessions outlive them).
//
// Billing guards: a connect that lands after we gave up is closed at once; a session is ended by
// us after maxSessionMs; a server "generation ended" ends it too (the SDK would otherwise redial
// with a fresh token and keep billing).

import { createConsoleLogger, createDecartClient, models, type ConnectivityReport, type RealTimeClient } from '@decartai/sdk';
import { LookScheduler } from './LookScheduler';
import { SnapshotStore, toEngineError, type EngineError, type Look, type ModelChoice, type StartInput, type TryOnEngine } from './types';

export interface DecartTryOnOptions {
  model: ModelChoice;
  tokenUrl?: string; // default /api/decart/token
  mirror?: boolean | 'auto'; // default true: a mirror is what people expect when they step in front of a camera
  selfAnchor?: boolean; // lucy-2.5 feeds recent output back as reference; false may help abrupt look changes
  fast?: boolean; // 2x price, lower latency; connect-time only
  connectTimeoutMs?: number; // default 30 s without progress (queue / capacity updates extend it)
  maxSessionMs?: number; // default 10 min of live time, then we end the session ourselves
  minGapMs?: number; // between set() calls, default 150
  firstFrameTimeoutMs?: number; // connected but no generated video after this -> NO_OUTPUT, default 25 s
  debug?: boolean; // SDK logs to the browser console (DevTools)
  codec?: 'h264' | 'vp8' | 'vp9'; // camera publish codec; SDK default h264 with simulcast (vp9: no simulcast)
  log?: (line: string) => void;
}

const NO_OUTPUT_HELP =
  'Connected to Decart but no transformed video arrived. Usual causes: the network blocks WebRTC video ' +
  '(venue Wi-Fi often does: try a phone hotspot, or run "Network check"), the reference image was rejected ' +
  '(see the error line), or the camera sends no frames.';

type Ref = { id?: string; blob: Blob };

// Page-wide cache: Retry, a product switch or a new engine reuse uploads instead of minting tokens
// and re-uploading every image. Uploads live 6 h on Decart; entries are trusted for 5 h.
const REF_TTL_MS = 5 * 3600_000;
const refCache = new Map<string, { at: number; p: Promise<Ref> }>();
export const _clearRefCache = () => refCache.clear(); // tests

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

function makeClient(opts: Pick<DecartTryOnOptions, 'tokenUrl' | 'debug'>) {
  const tokenUrl = opts.tokenUrl ?? '/api/decart/token';
  return createDecartClient({
    ...(opts.debug ? { logger: createConsoleLogger('info') } : {}),
    apiKeyProvider: async () => {
      const res = await fetch(tokenUrl, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { apiKey?: string; error?: { code?: string; message?: string } };
      if (!res.ok || !body.apiKey) throw fail(body.error?.code ?? 'TOKEN_ENDPOINT', body.error?.message ?? `token endpoint returned ${res.status}`);
      return body.apiKey;
    },
  });
}

export class DecartTryOn implements TryOnEngine {
  readonly name = 'decart' as const;
  private store = new SnapshotStore();
  private rt: RealTimeClient | null = null;
  private scheduler: LookScheduler | null = null;
  private queued: Look | null = null;
  private attempt = 0;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  private client: ReturnType<typeof makeClient>;

  private uploadUrl: string;

  constructor(private readonly opts: DecartTryOnOptions) {
    this.client = makeClient(opts);
    this.uploadUrl = (opts.tokenUrl ?? '/api/decart/token').replace(/\/token$/, '/upload');
  }

  /** WebRTC reachability from this network (UDP or TURN relay), using Decart's own preflight. */
  static async checkNetwork(opts: Pick<DecartTryOnOptions, 'tokenUrl' | 'model'>): Promise<ConnectivityReport> {
    return makeClient(opts).realtime.checkConnectivity({ model: models.realtime(opts.model ?? 'lucy-vton-latest'), durationMs: 5000 });
  }

  snapshot() {
    return this.store.get();
  }
  subscribe(fn: Parameters<SnapshotStore['subscribe']>[0]) {
    return this.store.subscribe(fn);
  }
  private log(line: string) {
    this.opts.log?.(line);
    this.store.patch({ detail: line });
  }

  /** Fetch an image once; upload it once; reuse the id for every later set(). */
  private ref(url: string): Promise<Ref> {
    const hit = refCache.get(url);
    if (hit && Date.now() - hit.at < REF_TTL_MS) return hit.p;
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw fail('IMAGE_FETCH', `garment image ${url} returned ${res.status}`);
      const blob = await res.blob();
      try {
        // server-side upload (permanent key); see server/src/routes/decart.ts /upload
        const up = await fetch(this.uploadUrl, { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
        const body = (await up.json().catch(() => ({}))) as { id?: string; error?: { code?: string; message?: string } };
        if (!up.ok || !body.id) throw fail(body.error?.code ?? 'UPLOAD_FAILED', body.error?.message ?? `upload returned ${up.status}`);
        return { id: body.id, blob };
      } catch (e) {
        const err = toEngineError(e);
        if (['NO_KEY', 'INVALID_API_KEY'].includes(err.code)) throw e; // auth problems: fail fast
        // Upload is an optimisation: without an id the bytes go with every set(), which still works.
        this.log(`upload failed for ${url}, will send bytes instead: ${err.message}`);
        return { blob };
      }
    })();
    refCache.set(url, { at: Date.now(), p });
    p.catch(() => refCache.delete(url));
    return p;
  }

  private async imageFor(look: Look): Promise<string | Blob | null> {
    if (!look.image) return null;
    const r = await this.ref(look.image);
    return r.id ?? r.blob;
  }

  /** One cheap call that fails fast with a clear reason instead of N failed token requests. */
  private async preflight() {
    const healthUrl = (this.opts.tokenUrl ?? '/api/decart/token').replace(/\/token$/, '/health');
    let configured: boolean | undefined;
    try {
      const r = await fetch(healthUrl);
      configured = r.ok ? Boolean(((await r.json()) as { configured?: boolean }).configured) : undefined;
    } catch {
      configured = undefined;
    }
    if (configured === false) throw fail('NO_KEY', 'the token server has no DECART_API_KEY (.env)');
    if (configured === undefined) throw fail('NO_SERVER', `token server not reachable at ${healthUrl} (is npm run dev running?)`);
  }

  async start({ camera, look, preload }: StartInput): Promise<void> {
    const my = ++this.attempt;
    const alive = () => my === this.attempt;
    const model = models.realtime(this.opts.model);
    this.queued = null;
    let abandoned = false;
    try {
      this.store.patch({ status: 'preparing', error: null, billedSeconds: 0, stream: null, appliedKey: null });
      await this.preflight();
      const t0 = performance.now();
      await Promise.all([...new Set([look.image, ...preload].filter(Boolean) as string[])].map((u) => this.ref(u)));
      if (!alive()) return;
      this.log(`references ready in ${Math.round(performance.now() - t0)} ms`);

      this.store.patch({ status: 'connecting' });
      const initialImage = await this.imageFor(look);
      const timeoutMs = this.opts.connectTimeoutMs ?? 30_000;
      let deadline = performance.now() + timeoutMs;
      const progress = () => (deadline = performance.now() + timeoutMs); // queue / capacity updates are progress

      const connect = this.client.realtime.connect(camera, {
        model,
        mirror: this.opts.mirror ?? true,
        ...(this.opts.fast ? { speed: 'fast' as const } : {}),
        ...(this.opts.codec ? { preferredVideoCodec: this.opts.codec } : {}),
        ...(this.opts.selfAnchor === false ? { queryParams: { self_anchor: 'false' } } : {}),
        // prompt is optional: an image-only look dresses the person from the reference alone
        initialState: { ...(look.prompt ? { prompt: { text: look.prompt, enhance: false } } : {}), ...(initialImage ? { image: initialImage } : {}) },
        onRemoteStream: (stream) => {
          if (!alive()) return;
          this.store.patch({ stream });
          this.log(`transformed video track received (${stream.getVideoTracks().length} video track)`);
          this.markOutput();
        },
        onConnectionChange: (state) => {
          if (!alive()) return;
          this.log(`connection: ${state}`);
          if (!this.rt) return; // still inside connect(); start() sets 'live' once it resolves
          // 'live' means transformed video is on screen, not just an open connection
          if ((state === 'connected' || state === 'generating') && this.store.get().stream) this.store.patch({ status: 'live', queuePosition: null });
          else if (state === 'reconnecting') this.store.patch({ status: 'reconnecting' });
          else if (state === 'disconnected' && this.store.get().status !== 'ended')
            this.end('error', this.store.get().error ?? { code: 'DISCONNECTED', message: 'connection lost and reconnects failed' });
        },
        onQueuePosition: (q) => {
          if (!alive()) return;
          progress();
          this.store.patch({ queuePosition: q.position, detail: `queue ${q.position}/${q.queueSize}` });
        },
        onCapacityWait: (w) => {
          if (!alive()) return;
          progress();
          this.log(`no capacity, retrying in ${Math.round(w.retryAfterMs / 1000)} s (attempt ${w.attempt})`);
        },
      });

      let watchdog: ReturnType<typeof setInterval> | undefined;
      let rt: RealTimeClient;
      try {
        rt = await Promise.race([
          connect,
          new Promise<never>((_, rej) => {
            watchdog = setInterval(() => {
              if (performance.now() > deadline) rej(fail('CONNECT_TIMEOUT', `no connection after ${timeoutMs / 1000} s without progress`));
            }, Math.min(250, Math.max(10, timeoutMs / 4)));
          }),
        ]);
      } catch (e) {
        // abandon this attempt: its late callbacks are ignored, and a connect that lands later is closed
        // at once (otherwise it would stream, and bill, with nobody watching)
        abandoned = true;
        this.attempt++;
        connect.then((late) => late.disconnect(), () => undefined);
        throw e;
      } finally {
        clearInterval(watchdog);
      }
      if (!alive()) {
        rt.disconnect();
        return;
      }
      this.rt = rt;
      rt.on('generationTick', (g) => {
        if (!alive()) return;
        if (this.store.get().billedSeconds === 0) this.log('generation started (billing)');
        this.store.patch({ billedSeconds: g.seconds });
      });
      rt.on('diagnostic', (d) => alive() && this.log(`diagnostic ${d.name}: ${JSON.stringify(d.data).slice(0, 220)}`));
      let lastRes = '';
      rt.on('stats', (s) => {
        if (!alive()) return;
        const v = s.video;
        const o = s.outboundVideo;
        const video = {
          recv: v && v.frameWidth ? { w: v.frameWidth, h: v.frameHeight, fps: v.framesPerSecond, kbps: Math.round(v.bitrate / 1000) } : null,
          send: o && o.frameWidth ? { w: o.frameWidth, h: o.frameHeight, fps: o.framesPerSecond, targetKbps: o.targetBitrateKbps, limit: o.qualityLimitationReason } : null,
          uplinkKbps: s.connection.availableOutgoingBitrate != null ? Math.round(s.connection.availableOutgoingBitrate / 1000) : null,
          rttMs: s.connection.currentRoundTripTime != null ? Math.round(s.connection.currentRoundTripTime * 1000) : null,
        };
        this.store.patch({ video });
        const res = `${video.recv ? `${video.recv.w}x${video.recv.h}` : '-'} / ${video.send ? `${video.send.w}x${video.send.h} ${video.send.limit}` : '-'}`;
        if (res !== lastRes) this.log(`video received / sent: ${res}`);
        lastRes = res;
      });
      let lastQuality = '';
      rt.on('connectionQuality', (q) => {
        const v = JSON.stringify(q).slice(0, 160);
        if (alive() && v !== lastQuality) this.log(`connection quality: ${v}`);
        lastQuality = v;
      });
      rt.on('error', (e) => {
        if (!alive()) return;
        this.log(`error ${e.code}: ${e.message}`);
        this.store.patch({ error: toEngineError(e) });
      });
      rt.on('generationEnded', (g) => {
        if (!alive()) return;
        this.log(`generation ended by server: ${g.reason} after ${g.seconds} s`);
        this.end('ended', { code: 'SESSION_ENDED', message: g.reason });
      });
      rt.on('sessionEnded', (s) => {
        if (!alive()) return;
        this.log(`session ended: ${s.reason}`);
        this.end('ended', { code: 'SESSION_ENDED', message: s.reason });
      });

      this.scheduler = new LookScheduler(
        async (l) => {
          const image = await this.imageFor(l);
          // set() replaces state: always send prompt + image together (docs: avoids flicker, keeps the reference).
          // An empty prompt means image-only (the SDK rejects "" so the field is omitted).
          if (!l.prompt && !image) throw fail('INVALID_INPUT', 'a look needs a prompt or an image');
          await rt.set(l.prompt ? { prompt: l.prompt, enhance: false, image: image ?? null } : { image });
        },
        {
          onApplied: (l, ms) => {
            this.store.patch({ appliedKey: l.key, lastApplyMs: Math.round(ms) });
            this.log(`look ${l.key} applied in ${Math.round(ms)} ms`);
          },
          onError: (l, e) => {
            this.log(`look ${l.key} failed: ${toEngineError(e).message}`);
            this.store.patch({ error: toEngineError(e) });
          },
          onPending: (k) => this.store.patch({ pendingKey: k }),
        },
        this.opts.minGapMs ?? 150,
      );
      this.scheduler.markApplied(look);
      this.store.patch({ appliedKey: look.key, queuePosition: null });
      if (this.store.get().stream) this.store.patch({ status: 'live' });
      else {
        this.log('connected; waiting for the first transformed frame');
        const ms = this.opts.firstFrameTimeoutMs ?? 25_000;
        this.firstFrameTimer = setTimeout(() => {
          if (alive() && !this.store.get().stream) {
            this.log(`no transformed video after ${ms / 1000} s; closing the session so it doesn't bill`);
            this.end('error', { code: 'NO_OUTPUT', message: NO_OUTPUT_HELP });
          }
        }, ms);
      }
      const capMs = this.opts.maxSessionMs ?? 10 * 60_000;
      this.capTimer = setTimeout(() => alive() && this.end('ended', { code: 'SESSION_CAP', message: `stopped after ${capMs / 60_000} min (billing cap)` }), capMs);
      // the slider moved while we were connecting: catch up now
      const queued = this.queued as Look | null; // set by setLook() during the awaits above
      if (queued && queued.key !== look.key) this.scheduler.request(queued);
      this.queued = null;
    } catch (e) {
      if (!alive() && !abandoned) return; // stopped, or superseded by a newer start()
      const err = toEngineError(e, 'CONNECT_FAILED');
      this.log(`start failed ${err.code}: ${err.message}`);
      this.store.patch({ status: 'error', error: err });
      this.teardown();
      throw e;
    }
  }

  /** First transformed video: from here on the session counts as live. */
  private markOutput() {
    if (this.firstFrameTimer) clearTimeout(this.firstFrameTimer);
    this.firstFrameTimer = null;
    if (this.rt && this.store.get().status === 'connecting') this.store.patch({ status: 'live' });
  }

  setLook(look: Look) {
    if (this.scheduler) this.scheduler.request(look);
    else this.queued = look;
  }

  /** Server or cap ended the session: release everything (the SDK only frees media on its own). */
  private end(status: 'ended' | 'error', error: EngineError) {
    this.teardown();
    this.store.patch({ status, error, pendingKey: null });
  }

  private teardown() {
    if (this.capTimer) clearTimeout(this.capTimer);
    this.capTimer = null;
    if (this.firstFrameTimer) clearTimeout(this.firstFrameTimer);
    this.firstFrameTimer = null;
    this.scheduler?.dispose();
    this.scheduler = null;
    const rt = this.rt;
    this.rt = null; // first, so a synchronous 'disconnected' callback sees no session
    try {
      rt?.disconnect();
    } catch {
      /* already closed */
    }
  }

  stop() {
    this.attempt++;
    this.teardown();
    this.queued = null;
    this.store.patch({ status: 'idle', stream: null, pendingKey: null, queuePosition: null });
  }
}
