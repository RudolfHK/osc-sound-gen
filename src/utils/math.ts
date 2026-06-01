export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export type ColorTheme = 'green' | 'amber' | 'blue' | 'white';

export const THEME_COLORS: Record<ColorTheme, string> = {
  green: '#00ff88',
  amber: '#ffb000',
  blue: '#00aaff',
  white: '#f0f0f0',
};

export function computeSample(
  waveform: Waveform,
  t: number,
  freq: number,
  amplitude: number,
  phaseRad: number,
  pulseWidth: number,
): number {
  const phase = 2 * Math.PI * freq * t + phaseRad;
  switch (waveform) {
    case 'sine':
      return amplitude * Math.sin(phase);
    case 'square': {
      // Fractional position within the period [0, 1)
      const pos = (((freq * t + phaseRad / (2 * Math.PI)) % 1) + 1) % 1;
      return amplitude * (pos < pulseWidth ? 1 : -1);
    }
    case 'sawtooth':
      // Ramp up: -1 at start of period, +1 at end
      return amplitude * (2 * (((freq * t + phaseRad / (2 * Math.PI)) % 1 + 1) % 1) - 1);
    case 'triangle':
      return amplitude * (2 / Math.PI) * Math.asin(Math.sin(phase));
  }
}

/** Map linear slider [0,1] → logarithmic frequency [20, 20000] Hz */
export function linearToLogFreq(v: number): number {
  return 20 * Math.pow(1000, v);
}

/** Map frequency [20, 20000] Hz → linear slider [0,1] */
export function logFreqToLinear(freq: number): number {
  return Math.log(freq / 20) / Math.log(1000);
}

/** Clamp value to [min, max] */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Compute the Fourier series coefficients for a square wave with
 * duty cycle D.  Returns arrays suitable for Web Audio createPeriodicWave.
 *
 * f(t) = 1  for 0 ≤ (t mod T) < D·T
 *       -1  for D·T ≤ (t mod T) < T
 *
 * DC:     real[0] = 2D − 1
 * cosine: real[n] = 2·sin(2πnD) / (πn)
 * sine:   imag[n] = 2·(1 − cos(2πnD)) / (πn)
 */
export function squareWaveCoefficients(
  pulseWidth: number,
  numHarmonics = 256,
): [Float32Array, Float32Array] {
  const real = new Float32Array(numHarmonics + 1);
  const imag = new Float32Array(numHarmonics + 1);
  const D = pulseWidth;

  // DC component
  real[0] = 2 * D - 1;

  for (let n = 1; n <= numHarmonics; n++) {
    const npi = n * Math.PI;
    real[n] = (2 * Math.sin(2 * npi * D)) / npi;
    imag[n] = (2 * (1 - Math.cos(2 * npi * D))) / npi;
  }

  return [real, imag];
}

/** Effective frequency accounting for cents offset */
export function applyDetune(freq: number, cents: number): number {
  return freq * Math.pow(2, cents / 1200);
}
