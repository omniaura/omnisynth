import { MarkovChain, Mutators, scaleNotes, type Step } from "./patterns";

/**
 * Evolution engine: generative algorithms and bar-synced rules that mutate
 * patterns (and parameters) while the song plays. Everything here is pure —
 * the engine owns scheduling and applies the results.
 */

export type EvolveOp =
  | { type: "markov"; order?: number; temperature?: number; length?: number }
  | { type: "cellular"; rule?: number; seed?: "pattern" | "random" | "center"; wrap?: boolean }
  | { type: "lsystem"; axiom?: string; rules?: Record<string, string>; depth?: number; octave?: number }
  | { type: "genetic"; generations?: number; population?: number; mutation?: number; density?: number; syncopation?: number; similarity?: number }
  | { type: "euclid_morph"; delta?: number; min?: number; max?: number; rotation?: number }
  | { type: "rotate"; steps?: number }
  | { type: "dropout"; probability?: number }
  | { type: "humanize"; amount?: number; timing?: number }
  | { type: "density"; density?: number; delta?: number }
  | { type: "transpose_scale"; degrees?: number; random?: boolean }
  | { type: "stutter"; probability?: number; max_ratchet?: number }
  | { type: "probability"; prob?: number; delta?: number }
  | { type: "reverse" }
  | { type: "param_walk"; path: string; step?: number; min?: number; max?: number }
  | { type: "reset" };

export interface EvolveRule {
  id: string;
  /** Fire every N bars (section-local bar count). */
  every: number;
  /** Chance the rule fires when due (default 1). */
  prob?: number;
  ops: EvolveOp[];
  /** Constraints applied after ops. */
  min_density?: number;
  max_density?: number;
  /** Stop after this many firings (undefined = forever). */
  max_generations?: number;
  /** Internal counters. */
  fired?: number;
}

export interface EvolveContext {
  key: string;
  scale: string;
  isDrum: boolean;
  /** Pattern the track started with; used by reset and similarity fitness. */
  seed: Step[];
  subdivision: string;
}

export function density(steps: Step[]): number {
  if (steps.length === 0) return 0;
  return steps.filter((s) => !s.rest).length / steps.length;
}

/** Fraction of hits landing off the beat (odd 16ths / "e" and "a"). */
export function syncopation(steps: Step[]): number {
  const hits = steps.map((s, i) => (!s.rest ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return 0;
  return hits.filter((i) => i % 4 !== 0).length / hits.length;
}

export function similarity(a: Step[], b: Step[]): number {
  const n = Math.max(a.length, b.length);
  if (!n) return 1;
  let same = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i % a.length];
    const y = b[i % b.length];
    if (Boolean(x?.rest) === Boolean(y?.rest)) same++;
  }
  return same / n;
}

/** Elementary cellular automaton over the on/off mask of the pattern. */
export function cellular(steps: Step[], rule = 90, seedMode: "pattern" | "random" | "center" = "pattern", wrap = true, fill: Step): Step[] {
  const n = steps.length || 16;
  let cells: number[];
  if (seedMode === "random") cells = Array.from({ length: n }, () => (Math.random() < 0.3 ? 1 : 0));
  else if (seedMode === "center") cells = Array.from({ length: n }, (_, i) => (i === Math.floor(n / 2) ? 1 : 0));
  else cells = steps.map((s) => (s.rest ? 0 : 1));
  const next: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = wrap ? cells[(i - 1 + n) % n] : (cells[i - 1] ?? 0);
    const c = cells[i];
    const r = wrap ? cells[(i + 1) % n] : (cells[i + 1] ?? 0);
    const idx = (l << 2) | (c << 1) | r;
    next.push((rule >> idx) & 1);
  }
  // Never let the automaton die or saturate completely.
  const on = next.reduce((a, b) => a + b, 0);
  if (on === 0 || on === n) next[0] = on === 0 ? 1 : 0;
  return next.map((v, i) => {
    if (steps[i]?.lock) return steps[i];
    if (!v) return { rest: true };
    const prev = steps[i] && !steps[i].rest ? steps[i] : fill;
    return { ...prev, velocity: prev.velocity ?? 0.8 };
  });
}

/**
 * Lindenmayer system over scale degrees. Symbols: digits 0-6 = scale degree,
 * "+"/"-" = octave up/down for following notes, "." = rest, "[" "]" ignored.
 * Default rules grow a motif into a longer, self-similar line.
 */
