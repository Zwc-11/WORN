// DecartTryOn against a fake SDK: checks what we send to Decart without a key or a network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (d: unknown) => void;
const sdk = vi.hoisted(() => {
  const state = {
    uploads: [] as Blob[],
    connectOpts: null as null | Record<string, unknown>,
    sets: [] as unknown[],
    handlers: new Map<string, Handler>(),
    disconnects: 0,
    connectDelayMs: 0,
    noOutput: false,
    uploadFails: false,
    duringConnect: null as null | ((opts: Record<string, unknown>) => Promise<void>),
    keyProvider: null as null | (() => Promise<string>),
  };
  const rt = {
    set: async (x: unknown) => void state.sets.push(x),
    on: (ev: string, fn: Handler) => void state.handlers.set(ev, fn),
    disconnect: () => void state.disconnects++,
  };
  return { state, rt };
});

vi.mock('@decartai/sdk', () => ({
  models: { realtime: (name: string) => ({ name, fps: 30, width: 1280, height: 720 }) },
  createDecartClient: (o: { apiKeyProvider: () => Promise<string> }) => {
    sdk.state.keyProvider = o.apiKeyProvider;
    return {
      files: {
        upload: async (b: Blob) => {
          if (sdk.state.uploadFails) throw Object.assign(new Error('upload 500'), { code: 'FILES_UPLOAD_ERROR' });
          sdk.state.uploads.push(b);
          return { id: `file_${sdk.state.uploads.length}` };
        },
      },
      realtime: {
        connect: async (_cam: unknown, opts: Record<string, unknown>) => {
          sdk.state.connectOpts = opts;
          if (sdk.state.duringConnect) await sdk.state.duringConnect(opts);
          await new Promise((r) => setTimeout(r, sdk.state.connectDelayMs));
          // like the SDK: state goes 'connected' and the stream arrives before connect() resolves
          (opts.onConnectionChange as (s: string) => void)?.('connected');
          if (!sdk.state.noOutput) (opts.onRemoteStream as (s: unknown) => void)({ fake: 'stream', getVideoTracks: () => [1] });
          return sdk.rt;
        },
      },
    };
  },
}));

import { DecartTryOn, _clearRefCache } from './DecartTryOn';
import { describeVideo } from './types';

const health = (configured: boolean) => ({ ok: true, json: async () => ({ configured }) });
function stubFetch(configured = true) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, _init?: unknown) => {
      calls.push(url);
      if (url.endsWith('/health')) return health(configured);
      if (url.endsWith('/token')) return { ok: true, json: async () => ({ apiKey: 'ek_x' }) };
      if (url.endsWith('/upload')) {
        if (sdk.state.uploadFails) return { ok: false, status: 502, json: async () => ({ error: { code: 'FILES_UPLOAD_ERROR', message: 'upload 500' } }) };
        const body = (_init as { body: Blob }).body;
        sdk.state.uploads.push(body);
        const name = (await body.text()).replace(/^\/img\/|\.png$/g, ''); // the fake image's bytes are its URL
        return { ok: true, json: async () => ({ id: `file_${name}` }) };
      }
      return { ok: true, blob: async () => new Blob([url], { type: 'image/png' }) };
    }),
  );
  return calls;
}
const look = (k: string, image: string | null = `/img/${k}.png`) => ({ key: k, prompt: `prompt ${k}`, image });
const cam = {} as MediaStream;

