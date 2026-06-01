/**
 * RIFF WAV encoder — encodes a decoded AudioBuffer to 16-bit PCM WAV.
 * Header layout: RIFF(12) + fmt(24) + data(8 + samples) = 44 bytes preamble.
 */
export function encodeWAV(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * blockAlign;
  const fileSize = 44 + dataSize;

  const ab = new ArrayBuffer(fileSize);
  const view = new DataView(ab);

  // RIFF chunk
  str4(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  str4(view, 8, 'WAVE');

  // fmt sub-chunk
  str4(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                          // sub-chunk size
  view.setUint16(20, 1, true);                           // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);     // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  str4(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples — interleaved channels
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}

/** Decode a WebM/OGG/MP4 blob via AudioContext, then encode to WAV. */
export async function blobToWAV(blob: Blob, audioCtx: AudioContext): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  return encodeWAV(audioBuf);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke after a short delay so the browser can initiate the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function str4(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