export function lsystem(key: string, scale: string, axiom = "0 2 4 .", rules: Record<string, string> = { "0": "0 2", "2": "4 .", "4": "2 0 +4", ".": ". 0" }, depth = 2, octave = 4, length = 32, duration = "8n"): Step[] {
  let s = axiom.trim().split(/\s+/);
  for (let d = 0; d < depth; d++) s = s.flatMap((sym) => (rules[sym] ? rules[sym].trim().split(/\s+/) : [sym]));
  const notes = scaleNotes(key, scale, octave - 1, octave + 2);
  const degrees = 7;
  let oct = 1; // index offset into the 4-octave table (start at `octave`)
  const out: Step[] = [];
  for (const sym of s) {
    if (out.length >= length) break;
    if (sym === "+") oct = Math.min(2, oct + 1);
    else if (sym === "-") oct = Math.max(0, oct - 1);
    else if (sym === ".") out.push({ rest: true });
    else if (/^\d$/.test(sym)) {
      const deg = Number(sym) % degrees;
      const note = notes[Math.min(notes.length - 1, oct * degrees + deg)];
      out.push({ note, duration, velocity: 0.6 + Math.random() * 0.3 });
    }
  }
  while (out.length < Math.min(length, 8)) out.push({ rest: true });
  return out;
}

export interface GeneticTargets {
  density?: number;
  syncopation?: number;
  similarity?: number;
}

/** Hill-climb a population of mutated variants toward the fitness targets. */
export function genetic(steps: Step[], ctx: EvolveContext, targets: GeneticTargets, generations = 6, population = 12, mutation = 0.15): Step[] {
  const fill: Step = ctx.isDrum ? { hit: true, duration: "16n" } : { note: `${ctx.key}3`, duration: "8n" };
  const fitness = (p: Step[]) => {
    let f = 0;
    if (targets.density !== undefined) f -= Math.abs(density(p) - targets.density) * 2;
    if (targets.syncopation !== undefined) f -= Math.abs(syncopation(p) - targets.syncopation);
    if (targets.similarity !== undefined) f -= Math.abs(similarity(p, ctx.seed) - targets.similarity);
    return f;
  };
  const mutate = (p: Step[]): Step[] => {
    let q = p.map((s) => ({ ...s }));
    const roll = Math.random();
    if (roll < 0.3) q = Mutators.dropout(q, mutation);
    else if (roll < 0.55) q = Mutators.densityMorph(q, Math.min(1, density(q) + (Math.random() - 0.5) * mutation * 2), fill);
    else if (roll < 0.7) q = Mutators.rotate(q, Math.random() < 0.5 ? 1 : -1);
    else if (roll < 0.85 && !ctx.isDrum) q = Mutators.transposeScale(q, Math.random() < 0.5 ? 1 : -1, ctx.key, ctx.scale);
    else q = Mutators.humanize(q, mutation);
    return q;
  };
  let pop = [steps, ...Array.from({ length: population - 1 }, () => mutate(steps))];
  for (let g = 0; g < generations; g++) {
    pop.sort((a, b) => fitness(b) - fitness(a));
    const elite = pop.slice(0, Math.max(2, Math.floor(population / 3)));
    pop = [...elite, ...Array.from({ length: population - elite.length }, () => mutate(elite[Math.floor(Math.random() * elite.length)]))];
  }
  pop.sort((a, b) => fitness(b) - fitness(a));
  return pop[0].map((s, i) => (steps[i]?.lock ? { ...steps[i] } : s));
}