beforeEach(() => {
  Object.assign(sdk.state, { uploads: [], connectOpts: null, sets: [], handlers: new Map(), disconnects: 0, connectDelayMs: 0, noOutput: false, uploadFails: false, duringConnect: null });
  _clearRefCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DecartTryOn', () => {
  it('uploads each image once, connects with the first look, and goes live', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest' });
    await e.start({ camera: cam, look: look('a'), preload: ['/img/a.png', '/img/b.png', '/img/a.png'] });
    expect(sdk.state.uploads.length).toBe(2);
    const o = sdk.state.connectOpts!;
    expect((o.model as { name: string }).name).toBe('lucy-vton-latest');
    expect(o.mirror).toBe(true);
    expect(o.initialState).toEqual({ prompt: { text: 'prompt a', enhance: false }, image: 'file_a' });
    expect(o.speed).toBeUndefined();
    expect(e.snapshot().status).toBe('live');
    expect(e.snapshot().stream).toMatchObject({ fake: 'stream' });
    expect(e.snapshot().appliedKey).toBe('a');
  });

  it('setLook sends prompt AND image id together (set() replaces state)', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest', minGapMs: 0 });
    await e.start({ camera: cam, look: look('a'), preload: ['/img/a.png', '/img/b.png'] });
    e.setLook(look('b'));
    await vi.waitFor(() => expect(sdk.state.sets.length).toBe(1));
    expect(sdk.state.sets[0]).toEqual({ prompt: 'prompt b', enhance: false, image: 'file_b' });
    await vi.waitFor(() => expect(e.snapshot().appliedKey).toBe('b'));
    e.setLook(look('b'));
    await new Promise((r) => setTimeout(r, 5));
    expect(sdk.state.sets.length).toBe(1); // same look again: nothing sent
  });

  it('falls back to sending bytes when an upload fails', async () => {
    stubFetch();
    sdk.state.uploadFails = true;
    const e = new DecartTryOn({ model: 'lucy-vton-latest' });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    expect((sdk.state.connectOpts!.initialState as { image: unknown }).image).toBeInstanceOf(Blob);
  });

  it('fails fast with NO_KEY when the server has no key, without dialing', async () => {
    const calls = stubFetch(false);
    const e = new DecartTryOn({ model: 'lucy-vton-latest' });
    await expect(e.start({ camera: cam, look: look('a'), preload: ['/img/a.png'] })).rejects.toThrow();
    expect(e.snapshot().status).toBe('error');
    expect(e.snapshot().error?.code).toBe('NO_KEY');
    expect(sdk.state.connectOpts).toBeNull();
    expect(calls.filter((u) => u.endsWith('/token')).length).toBe(0);
  });

  it('times out a slow connect and closes it when it lands late (no billing in the background)', async () => {
    stubFetch();
    sdk.state.connectDelayMs = 200;
    const e = new DecartTryOn({ model: 'lucy-2.5', connectTimeoutMs: 50 });
    await expect(e.start({ camera: cam, look: look('a'), preload: [] })).rejects.toThrow(/no connection/);
    expect(e.snapshot().error?.code).toBe('CONNECT_TIMEOUT');
    await new Promise((r) => setTimeout(r, 250));
    expect(sdk.state.disconnects).toBe(1);
  });

  it('a connect that lands after the timeout cannot flip the UI back to live', async () => {
    stubFetch();
    sdk.state.connectDelayMs = 150;
    const e = new DecartTryOn({ model: 'lucy-vton-latest', connectTimeoutMs: 40 });
    await expect(e.start({ camera: cam, look: look('a'), preload: [] })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 200));
    expect(e.snapshot().status).toBe('error');
    expect(e.snapshot().stream).toBeNull();
    expect(sdk.state.disconnects).toBe(1);
  });

  it('queue progress extends the connect timeout instead of throwing the slot away', async () => {
    stubFetch();
    sdk.state.duringConnect = async (o) => {
      for (let i = 5; i > 0; i--) {
        (o.onQueuePosition as (q: unknown) => void)({ position: i, queueSize: 9 });
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    const e = new DecartTryOn({ model: 'lucy-vton-latest', connectTimeoutMs: 60 });
    await e.start({ camera: cam, look: look('a'), preload: [] }); // 150 ms total > 60 ms timeout
    expect(e.snapshot().status).toBe('live');
  });

  it('a slider move during connect is applied once live', async () => {
    stubFetch();
    sdk.state.connectDelayMs = 30;
    const e = new DecartTryOn({ model: 'lucy-vton-latest', minGapMs: 0 });
    const p = e.start({ camera: cam, look: look('a'), preload: ['/img/a.png', '/img/c.png'] });
    await new Promise((r) => setTimeout(r, 10));
    e.setLook(look('c'));
    await p;
    await vi.waitFor(() => expect(e.snapshot().appliedKey).toBe('c'));
    expect(sdk.state.sets).toEqual([{ prompt: 'prompt c', enhance: false, image: 'file_c' }]);
  });

  it('server "generation ended" ends and disconnects (no silent redial with a fresh token)', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest' });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    sdk.state.handlers.get('generationEnded')!({ seconds: 900, reason: 'timeout' });
    expect(e.snapshot().status).toBe('ended');
    expect(sdk.state.disconnects).toBe(1);
  });

  it('reports received and sent resolution from WebRTC stats', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest' });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    sdk.state.handlers.get('stats')!({
      video: { frameWidth: 640, frameHeight: 360, framesPerSecond: 24, bitrate: 900_000 },
      outboundVideo: { frameWidth: 320, frameHeight: 180, framesPerSecond: 15, targetBitrateKbps: 300, qualityLimitationReason: 'bandwidth' },
      connection: { availableOutgoingBitrate: 450_000, currentRoundTripTime: 0.08 },
    });
    expect(e.snapshot().video).toEqual({
      recv: { w: 640, h: 360, fps: 24, kbps: 900 },
      send: { w: 320, h: 180, fps: 15, targetKbps: 300, limit: 'bandwidth' },
      uplinkKbps: 450,
      rttMs: 80,
    });
    expect(describeVideo(e.snapshot().video)).toBe('received 640x360 · 24 fps · 900 kbps | sending 320x180 · 15 fps (lowered: bandwidth) · upload est 450 kbps · rtt 80 ms');
  });

  it('ends the session itself at the billing cap', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest', maxSessionMs: 30 });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    await new Promise((r) => setTimeout(r, 60));
    expect(e.snapshot().status).toBe('ended');
    expect(e.snapshot().error?.code).toBe('SESSION_CAP');
    expect(sdk.state.disconnects).toBe(1);
  });

  it('a terminal disconnect releases the session', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest' });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    (sdk.state.connectOpts!.onConnectionChange as (s: string) => void)('disconnected');
    expect(e.snapshot().status).toBe('error');
    expect(e.snapshot().error?.code).toBe('DISCONNECTED');
    expect(sdk.state.disconnects).toBe(1);
  });

  it('reuses uploads across engines (Retry does not re-upload)', async () => {
    stubFetch();
    await new DecartTryOn({ model: 'lucy-vton-latest' }).start({ camera: cam, look: look('a'), preload: ['/img/a.png', '/img/b.png'] });
    await new DecartTryOn({ model: 'lucy-vton-latest' }).start({ camera: cam, look: look('a'), preload: ['/img/a.png', '/img/b.png'] });
    expect(sdk.state.uploads.length).toBe(2);
  });

  it('passes fast mode and self_anchor=false through at connect time', async () => {
    stubFetch();
    await new DecartTryOn({ model: 'lucy-2.5', fast: true, selfAnchor: false, mirror: false }).start({ camera: cam, look: look('a'), preload: [] });
    expect(sdk.state.connectOpts).toMatchObject({ speed: 'fast', queryParams: { self_anchor: 'false' }, mirror: false });
  });

  it('reports a server-ended session as "ended" and stops sending looks', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest', minGapMs: 0 });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    sdk.state.handlers.get('sessionEnded')!({ reason: 'insufficient_credits' });
    expect(e.snapshot().status).toBe('ended');
    expect(sdk.state.disconnects).toBe(1); // SDK only frees media itself; we release the rest
    expect(e.snapshot().error?.message).toBe('insufficient_credits');
    e.setLook(look('b'));
    await new Promise((r) => setTimeout(r, 5));
    expect(sdk.state.sets.length).toBe(0);
  });

  it('the key provider returns the client token from our server', async () => {
    stubFetch();
    new DecartTryOn({ model: 'lucy-vton-latest' });
    expect(await sdk.state.keyProvider!()).toBe('ek_x');
  });

  it('stop() disconnects and returns to idle', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest' });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    e.stop();
    expect(sdk.state.disconnects).toBe(1);
    expect(e.snapshot().status).toBe('idle');
    expect(e.snapshot().stream).toBeNull();
  });
});

