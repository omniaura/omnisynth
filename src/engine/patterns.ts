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
  /** 0..1 chance the step fires on a given pass (default 1). */
  prob?: number;
  /** Retrigger the step this many times within its slot (1-4). */
  ratchet?: number;
  /** Micro-timing offset in milliseconds (-50..50). */
  nudge?: number;
  /** Conditional trigger: "1:4" fires on pass 1 of every 4, "!1:2" skips pass 1 of every 2. */
  cond?: string;
  /** Portamento into this step (seconds) for mono synths. */
  slide?: number;
  /** Locked steps are never touched by evolution ops. */
  lock?: boolean;
}

export interface Pattern {
  subdivision: Subdivision;
  notes: Step[];
}

export const STEPS_PER_BAR: Record<Subdivision, number> = { "4n": 4, "8n": 8, "16n": 16, "32n": 32 };

/** Steps per bar for a subdivision under a time signature (beats/unit). */
export function stepsPerBar(subdivision: Subdivision, beatsPerBar = 4, unit = 4): number {
  return Math.max(1, Math.round((STEPS_PER_BAR[subdivision] * beatsPerBar) / unit));
}

/** True when a step should fire on this pass given prob/cond. `pass` is 1-based loop count. */
export function stepFires(step: Step, pass: number): boolean {
  if (step.rest) return false;
  if (step.cond) {
    const m = step.cond.trim().match(/^(!?)(\d+):(\d+)$/);
    if (m) {
      const negate = m[1] === "!";
      const n = Number(m[2]);
      const of = Number(m[3]);
      const hit = of > 0 && ((pass - 1) % of) + 1 === n;
      if (negate ? hit : !hit) return false;
    }
  }
  if (step.prob !== undefined && step.prob < 1 && Math.random() > step.prob) return false;
  return true;
}

export class MarkovChain {
  private transitions = new Map<string, Step[]>();
  readonly order: number;

  constructor(order = 1) {
    this.order = Math.max(1, Math.min(4, order));
  }

  train(steps: Step[]): void {
    this.transitions.clear();
    for (let i = 0; i < steps.length - this.order; i++) {
      const key = this.contextKey(steps.slice(i, i + this.order));
      const list = this.transitions.get(key) ?? [];
      list.push(steps[i + this.order]);
      this.transitions.set(key, list);
    }
  }

  /** Generate n steps continuing from `seed` (uses the last `order` steps as context). temperature>1 flattens choices, <1 sharpens. */
  generate(seed: Step[], n: number, temperature = 1): Step[] {
    const out: Step[] = [];
    let context = seed.slice(-this.order);
    for (let i = 0; i < n; i++) {
      let options = this.transitions.get(this.contextKey(context));
      if (!options || options.length === 0) {
        const keys = [...this.transitions.keys()];
        if (keys.length === 0) break;
        options = this.transitions.get(pick(keys))!;
      }
      const next = { ...weightedPick(options, temperature) };
      out.push(next);
      context = [...context.slice(1), next];
      if (context.length < this.order) context = [...seed.slice(-(this.order - context.length)), ...context];
    }
    return out;
  }

  private contextKey(steps: Step[]): string {
    return steps.map(stateKey).join("|");
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

/** Pick by frequency with a temperature: counts are raised to 1/temperature. */
function weightedPick(options: Step[], temperature: number): Step {
  const counts = new Map<string, { step: Step; n: number }>();
  for (const o of options) {
    const k = stateKey(o);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { step: o, n: 1 });
  }
  const t = Math.max(0.05, temperature);
  const entries = [...counts.values()].map((e) => ({ step: e.step, w: Math.pow(e.n, 1 / t) }));
  const total = entries.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return e.step;
  }
  return entries[entries.length - 1].step;
}