/** Applies one op to a pattern; param_walk/reset are handled by the engine. */
export function applyOp(steps: Step[], op: EvolveOp, ctx: EvolveContext): Step[] {
  const fill: Step = ctx.isDrum ? { hit: true, duration: "16n" } : { note: `${ctx.key}3`, duration: "8n" };
  const hits = steps.filter((s) => !s.rest).length;
  switch (op.type) {
    case "markov": {
      const chain = new MarkovChain(op.order ?? 2);
      chain.train(steps);
      const len = op.length ?? steps.length;
      const generated = chain.generate(steps, len, op.temperature ?? 1);
      return generated.length ? generated.map((s, i) => (steps[i]?.lock ? steps[i] : s)) : steps;
    }
    case "cellular":
      return cellular(steps, op.rule ?? 90, op.seed ?? "pattern", op.wrap ?? true, fill);
    case "lsystem":
      return lsystem(ctx.key, ctx.scale, op.axiom, op.rules, op.depth ?? 2, op.octave ?? 4, steps.length || 32, ctx.subdivision);
    case "genetic":
      return genetic(steps, ctx, { density: op.density, syncopation: op.syncopation, similarity: op.similarity }, op.generations, op.population, op.mutation);
    case "euclid_morph": {
      const delta = op.delta ?? (Math.random() < 0.5 ? -1 : 1);
      const target = Math.max(op.min ?? 1, Math.min(op.max ?? steps.length - 1, hits + delta));
      const sample = steps.find((s) => !s.rest) ?? fill;
      const note = ctx.isDrum ? null : Array.isArray(sample.note) ? sample.note[0] : (sample.note ?? `${ctx.key}3`);
      const pat = Mutators.euclidean(target, steps.length || 16, sample.velocity ?? 0.8, note, sample.duration ?? ctx.subdivision, op.rotation ?? 0);
      return pat.map((s, i) => (steps[i]?.lock ? steps[i] : s));
    }
    case "rotate":
      return Mutators.rotate(steps, op.steps ?? 1);
    case "dropout":
      return Mutators.dropout(steps, op.probability ?? 0.15);
    case "humanize":
      return Mutators.humanize(steps, op.amount ?? 0.12, op.timing ?? 0);
    case "density": {
      const target = op.density ?? Math.max(0.05, Math.min(0.95, density(steps) + (op.delta ?? 0.1)));
      return Mutators.densityMorph(steps, target, fill);
    }
    case "transpose_scale": {
      const degrees = op.random ? [-2, -1, 1, 2][Math.floor(Math.random() * 4)] : (op.degrees ?? 1);
      return Mutators.transposeScale(steps, degrees, ctx.key, ctx.scale);
    }
    case "stutter":
      return Mutators.stutter(steps, op.probability ?? 0.15, op.max_ratchet ?? 3);
    case "probability":
      return steps.map((s) => {
        if (s.rest || s.lock) return s;
        const base = op.prob ?? (s.prob ?? 1) + (op.delta ?? -0.1);
        return { ...s, prob: Math.max(0.1, Math.min(1, base)) };
      });
    case "reverse":
      return Mutators.reverse(steps);
    case "reset":
      return ctx.seed.map((s) => ({ ...s }));
    case "param_walk":
      return steps;
    default: {
      const unknown = op as { type?: string };
      throw new Error(`unknown evolve op "${unknown.type}"`);
    }
  }
}

/** Enforce rule constraints after ops so evolution never collapses to silence or noise. */
export function constrain(steps: Step[], rule: EvolveRule, ctx: EvolveContext): Step[] {
  const fill: Step = ctx.isDrum ? { hit: true, duration: "16n" } : { note: `${ctx.key}3`, duration: "8n" };
  const d = density(steps);
  const lo = rule.min_density ?? 0.06;
  const hi = rule.max_density ?? 0.9;
  if (d < lo) return Mutators.densityMorph(steps, lo, fill);
  if (d > hi) return Mutators.densityMorph(steps, hi, fill);
  return steps;
}

export function parseRules(input: unknown): EvolveRule[] {
  const raw = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((r, i) => {
    const rule = r as Partial<EvolveRule>;
    if (!rule || !Array.isArray(rule.ops) || rule.ops.length === 0) throw new Error(`rule ${i}: ops[] required`);
    return {
      id: rule.id ?? `rule-${i + 1}`,
      every: (() => {
        const n = Number(rule.every ?? 4);
        return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
      })(),
      prob: rule.prob === undefined ? 1 : Math.max(0, Math.min(1, Number(rule.prob))),
      ops: rule.ops,
      min_density: rule.min_density,
      max_density: rule.max_density,
      max_generations: rule.max_generations,
      fired: 0,
    };
  });
}

export const EVOLVE_OP_DOC = `Ops (JSON objects, applied in order):
{"type":"markov","order":2,"temperature":1.2} regenerate from an order-N chain trained on the current pattern
{"type":"cellular","rule":90,"seed":"pattern"} elementary CA step on the hit mask (30 chaotic, 90 fractal, 110 complex, 184 traffic)
{"type":"lsystem","axiom":"0 2 4 .","rules":{"0":"0 2","2":"4 .","4":"2 0 +4"},"depth":2,"octave":4} melodic L-system in key (digits = scale degrees, . rest, +/- octave)
{"type":"genetic","generations":6,"density":0.4,"syncopation":0.5,"similarity":0.7} hill-climb toward fitness targets
{"type":"euclid_morph","delta":1,"min":2,"max":9} add/remove euclidean hits
{"type":"rotate","steps":1} {"type":"dropout","probability":0.1} {"type":"humanize","amount":0.1,"timing":8}
{"type":"density","delta":0.1} {"type":"transpose_scale","degrees":1} or {"type":"transpose_scale","random":true}
{"type":"stutter","probability":0.15,"max_ratchet":3} ratchets  {"type":"probability","delta":-0.1} lower step probabilities
{"type":"param_walk","path":"acid.fx.0.frequency","step":120,"min":200,"max":2400} random-walk a parameter
{"type":"reverse"} {"type":"reset"} back to the seed pattern`;
