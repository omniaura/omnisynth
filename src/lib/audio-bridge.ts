// Audio bridge to connect Strudel's audio output to Hydra's audio reactivity

export interface AudioBridge {
  analyser: AnalyserNode;
  dataArray: Uint8Array;
  frequencyBands: Float32Array;
}

let bridge: AudioBridge | null = null;

export function createAudioBridge(audioContext: AudioContext): AudioBridge {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  const frequencyBands = new Float32Array(4); // 4 frequency bands for Hydra's a.fft

  bridge = {
    analyser,
    dataArray,
    frequencyBands,
  };

  return bridge;
}

export function getAudioBridge(): AudioBridge | null {
  return bridge;
}

// Get normalized frequency band values (0-1) for Hydra
export function getFrequencyBands(): Float32Array {
  if (!bridge) {
    return new Float32Array(4);
  }

  bridge.analyser.getByteFrequencyData(bridge.dataArray);

  const bandSize = Math.floor(bridge.dataArray.length / 4);

  for (let i = 0; i < 4; i++) {
    let sum = 0;
    const start = i * bandSize;
    const end = start + bandSize;

    for (let j = start; j < end; j++) {
      sum += bridge.dataArray[j];
    }

    // Normalize to 0-1 range
    bridge.frequencyBands[i] = sum / (bandSize * 255);
  }

  return bridge.frequencyBands;
}

// Custom Audio class for Hydra that reads from our analyser
export class HydraAudioBridge {
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private bins: number = 4;
  private smooth: number = 0.4;
  private values: number[] = [0, 0, 0, 0];

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  setSmooth(value: number): void {
    this.smooth = Math.max(0, Math.min(1, value));
  }

  setBins(count: number): void {
    this.bins = Math.max(1, Math.min(16, count));
    this.values = new Array(this.bins).fill(0);
  }

  // Get FFT value for a specific bin (0-1 normalized)
  fft(bin: number): number {
    this.analyser.getByteFrequencyData(this.dataArray);

    const binSize = Math.floor(this.dataArray.length / this.bins);
    const start = bin * binSize;
    const end = Math.min(start + binSize, this.dataArray.length);

    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += this.dataArray[i];
    }

    const rawValue = sum / ((end - start) * 255);

    // Apply smoothing
    this.values[bin] =
      this.values[bin] * this.smooth + rawValue * (1 - this.smooth);

    return this.values[bin];
  }
}