describe('image-only looks', () => {
  it('omit the prompt in initialState and set() (the SDK rejects empty prompts)', async () => {
    stubFetch();
    const e = new DecartTryOn({ model: 'lucy-vton-latest', minGapMs: 0 });
    await e.start({ camera: cam, look: { key: 'a', prompt: '', image: '/img/a.png' }, preload: ['/img/b.png'] });
    expect(sdk.state.connectOpts!.initialState).toEqual({ image: 'file_a' });
    e.setLook({ key: 'b', prompt: '', image: '/img/b.png' });
    await vi.waitFor(() => expect(sdk.state.sets.length).toBe(1));
    expect(sdk.state.sets[0]).toEqual({ image: 'file_b' });
  });
});

describe('connected is not live', () => {
  it('stays "connecting" until transformed video arrives, then fails with NO_OUTPUT and disconnects', async () => {
    stubFetch();
    sdk.state.noOutput = true;
    const e = new DecartTryOn({ model: 'lucy-vton-latest', firstFrameTimeoutMs: 40 });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    expect(e.snapshot().status).toBe('connecting');
    await new Promise((r) => setTimeout(r, 80));
    expect(e.snapshot().status).toBe('error');
    expect(e.snapshot().error?.code).toBe('NO_OUTPUT');
    expect(sdk.state.disconnects).toBe(1);
  });
  it('a late remote stream turns the session live', async () => {
    stubFetch();
    sdk.state.noOutput = true;
    const e = new DecartTryOn({ model: 'lucy-vton-latest', firstFrameTimeoutMs: 1000 });
    await e.start({ camera: cam, look: look('a'), preload: [] });
    (sdk.state.connectOpts!.onRemoteStream as (s: unknown) => void)({ late: true, getVideoTracks: () => [1] });
    expect(e.snapshot().status).toBe('live');
    e.stop();
  });
});
