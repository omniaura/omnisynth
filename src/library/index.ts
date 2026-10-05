import { INSTRUMENT_PRESETS } from "../engine/presets";
import { engine } from "../engine/engine";
import { scaleNotes, type Step } from "../engine/patterns";
import { PATCH_BY_ID, PATCH_LIBRARY, searchPatches, type LibraryPatch } from "./patches";
import { PATTERN_BY_ID, PATTERN_LIBRARY, gridToSteps, searchPatterns, type LibraryPattern } from "./patterns";
import { ARRANGEMENT_BY_ID, ARRANGEMENTS, PROGRESSION_BY_ID, PROGRESSIONS, chordNotes, searchArrangements, searchProgressions, voice, type Voicing } from "./theory";

/**
 * Library operations the agent calls. Each resolves knowledge into concrete
 * engine objects: patches get registered as instruments, patterns become
 * step arrays (optionally pitched to the key), progressions become voiced
 * chord notes per bar, templates become sections + arrangement.
 */

export function registerLibraryPatches(): void {
  for (const p of PATCH_LIBRARY) {
    if (!INSTRUMENT_PRESETS[p.id]) INSTRUMENT_PRESETS[p.id] = { type: p.type, options: p.options, effects: p.effects, name: p.id, custom: false };
  }
}

export function usePatch(id: string, as?: string): { instrument: string; patch: LibraryPatch } {
  const patch = PATCH_BY_ID[id];
  if (!patch) throw new Error(`no library patch "${id}". Try list_library kind=patch query=…`);
  const instrument = as ?? id;
  engine.createPatch(instrument, { type: patch.type, options: patch.options, effects: patch.effects, name: instrument });
  return { instrument, patch };
}

export interface UsePatternOptions {
  /** For melodic roles: key/scale/octave to pitch `degrees` into notes. */
  key?: string;
  scale?: string;
  octave?: number;
  /** Repeat the grid this many times (bars). */
  bars?: number;
  /** Override the pattern's swing nudge. */
  swingMs?: number;
}

export function usePattern(id: string, opts: UsePatternOptions = {}): { pattern: LibraryPattern; steps: Step[] } {
  const pattern = PATTERN_BY_ID[id];
  if (!pattern) throw new Error(`no library pattern "${id}". Try list_library kind=pattern query=…`);
  const swing = opts.swingMs ?? pattern.swingMs;
  let steps: Step[];
  if (pattern.degrees && pattern.degrees.length) {
    const key = opts.key ?? engine.key;
    const scale = opts.scale ?? engine.scale;
    const octave = opts.octave ?? 2;
    const notes = scaleNotes(key, scale, octave - 1, octave + 2);
    const base = 7; // index of degree 1 at `octave`
    const chars = pattern.grid.replace(/\s+/g, "").split("");
    let d = 0;
    steps = chars.map((c, i) => {
      if (c === ".") return { rest: true };
      const degree = pattern.degrees![d++ % pattern.degrees!.length];
      if (!degree) return { rest: true };
      const note = notes[Math.max(0, Math.min(notes.length - 1, base + degree - 1))];
      const s = gridToSteps(c, { note, duration: pattern.subdivision === "8n" ? "8n" : "16n", swingMs: swing })[0];
      return { ...s, nudge: swing && i % 2 === 1 ? swing : s.nudge };
    });
  } else {
    steps = gridToSteps(pattern.grid, { swingMs: swing, duration: pattern.subdivision === "32n" ? "32n" : "16n" });
  }
  const bars = Math.max(1, opts.bars ?? 1);
  const out: Step[] = [];
  for (let b = 0; b < bars; b++) out.push(...steps.map((s) => ({ ...s })));
  return { pattern, steps: out };
}

export interface ProgressionResult {
  id: string;
  key: string;
  mode: string;
  beatsPerChord: number;
  chords: Array<{ numeral: string; notes: string[]; bass: string }>;
  /** Steps on a 4n grid covering the whole progression (chord tones held per chord). */
  chordSteps: Step[];
  /** Root note per bar for the bass on a 4n grid. */
  bassSteps: Step[];
}

