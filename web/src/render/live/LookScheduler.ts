// Latest-wins request coalescing for realtime set() calls.
// A slider drag can produce 60 stage requests a second; the model needs at most one at a time.
// Rules: one apply in flight; while it runs, newer requests overwrite each other (only the last
// survives); a request equal to what is already on screen is dropped; at least `minGapMs` between
// applies so a drag doesn't queue a burst at the server.

import type { Look } from './types';

export interface SchedulerEvents {
  onApplied?: (look: Look, ms: number) => void;
  onError?: (look: Look, err: unknown) => void;
  onPending?: (key: string | null) => void;
}

export class LookScheduler {
  private pending: Look | null = null;
  private applied: Look | null = null;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastStart = -Infinity;
  private disposed = false;

  constructor(
    private readonly apply: (look: Look) => Promise<void>,
    private readonly ev: SchedulerEvents = {},
    private readonly minGapMs = 150,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Record a look that is already on screen (e.g. sent as initialState at connect). */
  markApplied(look: Look) {
    this.applied = look;
  }

  get appliedKey() {
    return this.applied?.key ?? null;
  }

  request(look: Look) {
    if (this.disposed) return;
    if (!this.inFlight && this.applied?.key === look.key) {
      this.setPending(null);
      return;
    }
    this.setPending(look);
    this.pump();
  }

  dispose() {
    this.disposed = true;
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setPending(l: Look | null) {
    this.pending = l;
    this.ev.onPending?.(l?.key ?? null);
  }

  private pump() {
    if (this.disposed || this.inFlight || this.timer || !this.pending) return;
    if (this.pending.key === this.applied?.key) {
      this.setPending(null);
      return;
    }
    const wait = this.minGapMs - (this.now() - this.lastStart);
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
      return;
    }
    const look = this.pending;
    this.setPending(null);
    this.inFlight = true;
    this.lastStart = this.now();
    const t0 = this.lastStart;
    this.apply(look).then(
      () => {
        this.inFlight = false;
        if (this.disposed) return;
        this.applied = look;
        this.ev.onApplied?.(look, this.now() - t0);
        this.pump();
      },
      (err) => {
        this.inFlight = false;
        if (this.disposed) return;
        this.ev.onError?.(look, err);
        this.pump();
      },
    );
  }
}
