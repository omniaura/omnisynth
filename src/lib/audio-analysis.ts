/**
 * Local audio analysis for attached songs. Runs in the renderer with Web
 * Audio so every Perceive model (even text/image-only ones) gets tempo, key,
 * energy and timbre facts; models that accept audio get the clip as well.
 */

export interface AudioFeatures {
  durationSec: number;
  bpm: number;
  bpmConfidence: number;
  key: string;
  scale: "major" | "minor";
  loudnessDb: number;
  /** 0..1 energy over 8 equal time slices (arrangement shape). */
  energyCurve: number[];
  /** Spectral centroid in Hz (brightness). */
  brightnessHz: number;
  /** Fraction of energy below 150 Hz. */
  bassRatio: number;
}

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
// Krumhansl-Schmuckler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export async function analyzeAudio(base64: string, mime: string): Promise<AudioFeatures> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  void mime;
  // Mono mixdown, analyze at most 90 s from 10% in to skip silence/intros.
  const sr = buffer.sampleRate;
  const total = buffer.length;
  const start = Math.floor(total * 0.1);
  const len = Math.min(total - start, sr * 90);
  const mono = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[start + i] / buffer.numberOfChannels;
  }

  // Onset envelope via frame RMS differences.
  const hop = 512;
  const frames = Math.floor(len / hop);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < hop; i++) {
      const v = mono[f * hop + i];
      s += v * v;
    }
    rms[f] = Math.sqrt(s / hop);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, rms[f] - rms[f - 1]);

  // Autocorrelation over 60–190 BPM lags.
  const fps = sr / hop;
  let bestLag = 0;
  let bestVal = -1;
  let second = 0;
  const minLag = Math.round((60 / 190) * fps);
  const maxLag = Math.round((60 / 60) * fps);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let f = 0; f + lag < frames; f++) acc += onset[f] * onset[f + lag];
    if (acc > bestVal) {
      second = bestVal;
      bestVal = acc;
      bestLag = lag;
    } else if (acc > second) second = acc;
  }
  let bpm = bestLag ? Math.round((60 * fps) / bestLag) : 120;
  // Fold into the electronic-music range.
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  const bpmConfidence = bestVal > 0 ? Math.max(0, Math.min(1, 1 - second / bestVal)) : 0;

  // Chroma via a modest DFT on a few evenly spaced windows.
  const chroma = new Float64Array(12);
  const N = 4096;
  const windows = 12;
  let centroidAcc = 0;
  let centroidW = 0;
  let bassAcc = 0;
  let allAcc = 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let w = 0; w < windows; w++) {
    const off = Math.floor(((len - N) * w) / Math.max(1, windows - 1));
    for (let i = 0; i < N; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      re[i] = (mono[off + i] ?? 0) * hann;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const freq = (k * sr) / N;
      const mag = Math.hypot(re[k], im[k]);
      allAcc += mag;
      if (freq < 150) bassAcc += mag;
      centroidAcc += freq * mag;
      centroidW += mag;
      if (freq >= 55 && freq <= 2000) {
        const midi = 69 + 12 * Math.log2(freq / 440);
        chroma[((Math.round(midi) % 12) + 12) % 12] += mag;
      }
    }
  }
  let key = "C";
  let scale: "major" | "minor" = "minor";
  let best = -Infinity;
  for (let root = 0; root < 12; root++) {
    for (const [profile, name] of [
      [MAJOR, "major"],
      [MINOR, "minor"],
    ] as const) {
      let score = 0;
      for (let i = 0; i < 12; i++) score += profile[i] * chroma[(root + i) % 12];
      if (score > best) {
        best = score;
        key = NOTE_NAMES[root];
        scale = name;
      }
    }
  }

  const slices = 8;
  const energyCurve: number[] = [];
  let peak = 0;
  for (let s = 0; s < slices; s++) {
    const a = Math.floor((frames * s) / slices);
    const b = Math.floor((frames * (s + 1)) / slices);
    let acc = 0;
    for (let f = a; f < b; f++) acc += rms[f];
    const v = acc / Math.max(1, b - a);
    energyCurve.push(v);
    peak = Math.max(peak, v);
  }
  const meanRms = rms.reduce((a, b) => a + b, 0) / Math.max(1, frames);

  return {
    durationSec: Math.round(buffer.duration),
    bpm,
    bpmConfidence: Math.round(bpmConfidence * 100) / 100,
    key,
    scale,
    loudnessDb: Math.round(20 * Math.log10(Math.max(1e-6, meanRms))),
    energyCurve: energyCurve.map((v) => Math.round((v / Math.max(1e-6, peak)) * 100) / 100),
    brightnessHz: Math.round(centroidW ? centroidAcc / centroidW : 0),
    bassRatio: Math.round((allAcc ? bassAcc / allAcc : 0) * 100) / 100,
  };
}

export function describeFeatures(name: string, f: AudioFeatures): string {
  const shape = f.energyCurve.map((v) => (v > 0.8 ? "█" : v > 0.6 ? "▆" : v > 0.4 ? "▄" : v > 0.2 ? "▂" : "_")).join("");
  return `Audio analysis of "${name}": ${f.durationSec}s, ≈${f.bpm} BPM (confidence ${f.bpmConfidence}), key ≈ ${f.key} ${f.scale}, loudness ${f.loudnessDb} dBFS, brightness ${f.brightnessHz} Hz, bass share ${Math.round(f.bassRatio * 100)}%, energy over time ${shape}`;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < size / 2; j++) {
        const k = i + j;
        const l = k + size / 2;
        const tr = re[l] * cr - im[l] * ci;
        const ti = re[l] * ci + im[l] * cr;
        re[l] = re[k] - tr;
        im[l] = im[k] - ti;
        re[k] += tr;
        im[k] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
