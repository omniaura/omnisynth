/**
 * Instrument presets and patch types for the OmniSynth engine.
 * Ported from MIDI Gen (omarzanji/midi-gen) and typed; the tool schema in
 * src/agent/tools.ts is derived from these so the agent and engine agree.
 */

export type SynthType =
  | "Synth"
  | "FMSynth"
  | "AMSynth"
  | "MonoSynth"
  | "DuoSynth"
  | "MetalSynth"
  | "MembraneSynth"
  | "PluckSynth"
  | "NoiseSynth";

export const SYNTH_TYPES: SynthType[] = ["Synth", "FMSynth", "AMSynth", "MonoSynth", "DuoSynth", "MetalSynth", "MembraneSynth", "PluckSynth", "NoiseSynth"];

export const OSCILLATOR_TYPES = ["sine", "square", "sawtooth", "triangle", "fatsawtooth", "fatsquare", "fattriangle", "fatsine", "pwm", "pulse", "amtriangle", "amsine", "fmtriangle", "fmsine"] as const;
export type OscillatorType = (typeof OSCILLATOR_TYPES)[number];

export type EffectType =
  | "reverb"
  | "delay"
  | "chorus"
  | "distortion"
  | "phaser"
  | "tremolo"
  | "bitcrusher"
  | "autofilter"
  | "eq"
  | "compressor"
  | "filter";

export const EFFECT_TYPES: EffectType[] = ["reverb", "delay", "chorus", "distortion", "phaser", "tremolo", "bitcrusher", "autofilter", "eq", "compressor", "filter"];

/** Loose effect config: `type` plus whatever Tone options that effect takes. */
export interface EffectConfig {
  type: EffectType | string;
  wet?: number;
  [key: string]: unknown;
}

export interface Patch {
  type: SynthType;
  /** Tone.js constructor options for the synth class. */
  options: Record<string, unknown>;
  effects?: EffectConfig[];
  custom?: boolean;
  name?: string;
}

export const DRUM_INSTRUMENTS = new Set(["kick", "tom", "snare", "hihat", "cymbal", "noise-sweep", "metallic-perc", "glitch-perc", "clap", "rim"]);
export const MEMBRANE_INSTRUMENTS = new Set(["kick", "tom"]);
/** Synth classes that are monophonic / untuned and must not be wrapped in PolySynth. */
export const MONO_TYPES = new Set<SynthType>(["NoiseSynth", "MetalSynth", "MembraneSynth", "PluckSynth", "MonoSynth", "DuoSynth"]);

