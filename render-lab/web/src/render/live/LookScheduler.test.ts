import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LookScheduler } from './LookScheduler';
import type { Look } from './types';

const look = (k: string): Look => ({ key: k, prompt: `p-${k}`, image: null });

describe('LookScheduler', () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
  });
  afterEach(() => vi.useRealTimers());
  const now = () => clock;
  const advance = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };

  function deferredApply() {
    const calls: { look: Look; resolve: () => void; reject: (e: unknown) => void }[] = [];
    const apply = (l: Look) => new Promise<void>((resolve, reject) => calls.push({ look: l, resolve, reject }));
    return { calls, apply };
  }

  it('sends only the latest request after an in-flight apply (a drag collapses to its end)', async () => {
    const { calls, apply } = deferredApply();
    const s = new LookScheduler(apply, {}, 100, now);
    s.request(look('1'));
    expect(calls.map((c) => c.look.key)).toEqual(['1']);
    s.request(look('2'));
    s.request(look('3'));
    s.request(look('4'));
    calls[0].resolve();
    await advance(100);
    expect(calls.map((c) => c.look.key)).toEqual(['1', '4']);
    calls[1].resolve();
    await advance(500);
    expect(calls.length).toBe(2);
    expect(s.appliedKey).toBe('4');
  });

  it('drops a request for the look already on screen', async () => {
    const { calls, apply } = deferredApply();
    const s = new LookScheduler(apply, {}, 0, now);
    s.markApplied(look('0'));
    s.request(look('0'));
    await advance(10);
    expect(calls.length).toBe(0);
  });

  it('drops a pending request that returns to the applied look before it is sent', async () => {
    const { calls, apply } = deferredApply();
    const s = new LookScheduler(apply, {}, 100, now);
    s.markApplied(look('0'));
    s.request(look('1')); // sent
    s.request(look('2')); // pending
    s.request(look('1')); // back to what is in flight -> pending '1'
    calls[0].resolve();
    await advance(200);
    expect(calls.map((c) => c.look.key)).toEqual(['1']);
  });

  it('keeps a minimum gap between applies', async () => {
    const applied: number[] = [];
    const s = new LookScheduler(async () => void applied.push(clock), {}, 150, now);
    s.request(look('a'));
    await advance(1);
    s.request(look('b'));
    await advance(100);
    expect(applied.length).toBe(1);
    await advance(60);
    expect(applied.length).toBe(2);
    expect(applied[1] - applied[0]).toBeGreaterThanOrEqual(150);
  });

  it('reports errors, keeps the previous look as applied, and continues with newer requests', async () => {
    const errors: string[] = [];
    let n = 0;
    const s = new LookScheduler(
      async () => {
        if (n++ === 0) throw new Error('boom');
      },
      { onError: (l) => errors.push(l.key) },
      0,
      now,
    );
    s.markApplied(look('0'));
    s.request(look('1'));
    await advance(1);
    expect(errors).toEqual(['1']);
    expect(s.appliedKey).toBe('0');
    s.request(look('2'));
    await advance(1);
    expect(s.appliedKey).toBe('2');
  });

  it('does nothing after dispose', async () => {
    const { calls, apply } = deferredApply();
    const s = new LookScheduler(apply, {}, 0, now);
    s.dispose();
    s.request(look('1'));
    await advance(10);
    expect(calls.length).toBe(0);
  });
});
