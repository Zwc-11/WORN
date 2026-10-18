// The live try-on engine contract. Two implementations:
//   DecartTryOn -> the real thing (Decart realtime over WebRTC)
//   MockTryOn   -> no network, no key: webcam + the stage's garment image drawn on top (UI dev, tests, A's integration)
// Components depend on this interface only, so swapping engines is a prop, not a refactor.

export type ModelChoice = 'lucy-vton-latest' | 'lucy-2.5';

/**
 * How wear reaches the person:
 *  reference-swap -> each stage sends its aged garment still as the reference image (+ matching text)
 *  prompt-only    -> the new product photo stays the reference; only the text describes the wear
 * Which one works is decided at the gate test in the lab, not assumed.
 */
export type Strategy = 'reference-swap' | 'prompt-only';

/** One complete look to show. `key` identifies it so repeated requests are free. */
export interface Look {
  key: string;
  /** '' = image only: the model dresses the person from the reference image alone. */
  prompt: string;
  /** Garment image URL (same-origin path or http URL); the engine resolves it to an uploaded file id. */
  image: string | null;
}

export type EngineStatus =
  | 'idle'
  | 'camera' // asking for the webcam
  | 'preparing' // uploading reference images
  | 'connecting' // WebRTC / queue
  | 'live'
  | 'reconnecting'
  | 'ended' // server ended the session (time cap, credits); restart is possible
  | 'error';

export interface EngineError {
  code: string; // SDK codes (INVALID_API_KEY, WEBRTC_*...) or ours (NO_KEY, CAMERA_DENIED, CONNECT_TIMEOUT, ...)
  message: string;
}

/** From WebRTC stats, once a second while connected. Says where resolution is lost. */
export interface VideoQuality {
  /** the transformed video coming back from Decart */
  recv: { w: number; h: number; fps: number; kbps: number } | null;
  /** the camera video we send; the encoder lowers this when the uplink or CPU can't keep up */
  send: { w: number; h: number; fps: number; targetKbps: number | null; limit: string } | null;
  /** browser's estimate of the available upload bandwidth */
  uplinkKbps: number | null;
  rttMs: number | null;
}

export interface EngineSnapshot {
  status: EngineStatus;
  stream: MediaStream | null; // the transformed video; null until the first frame arrives
  appliedKey: string | null; // the look currently on screen (last set() that resolved)
  pendingKey: string | null; // a look waiting to be sent
  lastApplyMs: number | null; // how long the last set() took to resolve
  billedSeconds: number; // realtime seconds billed this session (from generationTick)
  queuePosition: number | null;
  error: EngineError | null;
  detail: string; // short human text for the lab log
  video: VideoQuality | null;
}

export interface StartInput {
  camera: MediaStream;
  look: Look;
  /** Every image the session may switch to; uploaded once up front so a swap sends only an id. */
  preload: string[];
}

export interface TryOnEngine {
  readonly name: 'decart' | 'mock';
  start(input: StartInput): Promise<void>;
  /** Latest-wins: call it on every slider move; at most one request is in flight. */
  setLook(look: Look): void;
  stop(): void;
  snapshot(): EngineSnapshot;
  subscribe(fn: (s: EngineSnapshot) => void): () => void;
}

export const initialSnapshot = (): EngineSnapshot => ({
  status: 'idle',
  stream: null,
  appliedKey: null,
  pendingKey: null,
  lastApplyMs: null,
  billedSeconds: 0,
  queuePosition: null,
  error: null,
  detail: '',
  video: null,
});

/** One line for the lab: "received 1280x720 · 25 fps · 2400 kbps | sending ...". */
export function describeVideo(v: VideoQuality | null): string {
  if (!v) return 'no video stats yet';
  const r = v.recv ? `received ${v.recv.w}x${v.recv.h} · ${Math.round(v.recv.fps)} fps · ${v.recv.kbps} kbps` : 'received –';
  const s = v.send
    ? `sending ${v.send.w}x${v.send.h} · ${Math.round(v.send.fps)} fps${v.send.limit !== 'none' ? ` (lowered: ${v.send.limit})` : ''}`
    : 'sending –';
  const u = v.uplinkKbps != null ? ` · upload est ${v.uplinkKbps} kbps` : '';
  const rtt = v.rttMs != null ? ` · rtt ${v.rttMs} ms` : '';
  return `${r} | ${s}${u}${rtt}`;
}

/** Small observable store the engines share. */
export class SnapshotStore {
  private s: EngineSnapshot = initialSnapshot();
  private subs = new Set<(s: EngineSnapshot) => void>();
  get(): EngineSnapshot {
    return this.s;
  }
  patch(p: Partial<EngineSnapshot>) {
    this.s = { ...this.s, ...p };
    for (const fn of this.subs) fn(this.s);
  }
  reset() {
    this.s = initialSnapshot();
    for (const fn of this.subs) fn(this.s);
  }
  subscribe(fn: (s: EngineSnapshot) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}

export function toEngineError(e: unknown, fallbackCode = 'UNKNOWN'): EngineError {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; message?: unknown; name?: unknown };
    const code = typeof o.code === 'string' ? o.code : typeof o.name === 'string' && o.name !== 'Error' ? o.name : fallbackCode;
    return { code, message: typeof o.message === 'string' ? o.message : String(e) };
  }
  return { code: fallbackCode, message: String(e) };
}
