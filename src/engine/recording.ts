export interface RecordedTrack {
  blob: Blob;
  durationMs: number;
  timestamp: string;   // safe for filenames: YYYY-MM-DDTHH-MM-SS
  mimeType: string;
}

export class RecordingEngine {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startTime = 0;
  private dest: MediaStreamAudioDestinationNode;
  readonly mimeType: string;

  constructor(dest: MediaStreamAudioDestinationNode) {
    this.dest = dest;
    this.mimeType = RecordingEngine.bestFormat();
  }

  static bestFormat(): string {
    return (
      ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        (f) => MediaRecorder.isTypeSupported(f),
      ) ?? ''
    );
  }

  get isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  start(): void {
    if (this.isRecording) return;
    this.chunks = [];
    const opts: MediaRecorderOptions = this.mimeType ? { mimeType: this.mimeType } : {};
    this.mediaRecorder = new MediaRecorder(this.dest.stream, opts);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(100); // collect in 100ms chunks
    this.startTime = Date.now();
  }

  stop(): Promise<RecordedTrack> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error('Not currently recording'));
        return;
      }
      const durationMs = Date.now() - this.startTime;
      this.mediaRecorder.onstop = () => {
        const type = this.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        const timestamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[T:]/g, (c) => (c === 'T' ? 'T' : '-'));
        resolve({ blob, durationMs, timestamp, mimeType: type });
      };
      this.mediaRecorder.stop();
    });
  }
}
