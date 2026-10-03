import { getAudioEngine } from './audio';
import type { PcmAudio } from '../export/wav';
// Emitted as a real file: an inlined data: URL can be refused by a
// Content-Security-Policy (as in a hardened Electron build).
import tapUrl from './pcm-tap.worklet.js?url&no-inline';

/**
 * Lossless live recording of the master output.
 *
 * Replaces the MediaRecorder path, which captured compressed Opus and then
 * offered a "WAV" that was really that lossy stream decoded and re-wrapped.
 */
export class PcmRecorder {
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[][] = [];
  private sampleRate = 48000;
  private loaded = new WeakSet<BaseAudioContext>();

  get isRecording(): boolean {
    return this.node !== null;
  }

  async start(): Promise<void> {
    if (this.node) return;
    const engine = getAudioEngine();
    const ctx = await engine.getOrCreateAudioContext();
    const out = engine.getOutputNode();
    if (!out) throw new Error('Audio output is unavailable.');

    if (!this.loaded.has(ctx)) {
      await ctx.audioWorklet.addModule(tapUrl);
      this.loaded.add(ctx);
    }

    this.sampleRate = ctx.sampleRate;
    this.chunks = [];
    const node = new AudioWorkletNode(ctx, 'pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    node.port.onmessage = (e: MessageEvent<{ channels?: Float32Array[] }>) => {
      if (e.data.channels) this.chunks.push(e.data.channels);
    };
    // Keep the tap in the rendered graph without adding anything to the output
    const sink = ctx.createGain();
    sink.gain.value = 0;
    out.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    this.node = node;
    this.sink = sink;
  }

  /** Stop and return the take. */
  stop(): Promise<PcmAudio> {
    const node = this.node;
    if (!node) return Promise.reject(new Error('Not recording'));
    return new Promise((resolve) => {
      const prev = node.port.onmessage;
      node.port.onmessage = (e: MessageEvent<{ channels?: Float32Array[]; done?: boolean }>) => {
        if (e.data.channels) prev?.call(node.port, e);
        if (!e.data.done) return;
        try { getAudioEngine().getOutputNode()?.disconnect(node); } catch { /* ignore */ }
        node.disconnect();
        this.sink?.disconnect();
        this.node = null;
        this.sink = null;
        resolve(this.collect());
      };
      node.port.postMessage('stop');
    });
  }

  private collect(): PcmAudio {
    const width = this.chunks[0]?.length ?? 2;
    const total = this.chunks.reduce((s, c) => s + c[0].length, 0);
    const channels = Array.from({ length: width }, () => new Float32Array(total));
    let o = 0;
    for (const c of this.chunks) {
      for (let ch = 0; ch < width; ch++) channels[ch].set(c[ch], o);
      o += c[0].length;
    }
    this.chunks = [];
    return { sampleRate: this.sampleRate, channels };
  }
}

let _rec: PcmRecorder | null = null;
export function getRecorder(): PcmRecorder {
  if (!_rec) _rec = new PcmRecorder();
  return _rec;
}
