import { NOTE_NAMES, SCALE_INTERVALS } from "./presets";

/**
 * Step-sequencer data model plus the generative tools the agent can call:
 * Markov extension, euclidean rhythms, scale sequences and mutations.
 */

export type Subdivision = "4n" | "8n" | "16n" | "32n";

export interface Step {
  /** Pitch(es) for melodic instruments, e.g. "C4" or ["C4","E4","G4"]. */
  note?: string | string[];
  /** Untuned drum hit. */
  hit?: boolean;
  rest?: boolean;
  duration?: string;
  velocity?: number;
}

export interface Pattern {
  subdivision: Subdivision;
  notes: Step[];
}

export const STEPS_PER_BAR: Record<Subdivision, number> = { "4n": 4, "8n": 8, "16n": 16, "32n": 32 };

export function stepsPerBar(subdivision: Subdivision, beatsPerBar = 4): number {
  return Math.round((STEPS_PER_BAR[subdivision] * beatsPerBar) / 4);
}

export class MarkovChain {
  private transitions = new Map<string, Step[]>();

  train(steps: Step[]): void {
    this.transitions.clear();
    for (let i = 0; i < steps.length - 1; i++) {
      const current = stateKey(steps[i]);
      const list = this.transitions.get(current) ?? [];
      list.push(steps[i + 1]);
      this.transitions.set(current, list);
    }
  }

  generate(seed: Step, n: number): Step[] {
    const result: Step[] = [seed];
    let current = seed;
    for (let i = 1; i < n; i++) {
      const options = this.transitions.get(stateKey(current));
      if (options && options.length > 0) {
        current = pick(options);
      } else {
        const keys = [...this.transitions.keys()];
        if (keys.length === 0) break;
        current = pick(this.transitions.get(pick(keys))!);
      }
      result.push({ ...current });
    }
    return result;
  }
}

