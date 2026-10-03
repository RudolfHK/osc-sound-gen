/**
 * AudioWorklet that copies whatever reaches it into batches of raw float
 * samples and posts them to the main thread. This is what makes live
 * recording lossless: the take is the exact PCM the speakers received, not a
 * compressed stream decoded afterwards.
 */
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = 4096;
    this.buf = null;
    this.fill = 0;
    this.recording = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  flush() {
    if (!this.buf || this.fill === 0) return;
    const out = this.buf.map((c) => c.slice(0, this.fill));
    this.port.postMessage({ channels: out }, out.map((c) => c.buffer));
    this.buf = null;
    this.fill = 0;
  }

  process(inputs) {
    if (!this.recording) return false;
    const input = inputs[0];
    // No input connected yet (or a silent graph): record silence of the right width
    const chans = input && input.length ? input : [new Float32Array(128), new Float32Array(128)];
    if (!this.buf) this.buf = chans.map(() => new Float32Array(this.batch));
    const n = chans[0].length;
    for (let ch = 0; ch < this.buf.length; ch++) {
      this.buf[ch].set(chans[Math.min(ch, chans.length - 1)].subarray(0, n), this.fill);
    }
    this.fill += n;
    if (this.fill + 128 > this.batch) this.flush();
    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);
