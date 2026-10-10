/**
 * Estimates how busy the audio thread is.
 *
 * The browser renders audio in bursts: when the device asks for a buffer, the
 * whole graph is rendered several 128-frame quanta in a row, then the thread
 * sleeps until the next request. This node is part of every quantum, so the
 * time between two of its calls inside a burst is how long one quantum of the
 * whole graph took to render. Busy time over wall time is the load.
 *
 * When the device takes one quantum per request there are no bursts to
 * measure, and the probe reports no load (null) rather than a wrong one.
 */
const now = typeof performance !== 'undefined' && performance.now
  ? () => performance.now()
  : () => Date.now();

const WINDOW_MS = 500;

class LoadProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.quantumMs = (128 / sampleRate) * 1000;
    this.last = 0;
    this.windowStart = 0;
    this.busy = 0;       // summed gaps inside bursts
    this.inside = 0;     // number of those gaps
    this.bursts = 0;
  }

  process() {
    const t = now();
    if (!this.last) {
      this.windowStart = t;
    } else {
      const gap = t - this.last;
      if (gap < this.quantumMs * 0.9) {
        this.busy += gap;
        this.inside++;
      } else {
        this.bursts++;
      }
    }
    this.last = t;

    const span = t - this.windowStart;
    if (span >= WINDOW_MS) {
      let load = null;
      if (this.inside > this.bursts) {
        // Each burst's last quantum has no following gap; count it at the average
        const mean = this.busy / this.inside;
        load = Math.min(1.5, (this.busy + mean * this.bursts) / span);
      }
      this.port.postMessage({ load });
      this.windowStart = t;
      this.busy = 0;
      this.inside = 0;
      this.bursts = 0;
    }
    return true;
  }
}

registerProcessor('osc-load-probe', LoadProbe);