export function useProgression(id: string, opts: { key?: string; mode?: string; voicing?: Voicing; octave?: number; bassOctave?: number } = {}): ProgressionResult {
  const prog = PROGRESSION_BY_ID[id];
  if (!prog) throw new Error(`no progression "${id}". Try list_library kind=progression query=…`);
  const key = opts.key ?? engine.key;
  const mode = opts.mode ?? prog.mode;
  const octave = opts.octave ?? 3;
  const bassOctave = opts.bassOctave ?? 1;
  const chords = prog.numerals.map((numeral) => {
    const raw = chordNotes(key, mode, numeral, octave);
    const bass = chordNotes(key, mode, numeral, bassOctave)[0];
    return { numeral, notes: voice(raw, opts.voicing ?? "spread"), bass };
  });
  const chordSteps: Step[] = [];
  const bassSteps: Step[] = [];
  const beats = prog.beatsPerChord;
  for (const c of chords) {
    for (let b = 0; b < beats; b++) {
      chordSteps.push(b === 0 ? { note: c.notes, duration: `${beats}n`.replace(/^(\d+)n$/, (_, n) => (Number(n) === 4 ? "1m" : Number(n) === 8 ? "2m" : "1m")), velocity: 0.75 } : { rest: true });
      bassSteps.push(b % 2 === 0 ? { note: c.bass, duration: "4n", velocity: b === 0 ? 0.9 : 0.7 } : { rest: true });
    }
  }
  return { id, key, mode, beatsPerChord: beats, chords, chordSteps, bassSteps };
}

export function applyTemplate(id: string, opts: { scale?: number } = {}): { sections: string[]; arrangement: string[]; recipes: Record<string, string> } {
  const tpl = ARRANGEMENT_BY_ID[id];
  if (!tpl) throw new Error(`no arrangement template "${id}". Try list_library kind=arrangement query=…`);
  const scale = Math.max(0.25, Math.min(2, opts.scale ?? 1));
  const recipes: Record<string, string> = {};
  for (const s of tpl.sections) {
    const bars = Math.max(2, Math.round((s.bars * scale) / 2) * 2);
    engine.createSection(s.id, s.name, bars, { timeSignature: s.timeSignature, bpm: s.bpmScale ? Math.round(engine.bpm * s.bpmScale) : undefined });
    recipes[s.id] = `${s.name} (${bars} bars${s.timeSignature ? `, ${s.timeSignature.join("/")}` : ""}, energy ${s.energy}): ${s.recipe}`;
  }
  engine.setArrangement(tpl.arrangement);
  return { sections: tpl.sections.map((s) => s.id), arrangement: tpl.arrangement, recipes };
}

export function listLibrary(kind: "patch" | "pattern" | "progression" | "arrangement" | "all", query?: string): string {
  const q = query?.trim();
  const lines: string[] = [];
  if (kind === "patch" || kind === "all") {
    const list = q ? searchPatches(q) : PATCH_LIBRARY;
    lines.push(`PATCHES (${list.length})`, ...list.map((p) => `  ${p.id} [${p.role}] ${p.tags.join(",")} — ${p.reference} | vol ${p.mix.volume} dB, oct ${p.mix.octaveLow}-${p.mix.octaveHigh}, grid ${p.grid}${p.mix.note ? ` | ${p.mix.note}` : ""}`));
  }
  if (kind === "pattern" || kind === "all") {
    const list = q ? searchPatterns(q) : PATTERN_LIBRARY;
    lines.push(`PATTERNS (${list.length})`, ...list.map((p) => `  ${p.id} [${p.role}] ${p.genre.join(",")} ${p.bpm[0]}-${p.bpm[1]}bpm ${p.subdivision}${p.meter ? ` ${p.meter.join("/")}` : ""} "${p.grid}"${p.degrees ? ` deg ${p.degrees.join(" ")}` : ""}${p.notes ? ` — ${p.notes}` : ""}`));
  }
  if (kind === "progression" || kind === "all") {
    const list = q ? searchProgressions(q) : PROGRESSIONS;
    lines.push(`PROGRESSIONS (${list.length})`, ...list.map((p) => `  ${p.id}: ${p.numerals.join("–")} (${p.mode}, ${p.beatsPerChord} beats/chord) ${p.mood.join(",")} — ${p.genres.join(",")}${p.reference ? ` | ${p.reference}` : ""}`));
  }
  if (kind === "arrangement" || kind === "all") {
    const list = q ? searchArrangements(q) : ARRANGEMENTS;
    lines.push(`ARRANGEMENTS (${list.length})`, ...list.map((a) => `  ${a.id} (${a.genres.join(",")}, ${a.bpm[0]}-${a.bpm[1]}bpm): ${a.sections.map((s) => `${s.id}${s.bars}${s.timeSignature ? `@${s.timeSignature.join("/")}` : ""}`).join(" ")} → ${a.arrangement.join("·")} — ${a.notes}`));
  }
  return lines.join("\n") || "nothing matched";
}