export const Mutators = {
  dropout(steps: Step[], probability = 0.15): Step[] {
    return steps.map((s) => (s.rest || s.lock ? s : Math.random() < probability ? { rest: true } : { ...s }));
  },

  humanize(steps: Step[], amount = 0.12, timing = 0): Step[] {
    return steps.map((s) => {
      if (s.rest || s.lock || (!s.note && !s.hit)) return s;
      const vel = (s.velocity ?? 0.8) + (Math.random() * 2 - 1) * amount;
      const out: Step = { ...s, velocity: Math.max(0.2, Math.min(1.0, vvel(vel))) };
      if (timing > 0) out.nudge = Math.round((Math.random() * 2 - 1) * timing);
      return out;
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

  /** Bjorklund-style distribution of `hits` across `totalSteps`, optionally rotated. */
  euclidean(hits: number, totalSteps: number, velocity = 0.8, note: string | null = null, duration = "16n", rotation = 0): Step[] {
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
    return rotation ? Mutators.rotate(pattern, rotation) : pattern;
  },

  densityMorph(steps: Step[], targetDensity: number, fill: Step = { hit: true, duration: "16n" }): Step[] {
    const result = steps.map((s) => ({ ...s }));
    if (result.length === 0) return result;
    const active = result.filter((s) => !s.rest).length;
    const current = active / result.length;
    if (targetDensity > current) {
      const toAdd = Math.round((targetDensity - current) * result.length);
      const restIdx = result.map((s, i) => (s.rest && !s.lock ? i : -1)).filter((i) => i >= 0);
      for (let i = 0; i < Math.min(toAdd, restIdx.length); i++) {
        const idx = restIdx.splice(Math.floor(Math.random() * restIdx.length), 1)[0];
        result[idx] = { ...fill, velocity: 0.6 + Math.random() * 0.3 };
      }
    } else if (targetDensity < current) {
      const toRemove = Math.round((current - targetDensity) * result.length);
      const activeIdx = result.map((s, i) => (!s.rest && !s.lock ? i : -1)).filter((i) => i >= 0);
      for (let i = 0; i < Math.min(toRemove, activeIdx.length); i++) {
        const idx = activeIdx.splice(Math.floor(Math.random() * activeIdx.length), 1)[0];
        result[idx] = { rest: true };
      }
    }
    return result;
  },

  /** Shift every note up/down by scale degrees, staying in key. */
  transposeScale(steps: Step[], degrees: number, key: string, scale: string): Step[] {
    const notes = scaleNotes(key, scale, 0, 8);
    const move = (n: string): string => {
      const idx = notes.indexOf(n);
      if (idx < 0) return n;
      return notes[Math.max(0, Math.min(notes.length - 1, idx + degrees))];
    };
    return steps.map((s) => {
      if (s.rest || s.lock || !s.note) return s;
      return { ...s, note: Array.isArray(s.note) ? s.note.map(move) : move(s.note) };
    });
  },

  /** Randomly add ratchets / probability to active steps for IDM-style stutter. */
  stutter(steps: Step[], probability = 0.15, maxRatchet = 3): Step[] {
    return steps.map((s) => {
      if (s.rest || s.lock) return s;
      if (Math.random() < probability) return { ...s, ratchet: 2 + Math.floor(Math.random() * Math.max(1, maxRatchet - 1)) };
      return { ...s, ratchet: undefined };
    });
  },

  scaleSequence(
    key: string,
    scale: string,
    octave: number,
    length: number,
    options: { direction?: "up" | "down" | "random" | "pendulum"; stepSize?: number; restProbability?: number; velocityRange?: [number, number]; duration?: string } = {},
  ): Step[] {
    const notes = scaleNotes(key, scale, octave - 1, octave + 1);
    const { direction = "random", stepSize = 1, restProbability = 0.2, velocityRange = [0.5, 0.9], duration = "8n" } = options;
    const result: Step[] = [];
    let pos = Math.floor(notes.length / 2);
    let dir = 1;
    for (let i = 0; i < length; i++) {
      if (Math.random() < restProbability) {
        result.push({ rest: true });
        continue;
      }
      const vel = velocityRange[0] + Math.random() * (velocityRange[1] - velocityRange[0]);
      result.push({ note: notes[pos], duration, velocity: vvel(vel) });
      switch (direction) {
        case "up":
          pos = Math.min(pos + stepSize, notes.length - 1);
          break;
        case "down":
          pos = Math.max(pos - stepSize, 0);
          break;
        case "pendulum":
          pos += dir * stepSize;
          if (pos >= notes.length - 1 || pos <= 0) dir *= -1;
          pos = Math.max(0, Math.min(notes.length - 1, pos));
          break;
        default:
          pos += (Math.random() > 0.5 ? 1 : -1) * stepSize;
          pos = Math.max(0, Math.min(notes.length - 1, pos));
      }
    }
    return result;
  },
};

/** All scale notes from octave `lo` to `hi` inclusive. */
export function scaleNotes(key: string, scale: string, lo: number, hi: number): string[] {
  const root = Math.max(0, NOTE_NAMES.indexOf(normalizeNote(key)));
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.minor;
  const out: string[] = [];
  for (let oct = lo; oct <= hi; oct++) {
    for (const interval of intervals) {
      const idx = root + interval;
      out.push(`${NOTE_NAMES[idx % 12]}${oct + Math.floor(idx / 12)}`);
    }
  }
  return out;
}

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
export function expandToBars(notes: Step[], subdivision: Subdivision, bars: number, beatsPerBar = 4, unit = 4): Step[] {
  if (notes.length === 0) return [];
  const total = stepsPerBar(subdivision, beatsPerBar, unit) * bars;
  const out: Step[] = [];
  for (let i = 0; i < total; i++) out.push({ ...notes[i % notes.length] });
  return out;
}

/** Compact one-line rendering for logs and model context. */
export function describeSteps(steps: Step[], max = 64): string {
  return steps
    .slice(0, max)
    .map((s) => {
      if (s.rest) return "-";
      let t = s.hit ? "x" : Array.isArray(s.note) ? s.note.join("+") : (s.note ?? "?");
      if (s.ratchet && s.ratchet > 1) t += `*${s.ratchet}`;
      if (s.prob !== undefined && s.prob < 1) t += `?${Math.round(s.prob * 100)}`;
      if (s.cond) t += `[${s.cond}]`;
      return t;
    })
    .join(" ");
}
