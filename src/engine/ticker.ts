import type { TickerRequest } from './ticker.worker';

/**
 * Calls `fn` every `ms` milliseconds, driven by a worker so the beat keeps
 * going in a background tab. Falls back to a main-thread interval where
 * workers aren't available.
 */
export class Ticker {
  private worker: Worker | null = null;
  private fallback: ReturnType<typeof setInterval> | null = null;
  private fn: (() => void) | null = null;

  start(ms: number, fn: () => void): void {
    this.stop();
    this.fn = fn;
    const w = this.ensureWorker();
    if (w) {
      w.postMessage({ cmd: 'start', ms } satisfies TickerRequest);
    } else {
      this.fallback = setInterval(() => this.fn?.(), ms);
    }
  }

  stop(): void {
    this.fn = null;
    this.worker?.postMessage({ cmd: 'stop' } satisfies TickerRequest);
    if (this.fallback !== null) clearInterval(this.fallback);
    this.fallback = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' });
      // A tick that arrives after stop() is ignored: `fn` is already cleared
      this.worker.onmessage = () => this.fn?.();
      return this.worker;
    } catch {
      return null;
    }
  }
}