function stateKey(step: Step): string {
  if (step.rest) return "REST";
  if (step.note) return Array.isArray(step.note) ? step.note.join("+") : step.note;
  return step.hit ? "HIT" : "REST";
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const Mutators = {
  dropout(steps: Step[], probability = 0.15): Step[] {
    return steps.map((s) => (s.rest ? s : Math.random() < probability ? { rest: true } : { ...s }));
  },

  humanize(steps: Step[], amount = 0.12): Step[] {
    return steps.map((s) => {
      if (s.rest || (!s.note && !s.hit)) return s;
      const vel = (s.velocity ?? 0.8) + (Math.random() * 2 - 1) * amount;
      return { ...s, velocity: Math.max(0.2, Math.min(1.0, vvel(vel))) };
    });
  },

  reverse(steps: Step[]): Step[] {
    return [...steps].reverse();
  },

  rotate(steps: Step[], n = 1): Step[] {
    const len = steps.length;
    if (len === 0) return steps;
    const shift = ((n % len) + len) % len;
    return [...steps.slice(shift), ...steps.slice(0, shift)];
  },

  /** Bjorklund-style distribution of `hits` across `totalSteps`. */
  euclidean(hits: number, totalSteps: number, velocity = 0.8, note: string | null = null, duration = "16n"): Step[] {
    const pattern: Step[] = [];
    let bucket = 0;
    for (let i = 0; i < totalSteps; i++) {
      bucket += hits;
      if (bucket >= totalSteps) {
        bucket -= totalSteps;
        pattern.push(note ? { note, duration, velocity } : { hit: true, duration, velocity });
      } else {
        pattern.push({ rest: true });
      }
    }
    return pattern;
  },

  densityMorph(steps: Step[], targetDensity: number, fill: Step = { hit: true, duration: "16n" }): Step[] {
    const result = steps.map((s) => ({ ...s }));
    if (result.length === 0) return result;
    const active = result.filter((s) => !s.rest).length;
    const current = active / result.length;
    if (targetDensity > current) {
      const toAdd = Math.round((targetDensity - current) * result.length);
      const restIdx = result.map((s, i) => (s.rest ? i : -1)).filter((i) => i >= 0);
      for (let i = 0; i < Math.min(toAdd, restIdx.length); i++) {
        const idx = restIdx.splice(Math.floor(Math.random() * restIdx.length), 1)[0];
        result[idx] = { ...fill, velocity: 0.6 + Math.random() * 0.3 };
      }
    } else if (targetDensity < current) {
      const toRemove = Math.round((current - targetDensity) * result.length);
      const activeIdx = result.map((s, i) => (!s.rest ? i : -1)).filter((i) => i >= 0);
      for (let i = 0; i < Math.min(toRemove, activeIdx.length); i++) {
        const idx = activeIdx.splice(Math.floor(Math.random() * activeIdx.length), 1)[0];
        result[idx] = { rest: true };
      }
    }
    return result;
  },

  scaleSequence(
    key: string,
    scale: string,
    octave: number,
    length: number,
    options: { direction?: "up" | "down" | "random" | "pendulum"; stepSize?: number; restProbability?: number; velocityRange?: [number, number]; duration?: string } = {},
  ): Step[] {
    const root = Math.max(0, NOTE_NAMES.indexOf(normalizeNote(key)));
    const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.minor;
    const { direction = "random", stepSize = 1, restProbability = 0.2, velocityRange = [0.5, 0.9], duration = "8n" } = options;

    const scaleNotes: string[] = [];
    for (let oct = octave - 1; oct <= octave + 1; oct++) {
      for (const interval of intervals) {
        const idx = root + interval;
        scaleNotes.push(`${NOTE_NAMES[idx % 12]}${oct + Math.floor(idx / 12)}`);
      }
    }

    const result: Step[] = [];
    let pos = Math.floor(scaleNotes.length / 2);
    let dir = 1;
    for (let i = 0; i < length; i++) {
      if (Math.random() < restProbability) {
        result.push({ rest: true });
        continue;
      }
      const vel = velocityRange[0] + Math.random() * (velocityRange[1] - velocityRange[0]);
      result.push({ note: scaleNotes[pos], duration, velocity: vvel(vel) });
      switch (direction) {
        case "up":
          pos = Math.min(pos + stepSize, scaleNotes.length - 1);
          break;
        case "down":
          pos = Math.max(pos - stepSize, 0);
          break;
        case "pendulum":
          pos += dir * stepSize;
          if (pos >= scaleNotes.length - 1 || pos <= 0) dir *= -1;
          pos = Math.max(0, Math.min(scaleNotes.length - 1, pos));
          break;
        default:
          pos += (Math.random() > 0.5 ? 1 : -1) * stepSize;
          pos = Math.max(0, Math.min(scaleNotes.length - 1, pos));
      }
    }
    return result;
  },
};

function vvel(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Accepts "Db"/"D#" style spellings and maps them onto NOTE_NAMES. */
export function normalizeNote(name: string): string {
  const map: Record<string, string> = { Db: "C#", "D#": "Eb", Gb: "F#", "G#": "Ab", "A#": "Bb", Cb: "B", "E#": "F", Fb: "E", "B#": "C" };
  const trimmed = name.trim();
  return map[trimmed] ?? trimmed;
}

/** Parses a notes argument that may arrive as JSON text or as an array. */
export function parseSteps(input: unknown): Step[] {
  const raw = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (!Array.isArray(raw)) throw new Error("notes must be a JSON array of step objects");
  return raw.map((s) => {
    if (s === null || s === "-" || s === "." || s === "~") return { rest: true };
    if (typeof s === "string") return { note: s };
    if (typeof s === "number") return s ? { hit: true } : { rest: true };
    if (typeof s === "object") return s as Step;
    return { rest: true };
  });
}

/** Repeats a short pattern to fill `bars` bars. */
export function expandToBars(notes: Step[], subdivision: Subdivision, bars: number, beatsPerBar = 4): Step[] {
  if (notes.length === 0) return [];
  const total = stepsPerBar(subdivision, beatsPerBar) * bars;
  const out: Step[] = [];
  for (let i = 0; i < total; i++) out.push({ ...notes[i % notes.length] });
  return out;
}