export const INSTRUMENT_PRESETS: Record<string, Patch> = {
  // Synths
  synth: { type: "Synth", options: { oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 } } },
  "fat-synth": { type: "Synth", options: { oscillator: { type: "fatsawtooth", count: 3, spread: 30 }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.4 } } },
  "square-synth": { type: "Synth", options: { oscillator: { type: "square" }, envelope: { attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.2 } } },
  "sine-pad": { type: "Synth", options: { oscillator: { type: "sine" }, envelope: { attack: 0.5, decay: 0.5, sustain: 0.8, release: 1.0 } } },

  // FM
  "fm-bass": { type: "FMSynth", options: { harmonicity: 1, modulationIndex: 3, envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.2 }, modulation: { type: "square" } } },
  "fm-bell": { type: "FMSynth", options: { harmonicity: 5.1, modulationIndex: 10, envelope: { attack: 0.001, decay: 1.5, sustain: 0, release: 0.5 } } },
  "fm-pluck": { type: "FMSynth", options: { harmonicity: 2, modulationIndex: 5, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.3 } } },

  // AM
  "am-synth": { type: "AMSynth", options: { harmonicity: 2, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 } } },

  // Drums
  kick: { type: "MembraneSynth", options: { pitchDecay: 0.05, octaves: 6, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 } } },
  tom: { type: "MembraneSynth", options: { pitchDecay: 0.08, octaves: 4, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.3 } } },
  hihat: { type: "MetalSynth", options: { envelope: { attack: 0.001, decay: 0.1, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 } },
  cymbal: { type: "MetalSynth", options: { envelope: { attack: 0.001, decay: 0.8, release: 0.3 }, harmonicity: 5.1, modulationIndex: 40, resonance: 5000, octaves: 2 } },
  snare: { type: "NoiseSynth", options: { noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.15 } } },
  clap: { type: "NoiseSynth", options: { noise: { type: "pink" }, envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.08 } }, effects: [{ type: "reverb", decay: 1.2, wet: 0.25 }] },
  rim: { type: "MetalSynth", options: { envelope: { attack: 0.001, decay: 0.04, release: 0.02 }, harmonicity: 12, modulationIndex: 20, resonance: 6000, octaves: 0.5 } },
  "noise-sweep": { type: "NoiseSynth", options: { noise: { type: "pink" }, envelope: { attack: 0.5, decay: 1, sustain: 0.3, release: 0.5 } } },

  // Pluck
  pluck: { type: "PluckSynth", options: { attackNoise: 1, dampening: 4000, resonance: 0.9 } },
  guitar: { type: "PluckSynth", options: { attackNoise: 2, dampening: 3000, resonance: 0.95 } },

  // Keys / lo-fi
  "lofi-piano": { type: "Synth", options: { oscillator: { type: "triangle" }, envelope: { attack: 0.02, decay: 0.8, sustain: 0.2, release: 1.2 } } },
  "lofi-keys": { type: "FMSynth", options: { harmonicity: 0.5, modulationIndex: 1.5, envelope: { attack: 0.03, decay: 0.6, sustain: 0.3, release: 1.0 }, modulation: { type: "triangle" }, modulationEnvelope: { attack: 0.02, decay: 0.4, sustain: 0.1, release: 0.5 } } },
  "electric-piano": { type: "FMSynth", options: { harmonicity: 2, modulationIndex: 4, envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 0.8 }, modulation: { type: "sine" }, modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.4 } } },
  "vintage-keys": { type: "AMSynth", options: { harmonicity: 0.5, oscillator: { type: "triangle" }, envelope: { attack: 0.02, decay: 0.4, sustain: 0.4, release: 1.0 }, modulation: { type: "sine" }, modulationEnvelope: { attack: 0.5, decay: 0.1, sustain: 1, release: 0.5 } } },
  organ: { type: "AMSynth", options: { harmonicity: 2, oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: 0.01, sustain: 1.0, release: 0.1 }, modulation: { type: "square" }, modulationEnvelope: { attack: 0.01, decay: 0.01, sustain: 1, release: 0.1 } } },
  "soft-pad": { type: "Synth", options: { oscillator: { type: "triangle" }, envelope: { attack: 1.0, decay: 0.5, sustain: 0.9, release: 2.0 } } },
  "sub-bass": { type: "Synth", options: { oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: 0.1, sustain: 1.0, release: 0.3 } } },
  "synth-bass": { type: "FMSynth", options: { harmonicity: 0.5, modulationIndex: 2, envelope: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.2 }, modulation: { type: "square" } } },
  brass: { type: "Synth", options: { oscillator: { type: "sawtooth" }, envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.3 } } },
  "choir-pad": { type: "AMSynth", options: { harmonicity: 3, oscillator: { type: "sine" }, envelope: { attack: 0.8, decay: 0.3, sustain: 0.9, release: 2.5 } } },

  // Acid / bass
  "acid-bass": { type: "MonoSynth", options: { oscillator: { type: "sawtooth" }, filter: { Q: 6, type: "lowpass", rolloff: -24 }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 }, filterEnvelope: { attack: 0.06, decay: 0.2, sustain: 0.3, release: 0.2, baseFrequency: 200, octaves: 4, exponent: 2 }, portamento: 0.05 } },
  "wobble-bass": { type: "FMSynth", options: { harmonicity: 0.5, modulationIndex: 8, envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 }, modulation: { type: "sine" }, modulationEnvelope: { attack: 0.5, decay: 0, sustain: 1, release: 0.5 } } },
  "reese-bass": { type: "Synth", options: { oscillator: { type: "fatsawtooth", count: 2, spread: 18 }, envelope: { attack: 0.02, decay: 0.2, sustain: 0.9, release: 0.3 } }, effects: [{ type: "filter", frequency: 600, Q: 1 }, { type: "distortion", distortion: 0.15, wet: 0.4 }] },

  // Super saws / pads
  "detuned-saw": { type: "Synth", options: { oscillator: { type: "fatsawtooth", count: 7, spread: 40 }, envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.5 } } },
  "dark-pad": { type: "FMSynth", options: { harmonicity: 0.25, modulationIndex: 2, envelope: { attack: 1.5, decay: 0.8, sustain: 0.7, release: 3.0 }, modulation: { type: "sine" }, modulationEnvelope: { attack: 2.0, decay: 0.5, sustain: 0.8, release: 2.0 } } },
  "string-pad": { type: "AMSynth", options: { harmonicity: 3, oscillator: { type: "fatsawtooth", count: 3, spread: 20 }, envelope: { attack: 1.2, decay: 0.4, sustain: 0.8, release: 2.5 }, modulation: { type: "sine" }, modulationEnvelope: { attack: 0.5, decay: 0.2, sustain: 1, release: 0.5 } } },

  // Bells / glass
  "glass-bell": { type: "FMSynth", options: { harmonicity: 12, modulationIndex: 20, envelope: { attack: 0.001, decay: 2.0, sustain: 0, release: 1.0 }, modulation: { type: "sine" } } },
  "tape-keys": { type: "AMSynth", options: { harmonicity: 1.5, oscillator: { type: "triangle" }, envelope: { attack: 0.03, decay: 0.5, sustain: 0.3, release: 0.8 }, modulation: { type: "sine" }, modulationEnvelope: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.5 } } },

  // Percussion
  "metallic-perc": { type: "MetalSynth", options: { envelope: { attack: 0.001, decay: 0.15, release: 0.1 }, harmonicity: 5.1, modulationIndex: 24, resonance: 3000, octaves: 1.0 } },
  "glitch-perc": { type: "NoiseSynth", options: { noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 } } },
};

export const BUILTIN_INSTRUMENTS = Object.keys(INSTRUMENT_PRESETS);

export const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  "minor-pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  whole_tone: [0, 2, 4, 6, 8, 10],
};
export const SCALE_NAMES = Object.keys(SCALE_INTERVALS);

export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
