import type { ChatToolDefinition } from "../../shared/ipc";
import { AudioEngine, engine, type SongState } from "../engine/engine";
import { BUILTIN_INSTRUMENTS, INSTRUMENT_PRESETS, OSCILLATOR_TYPES, SCALE_NAMES, SYNTH_TYPES, type EffectConfig, type Patch, type SynthType } from "../engine/presets";
import { Mutators, describeSteps, normalizeNote, parseSteps, type Subdivision } from "../engine/patterns";
import { EVOLVE_OP_DOC, cellular as caStep, lsystem as lsys, parseRules } from "../engine/evolution";
import { MOD_SOURCE_DOC, parseModSource, type Modulation } from "../engine/modulation";
import { applyTemplate, listLibrary, usePatch, usePattern, useProgression } from "../library";
import { KNOWLEDGE } from "../library/knowledge";
import { strudel } from "../engine/strudel";
import { conversation } from "../lib/conversation";

/**
 * The DAW tool surface the orchestrator agent calls. Definitions are
 * OpenAI-compatible; `executeTool` applies each call to the engine (and the
 * visuals store) and returns a short result string the model reads back.
 */

export interface ToolContext {
  setVisuals(code: string): void;
  getVisuals(): string;
  setView(view: "studio" | "visualizer"): void;
  saveSong(name: string): string;
  listSongs(): Array<{ name: string; key: string; bpm: number; tracks: number }>;
  loadSong(key: string): Promise<string>;
}

const NOTES_DOC =
  'JSON array of steps. Melodic: [{"note":"C4","duration":"8n","velocity":0.8},{"rest":true},{"note":["C4","Eb4","G4"],"duration":"4n"}]. Drums: [{"hit":true,"velocity":0.9},{"rest":true}]. Shorthand: "C4" note, null or "-" rest, 1/0 drum hit/rest. Optional per step: prob 0-1 (chance to fire), ratchet 2-4 (retriggers), nudge ms (-50..50 swing/laid-back), cond "1:4" (only pass 1 of 4) or "!1:2", slide seconds (mono glide), lock true (evolution never touches it).';

const FX_DOC = `JSON array applied in order. Types: ${AudioEngine.EFFECT_TYPES.join(", ")}. Examples: {"type":"filter","frequency":900,"Q":2,"filterType":"lowpass"} {"type":"distortion","distortion":0.3,"wet":0.5} {"type":"saturation","order":3,"wet":0.3} {"type":"delay","delayTime":"8n.","feedback":0.35,"wet":0.25} {"type":"pingpong","delayTime":"16n","feedback":0.4,"wet":0.2} {"type":"reverb","decay":4,"wet":0.3} {"type":"chorus","frequency":1.2,"depth":0.6,"wet":0.4} {"type":"phaser","frequency":0.4,"octaves":3,"baseFrequency":300,"wet":0.5} {"type":"bitcrusher","bits":6,"wet":0.4} {"type":"autofilter","frequency":"2n","baseFrequency":150,"octaves":4,"wet":0.8} {"type":"autopanner","frequency":"1m","depth":0.6} {"type":"eq","low":-3,"mid":0,"high":2} {"type":"compressor","threshold":-18,"ratio":4,"attack":0.005,"release":0.15} {"type":"stereowidener","width":0.8} {"type":"pitchshift","pitch":12,"wet":0.3} {"type":"limiter","threshold":-1}`;

export function instrumentEnum(): string[] {
  return Object.keys(INSTRUMENT_PRESETS);
}

export function toolDefinitions(): ChatToolDefinition[] {
  const instruments = instrumentEnum();
  const def = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ChatToolDefinition => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
  });
  return [
    def("search_conversation_history", "Search this local conversation for an earlier idea or constraint. Returns matches and nextBefore; if more history remains, pass nextBefore as before to continue. Each call scans at most 200 turns.", { query: { type: "string", maxLength: 200 }, before: { type: "number", minimum: 0 } }, ["query"]),
    def("read_conversation_turn", "Read a previous local conversation turn by id. Long turns return nextOffset; pass it as offset to continue reading.", { id: { type: "string" }, offset: { type: "integer", minimum: 0 } }, ["id"]),
    def("get_audio_status", "Inspect Tone audio-context state and measured per-track output, mute/solo, actual volume and last playback error. Use this to diagnose missing instruments; track presence alone does not prove audible output.", {}),
    def("evaluate_strudel", "Write and play upstream Strudel live code. Supports mini notation, stack, patterns, synths, effects and samples(). Selects Strudel and stops Tone playback without deleting Tone tracks. Returns evaluation errors for correction; use strudel_status to verify audio energy. No external samples are preloaded: start with sbd, sine, sawtooth, white. Example: setcpm(30); stack(s('sbd*4').gain(0.5), note('c3 eb3 g3 bb3').s('sine').gain(0.2))", { code: { type: "string", maxLength: 32000 } }, ["code"]),
    def("strudel_status", "Read the Strudel draft, evaluation/scheduler error, playing state, events per cycle, audio-context state, measured RMS and four frequency bands.", {}),
    def("select_music_engine", "Stop playback and choose Strudel live code or the existing Tone DAW. Switching preserves Tone tracks and the Strudel draft.", { engine: { type: "string", enum: ["tone", "strudel"] } }, ["engine"]),
    // --- Transport / song ---
    def("set_bpm", "Set the song tempo.", { bpm: { type: "number", description: "40-300" } }, ["bpm"]),
    def(
      "set_key",
      "Set the song key and scale; generators and evolution stay in it.",
      { key: { type: "string", description: "Root: C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B" }, scale: { type: "string", enum: SCALE_NAMES } },
      ["key", "scale"],
    ),
    def("set_time_signature", "Set the song's default time signature (sections may override).", { beats: { type: "integer" }, unit: { type: "integer", description: "4 = quarter note, 8 = eighth" } }, ["beats", "unit"]),

    // --- Tracks ---
    def(
      "add_track",
      "Add a step-sequenced track. One instrument per track; separate tracks for kick, snare, hats, bass, lead, pad. Patterns loop; 16 steps of 16n = one bar in 4/4 (14 steps of 16n = one bar of 7/8).",
      {
        id: { type: "string", description: "slug like kick, hats, acid-bass, lead" },
        name: { type: "string" },
        instrument: { type: "string", enum: instruments, description: "Preset or a patch created with create_patch" },
        volume: { type: "number", description: "dB. -6 drums, -8 bass, -12 pads, -10 leads" },
        pan: { type: "number", description: "-1 left .. 1 right" },
        subdivision: { type: "string", enum: ["4n", "8n", "16n", "32n"], description: "Grid. 16n drums/acid, 8n bass/melody, 4n chords, 32n glitch" },
        notes: { type: "string", description: NOTES_DOC },
        fx: { type: "string", description: `Optional track FX chain. ${FX_DOC}` },
      },
      ["id", "name", "instrument", "subdivision", "notes"],
    ),
    def(
      "update_track",
      "Change a track's instrument, pattern, volume, pan or FX chain.",
      {
        id: { type: "string" },
        instrument: { type: "string", enum: instruments },
        volume: { type: "number" },
        pan: { type: "number" },
        subdivision: { type: "string", enum: ["4n", "8n", "16n", "32n"] },
        notes: { type: "string", description: NOTES_DOC },
        name: { type: "string" },
        fx: { type: "string", description: FX_DOC },
      },
      ["id"],
    ),
    def("remove_track", "Remove a track.", { id: { type: "string" } }, ["id"]),
    def("mute_track", "Mute or unmute a track.", { id: { type: "string" }, muted: { type: "boolean" } }, ["id", "muted"]),

    // --- Sound design ---
    def(
      "create_patch",
      "Design a synth patch (oscillator, envelope, FM/AM, filter, effects chain). Then use its id as an instrument in add_track/update_track. Re-creating an existing id edits that instrument live.",
      {
        id: { type: "string", description: "slug like hoover-lead, rubber-bass, airy-pad" },
        type: {
          type: "string",
          enum: SYNTH_TYPES,
          description: "Synth (poly, any oscillator), FMSynth, AMSynth, MonoSynth (filter + filter env, glides), DuoSynth, MetalSynth/MembraneSynth/NoiseSynth (percussion), PluckSynth",
        },
        oscillator_type: { type: "string", enum: [...OSCILLATOR_TYPES] },
        oscillator_count: { type: "integer", description: "fat* oscillators: voices 2-8" },
        oscillator_spread: { type: "number", description: "fat* oscillators: detune cents 1-100" },
        attack: { type: "number" },
        decay: { type: "number" },
        sustain: { type: "number" },
        release: { type: "number" },
        harmonicity: { type: "number", description: "FM/AM carrier:modulator ratio" },
        modulation_index: { type: "number", description: "FM depth 0-100" },
        modulation_type: { type: "string", description: "sine|square|triangle|sawtooth" },
        filter_frequency: { type: "number", description: "MonoSynth/DuoSynth filter env base Hz" },
        filter_q: { type: "number" },
        filter_envelope_octaves: { type: "number", description: "MonoSynth filter env sweep in octaves" },
        filter_envelope_decay: { type: "number" },
        portamento: { type: "number" },
        effects: { type: "string", description: FX_DOC },
      },
      ["id", "type"],
    ),
    def(
      "set_track_fx",
      "Replace a track's FX chain (after the patch's own effects). Each effect's params become addressable as <track>.fx.<index>.<param>.",
      { id: { type: "string" }, fx: { type: "string", description: FX_DOC } },
      ["id", "fx"],
    ),
    def("set_master_fx", "Set the master bus chain (glue compressor, eq, saturation, reverb, limiter). Params addressable as master.fx.<index>.<param>.", { fx: { type: "string", description: FX_DOC } }, ["fx"]),

    // --- Parameter graph ---
    def(
      "list_params",
      "List addressable parameter paths with current values and ranges, e.g. acid.synth.filterEnvelope.baseFrequency, acid.fx.0.frequency, pad.volume, master.fx.1.wet, bpm. Use before set_param/add_modulation/automate_param.",
      { track_id: { type: "string", description: "Limit to one track (omit for everything)" } },
    ),
    def("set_param", "Set any parameter by path, immediately or ramped.", { path: { type: "string" }, value: { type: "number" }, ramp_seconds: { type: "number" } }, ["path", "value"]),
    def(
      "automate_param",
      "Ramp a parameter over N bars starting at the next bar (filter opens over the build, reverb swells into the break).",
      { id: { type: "string" }, path: { type: "string" }, from: { type: "number" }, to: { type: "number" }, bars: { type: "integer" }, curve: { type: "string", enum: ["linear", "exponential"] } },
      ["path", "from", "to", "bars"],
    ),

    // --- Modulation ---
    def(
      "add_modulation",
      `Wire a modulation source to a parameter path (Max/MSP-style patching). ${MOD_SOURCE_DOC}`,
      {
        id: { type: "string", description: "slug like wobble, duck-bass, hat-shimmer" },
        source: { type: "string", description: "JSON source object" },
        target: { type: "string", description: "parameter path (see list_params)" },
        depth: { type: "number", description: "amount added at source=1 (can be negative)" },
        offset: { type: "number", description: "value at source=0" },
        curve: { type: "number" },
        bipolar: { type: "boolean" },
      },
      ["id", "source", "target", "depth", "offset"],
    ),
    def("remove_modulation", "Remove a modulation or automation by id.", { id: { type: "string" } }, ["id"]),
    def("set_macro", 'Set a 0..1 macro knob that modulations with {"type":"macro","name":...} read.', { name: { type: "string" }, value: { type: "number" } }, ["name", "value"]),

    // --- Structure ---
    def(
      "create_section",
      "Create a song section (intro, build, drop, break, outro). Starts as copies of current track patterns stretched to `bars`. Optional per-section time signature and tempo (e.g. a 7/8 break, a half-time drop).",
      {
        id: { type: "string" },
        name: { type: "string" },
        bars: { type: "integer", description: "4, 8, 16 or 32" },
        beats: { type: "integer", description: "time signature numerator for this section" },
        unit: { type: "integer", description: "time signature denominator (4 or 8)" },
        bpm: { type: "number", description: "tempo for this section" },
      },
      ["id", "name", "bars"],
    ),
    def(
      "update_section",
      "Change a section's bars, time signature or tempo.",
      {
        id: { type: "string" },
        name: { type: "string" },
        bars: { type: "integer" },
        beats: { type: "integer" },
        unit: { type: "integer" },
        bpm: { type: "number" },
        clear_overrides: { type: "boolean", description: "drop the section's own meter/tempo" },
      },
      ["id"],
    ),
    def(
      "set_section_pattern",
      "Give one track a different pattern inside one section (drop drums hit harder than the intro).",
      { section_id: { type: "string" }, track_id: { type: "string" }, notes: { type: "string", description: NOTES_DOC } },
      ["section_id", "track_id", "notes"],
    ),
    def("set_arrangement", 'Order sections into the song; it loops. e.g. ["intro","build","drop","break","drop","outro"]', { sections: { type: "string", description: "JSON array of section ids" } }, ["sections"]),
    def("jump_to_section", "Jump playback to a section now.", { section_id: { type: "string" } }, ["section_id"]),

    // --- Generative / evolution ---
    def(
      "mutate_pattern",
      "Transform a track's current pattern once: dropout, humanize, reverse, rotate, euclidean, density, markov, cellular, lsystem, genetic, transpose, stutter, probability, reset.",
      {
        track_id: { type: "string" },
        mutation: { type: "string", enum: ["dropout", "humanize", "reverse", "rotate", "euclidean", "density", "markov", "cellular", "lsystem", "genetic", "transpose", "stutter", "probability", "reset"] },
        probability: { type: "number" },
        amount: { type: "number" },
        timing: { type: "number" },
        steps: { type: "integer" },
        hits: { type: "integer" },
        rotation: { type: "integer" },
        density: { type: "number" },
        length: { type: "integer" },
        order: { type: "integer" },
        temperature: { type: "number" },
        rule: { type: "integer" },
        depth: { type: "integer" },
        octave: { type: "integer" },
        degrees: { type: "integer" },
        syncopation: { type: "number" },
        similarity: { type: "number" },
        max_ratchet: { type: "integer" },
        prob: { type: "number" },
        delta: { type: "number" },
      },
      ["track_id", "mutation"],
    ),
    def(
      "generate_pattern",
      "Generate a pattern algorithmically and return it (then pass it to add_track/update_track/set_section_pattern). euclidean rhythms, scale_sequence melodies in the song key, lsystem motifs, cellular drum masks, polyrhythm (hits over an odd length).",
      {
        type: { type: "string", enum: ["euclidean", "scale_sequence", "lsystem", "cellular", "polyrhythm"] },
        hits: { type: "integer" },
        steps: { type: "integer" },
        rotation: { type: "integer" },
        velocity: { type: "number" },
        note: { type: "string" },
        key: { type: "string" },
        scale: { type: "string", enum: SCALE_NAMES },
        octave: { type: "integer" },
        length: { type: "integer" },
        direction: { type: "string", enum: ["up", "down", "random", "pendulum"] },
        rest_probability: { type: "number" },
        duration: { type: "string", enum: ["4n", "8n", "16n", "32n"] },
        axiom: { type: "string" },
        rules: { type: "string", description: "JSON object of L-system rewrite rules" },
        depth: { type: "integer" },
        rule: { type: "integer", description: "cellular automaton rule 0-255" },
      },
      ["type"],
    ),
    def(
      "set_evolution",
      `Attach evolution rules to a track: while playing, every N bars the ops run on its pattern (and param_walk on parameters). This is how the song keeps changing — Markov drift, cellular automata, genetic pressure, probability erosion — without collapsing (min/max density constraints, lock steps you must keep). Rules: [{"id":"drift","every":4,"prob":0.8,"ops":[...],"min_density":0.2,"max_density":0.6,"max_generations":16}]. ${EVOLVE_OP_DOC}`,
      { track_id: { type: "string" }, rules: { type: "string", description: "JSON array of rules (replaces existing rules on the track)" } },
      ["track_id", "rules"],
    ),
    def(
      "evolve_now",
      "Run a track's evolution rules once immediately (or a one-off rule passed inline).",
      { track_id: { type: "string" }, rule: { type: "string", description: "optional JSON rule to run instead of the attached ones" } },
      ["track_id"],
    ),
    def("clear_evolution", "Remove evolution rules from a track (or all tracks).", { track_id: { type: "string" } }),

    // --- Visuals / view ---
    def(
      "set_visuals",
      "Set the Hydra sketch rendered behind the DAW. Hydra JS: osc(), noise(), voronoi(), shape(), gradient(), src(o0) chains with .color().rotate().modulate().kaleid().out(). Live values: a.fft[0..3] audio bands 0..1 (bass..treble), level(), time, bpm. e.g. osc(10,0.1,()=>a.fft[0]*2).rotate(()=>time*0.1).out(). Finish with .out().",
      { code: { type: "string" }, note: { type: "string", description: "One line on the visual idea" } },
      ["code"],
    ),
    def("set_view", "Switch between the studio UI and the full-screen visualizer (hides mixer/composer).", { view: { type: "string", enum: ["studio", "visualizer"] } }, ["view"]),

    // --- Transport / persistence ---
    def("play", "Start playback.", {}),
    def("stop", "Stop playback.", {}),
    def("save_song", "Save the current song.", { name: { type: "string" } }, ["name"]),
    def("list_songs", "List saved songs.", {}),
    def("load_song", "Load a saved song by key.", { key: { type: "string" } }, ["key"]),
    // --- Library / knowledge ---
    def("get_knowledge", "Re-read the producer knowledge pack (harmony, melody, bass, grooves, arrangement, mix, patch ids). It is also in your first message.", {}),
    def(
      "list_library",
      "Browse the production library: SOTA patches (909/808 drums, 303, Moog, Juno, Reese, wobble, M1 piano, supersaw, FM bells…), genre rhythm grids, chord progressions, arrangement templates. Filter by kind and a free-text query (genre, role, mood).",
      { kind: { type: "string", enum: ["patch", "pattern", "progression", "arrangement", "all"] }, query: { type: "string", description: "e.g. 'techno kick', 'dnb bass', 'brooding', 'garage'" } },
      ["kind"],
    ),
    def("use_patch", "Register a library patch as an instrument (optionally under a new id) so add_track can use it. Returns its mix guidance (volume, octave, grid).", { id: { type: "string", description: "library patch id, e.g. bass-303" }, as: { type: "string", description: "instrument id to register as (default: the patch id)" } }, ["id"]),
    def(
      "use_pattern",
      "Resolve a library rhythm/bass/arp grid into concrete steps (JSON) you can pass to add_track / update_track / set_section_pattern. Melodic patterns are pitched into the song key.",
      { id: { type: "string" }, bars: { type: "integer", description: "repeat for N bars (default 1)" }, octave: { type: "integer", description: "melodic roles: octave for degree 1 (default 2)" }, key: { type: "string" }, scale: { type: "string", enum: SCALE_NAMES }, swing_ms: { type: "number", description: "override swing nudge on offbeat 16ths" } },
      ["id"],
    ),
    def(
      "use_progression",
      "Resolve a chord progression in the song key to voiced chord notes per bar plus a bass root line. Returns JSON with chords, chordSteps (4n grid) and bassSteps (4n grid).",
      { id: { type: "string" }, key: { type: "string" }, mode: { type: "string", enum: SCALE_NAMES }, voicing: { type: "string", enum: ["root", "spread", "rootless", "drop2", "stab"], description: "spread (default) for pads, stab/rootless over a sub, root for leads" }, octave: { type: "integer" }, bass_octave: { type: "integer" } },
      ["id"],
    ),
    def("apply_template", "Create sections + arrangement from a genre arrangement template (bars, per-section meter/tempo, and a recipe describing what to do in each section). Then fill sections with set_section_pattern.", { id: { type: "string" }, scale: { type: "number", description: "shrink/stretch all section lengths (0.5 = half)" } }, ["id"]),
    def("get_state", "Return the current song state (tracks, patterns, sections, arrangement, modulations, rules).", {}),
    def("done", "Call when all changes are made. Summarize what you built for the artist in 1-3 sentences.", { summary: { type: "string" } }, ["summary"]),
  ];
}

function argNum(args: Record<string, unknown>, k: string): number | undefined {
  const v = args[k];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function parseFx(input: unknown): EffectConfig[] {
  if (input === undefined || input === null || input === "") return [];
  const raw = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (!Array.isArray(raw)) throw new Error("fx must be a JSON array of effect objects");
  const bad = raw.filter((e) => !e || typeof e !== "object" || !("type" in e));
  if (bad.length) throw new Error(`fx entries missing "type": ${JSON.stringify(bad).slice(0, 120)}`);
  return raw as EffectConfig[];
}

function patchFromArgs(args: Record<string, unknown>): Patch {
  const type = (args.type as SynthType) ?? "Synth";
  const options: Record<string, unknown> = {};
  if (args.oscillator_type) {
    const osc: Record<string, unknown> = { type: args.oscillator_type };
    if (argNum(args, "oscillator_count")) osc.count = argNum(args, "oscillator_count");
    if (argNum(args, "oscillator_spread")) osc.spread = argNum(args, "oscillator_spread");
    options.oscillator = osc;
  }
  const env: Record<string, number> = {};
  for (const k of ["attack", "decay", "sustain", "release"]) {
    const v = argNum(args, k);
    if (v !== undefined) env[k] = v;
  }
  if (Object.keys(env).length) options.envelope = env;
  if (argNum(args, "harmonicity") !== undefined) options.harmonicity = argNum(args, "harmonicity");
  if (argNum(args, "modulation_index") !== undefined) options.modulationIndex = argNum(args, "modulation_index");
  if (args.modulation_type) options.modulation = { type: args.modulation_type };
  if (argNum(args, "portamento") !== undefined) options.portamento = argNum(args, "portamento");
  if (type === "MonoSynth" || type === "DuoSynth") {
    if (argNum(args, "filter_frequency") !== undefined || argNum(args, "filter_q") !== undefined) {
      options.filter = { type: "lowpass", rolloff: -24, Q: argNum(args, "filter_q") ?? 2 };
      options.filterEnvelope = {
        baseFrequency: argNum(args, "filter_frequency") ?? 400,
        octaves: argNum(args, "filter_envelope_octaves") ?? 3,
        attack: 0.02,
        decay: argNum(args, "filter_envelope_decay") ?? 0.3,
        sustain: 0.3,
        release: 0.4,
      };
    }
  }
  const effects = parseFx(args.effects);
  return { type, options, effects, custom: true, name: (args.name as string) ?? (args.id as string) };
}

function ts(args: Record<string, unknown>): [number, number] | undefined {
  const b = argNum(args, "beats");
  const u = argNum(args, "unit");
  return b ? [b, u ?? 4] : undefined;
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (name === "search_conversation_history") return conversation.search(String(args.query ?? "").slice(0, 200), args.before == null ? Infinity : Number(args.before));
  if (name === "read_conversation_turn") return conversation.read(String(args.id ?? ""), Number(args.offset ?? 0));
  if (name === "evaluate_strudel") {
    if (typeof args.code !== "string") return "Error: Strudel code is required.";
    try { return await strudel.evaluate(args.code); } catch (error) { return `Error: ${(error as Error).message}`; }
  }
  if (name === "strudel_status") return JSON.stringify({ engine: strudel.selected(), code: strudel.code(), ...strudel.status() });
  if (name === "select_music_engine") {
    if (args.engine !== "tone" && args.engine !== "strudel") return "Error: choose tone or strudel.";
    await strudel.select(args.engine);
    return `Selected ${args.engine}; playback stopped, both projects preserved.`;
  }
  if (name === "get_audio_status") return JSON.stringify({ selectedEngine: strudel.selected(), tone: engine.audioStatus(), strudel: strudel.status() });
  await engine.init();
  switch (name) {
    case "set_bpm": {
      const bpm = argNum(args, "bpm");
      if (bpm === undefined) return "Error: bpm required";
      engine.setBPM(bpm);
      return `BPM ${engine.bpm}.`;
    }
    case "set_key": {
      engine.setKey(normalizeNote(String(args.key ?? "C")), String(args.scale ?? "minor"));
      return `Key ${engine.key} ${engine.scale}.`;
    }
    case "set_time_signature":
      engine.setTimeSignature(argNum(args, "beats") ?? 4, argNum(args, "unit") ?? 4);
      return `Time signature ${engine.timeSignature.join("/")}.`;

    case "add_track": {
      const notes = parseSteps(args.notes);
      const instrument = String(args.instrument);
      if (!INSTRUMENT_PRESETS[instrument]) return `Error: unknown instrument "${instrument}". Available: ${instrumentEnum().join(", ")}`;
      const state = engine.addTrack({
        id: String(args.id),
        name: String(args.name ?? args.id),
        instrument,
        volume: argNum(args, "volume") ?? -8,
        pan: argNum(args, "pan") ?? 0,
        pattern: { subdivision: (args.subdivision as Subdivision) ?? "16n", notes },
        fx: parseFx(args.fx),
      });
      return `Track "${state.id}" (${state.instrument}) added, ${state.stepCount} steps @ ${state.pattern.subdivision}${state.fx.length ? `, fx: ${state.fx.map((f) => f.type).join(">")}` : ""}.`;
    }
    case "update_track": {
      const id = String(args.id);
      const updates: Parameters<typeof engine.updateTrack>[1] = {};
      if (args.instrument) {
        if (!INSTRUMENT_PRESETS[String(args.instrument)]) return `Error: unknown instrument "${args.instrument}"`;
        updates.instrument = String(args.instrument);
      }
      if (argNum(args, "volume") !== undefined) updates.volume = argNum(args, "volume");
      if (argNum(args, "pan") !== undefined) updates.pan = argNum(args, "pan");
      if (args.name) updates.name = String(args.name);
      if (args.subdivision) updates.pattern = { subdivision: args.subdivision as Subdivision } as never;
      if (args.notes) updates.notes = parseSteps(args.notes);
      if (args.fx !== undefined) updates.fx = parseFx(args.fx);
      const state = engine.updateTrack(id, updates);
      return `Track "${id}" updated (${state.instrument}, ${state.stepCount} steps).`;
    }
    case "remove_track":
      engine.removeTrack(String(args.id));
      return `Track "${args.id}" removed.`;
    case "mute_track":
      engine.setMute(String(args.id), Boolean(args.muted));
      return `Track "${args.id}" ${args.muted ? "muted" : "unmuted"}.`;

    case "create_patch": {
      const id = String(args.id ?? args.name);
      const patch = engine.createPatch(id, patchFromArgs(args));
      return `Patch "${id}" (${patch.type}${patch.effects?.length ? `, fx: ${patch.effects.map((e) => e.type).join(">")}` : ""}) ready. Use instrument "${id}".`;
    }
    case "set_track_fx": {
      const state = engine.setTrackFx(String(args.id), parseFx(args.fx));
      return `FX on "${args.id}": ${state.fx.map((f, i) => `${i}:${f.type}`).join(" > ") || "none"}. Params: ${engine
        .listParams(String(args.id))
        .filter((p) => p.path.includes(".fx."))
        .map((p) => p.path.replace(`${args.id}.`, ""))
        .slice(0, 24)
        .join(", ")}`;
    }
    case "set_master_fx": {
      const chain = parseFx(args.fx);
      engine.setMasterFx(chain);
      return `Master chain: ${chain.map((f, i) => `${i}:${f.type}`).join(" > ") || "none"}.`;
    }

    case "list_params": {
      const list = engine.listParams(args.track_id ? String(args.track_id) : undefined);
      if (!list.length) return "No parameters (add tracks first).";
      return list.map((p) => `${p.path}=${p.value} [${p.min}..${p.max}]`).join("\n");
    }
    case "set_param": {
      const v = engine.setParam(String(args.path), argNum(args, "value") ?? 0, argNum(args, "ramp_seconds") ?? 0.02);
      return `${args.path} = ${Math.round(v * 1000) / 1000}.`;
    }
    case "automate_param": {
      const id = String(args.id ?? `auto-${String(args.path).replace(/\W+/g, "-")}`);
      engine.addAutomation({
        id,
        target: String(args.path),
        from: argNum(args, "from") ?? 0,
        to: argNum(args, "to") ?? 0,
        bars: Math.max(1, argNum(args, "bars") ?? 4),
        curve: (args.curve as "linear" | "exponential") ?? "linear",
      });
      return `Automation "${id}": ${args.path} ${args.from} → ${args.to} over ${args.bars} bars starting next bar.`;
    }

    case "add_modulation": {
      const mod: Modulation = {
        id: String(args.id),
        source: parseModSource(args.source),
        target: String(args.target),
        depth: argNum(args, "depth") ?? 0,
        offset: argNum(args, "offset") ?? 0,
        curve: argNum(args, "curve"),
        bipolar: Boolean(args.bipolar),
      };
      engine.addModulation(mod);
      return `Modulation "${mod.id}": ${mod.source.type} → ${mod.target} (offset ${mod.offset}, depth ${mod.depth}).`;
    }
    case "remove_modulation": {
      const id = String(args.id);
      const ok = engine.removeModulation(id) || engine.mods.removeAutomation(id);
      return ok ? `Removed "${id}".` : `Error: no modulation or automation "${id}"`;
    }
    case "set_macro":
      engine.setMacro(String(args.name), argNum(args, "value") ?? 0);
      return `Macro ${args.name} = ${args.value}.`;

    case "create_section": {
      const s = engine.createSection(String(args.id), String(args.name ?? args.id), argNum(args, "bars") ?? 8, { timeSignature: ts(args), bpm: argNum(args, "bpm") });
      return `Section "${s.id}" (${s.bars} bars${s.timeSignature ? `, ${s.timeSignature.join("/")}` : ""}${s.bpm ? `, ${s.bpm} BPM` : ""}) created with ${Object.keys(s.trackPatterns).length} track patterns.`;
    }
    case "update_section": {
      const clear = Boolean(args.clear_overrides);
      const s = engine.updateSection(String(args.id), { name: args.name ? String(args.name) : undefined, bars: argNum(args, "bars"), timeSignature: clear ? null : ts(args), bpm: clear ? null : argNum(args, "bpm") });
      return `Section "${s.id}": ${s.bars} bars${s.timeSignature ? `, ${s.timeSignature.join("/")}` : ""}${s.bpm ? `, ${s.bpm} BPM` : ""}.`;
    }
    case "set_section_pattern":
      engine.setSectionPattern(String(args.section_id), String(args.track_id), parseSteps(args.notes));
      return `Pattern set for ${args.track_id} in ${args.section_id}.`;
    case "set_arrangement": {
      const raw = typeof args.sections === "string" ? (JSON.parse(args.sections) as unknown) : args.sections;
      if (!Array.isArray(raw)) return "Error: sections must be a JSON array";
      engine.setArrangement(raw.map(String));
      return `Arrangement: ${engine.arrangement.join(" → ")}.`;
    }
    case "jump_to_section":
      engine.jumpToSection(String(args.section_id));
      return `Now in ${args.section_id}.`;

    case "mutate_pattern": {
      const out = engine.mutate(String(args.track_id), String(args.mutation), args);
      return `Applied ${args.mutation} to ${args.track_id}: ${describeSteps(out, 32)}`;
    }
    case "generate_pattern": {
      const out = generatePattern(args);
      return JSON.stringify(out);
    }
    case "set_evolution": {
      const rules = parseRules(args.rules);
      engine.setEvolution(String(args.track_id), rules);
      return `Evolution on "${args.track_id}": ${rules.map((r) => `${r.id} every ${r.every} bars [${r.ops.map((o) => o.type).join(",")}]`).join("; ")}.`;
    }
    case "evolve_now": {
      const id = String(args.track_id);
      if (args.rule) {
        const [rule] = parseRules(args.rule);
        if (!rule) return `Error: could not parse rule for "${id}"`;
        const out = engine.applyRule(id, rule);
        return `Evolved ${id}: ${describeSteps(out, 32)}`;
      }
      const state = engine.getState().tracks.find((t) => t.id === id);
      if (!state) return `Error: no track "${id}"`;
      if (!state.rules.length) return `Error: "${id}" has no evolution rules`;
      let last = "";
      for (const rule of state.rules) last = describeSteps(engine.applyRule(id, rule), 32);
      return `Evolved ${id}: ${last}`;
    }
    case "clear_evolution":
      engine.clearEvolution(args.track_id ? String(args.track_id) : undefined);
      return args.track_id ? `Evolution cleared on ${args.track_id}.` : "Evolution cleared on all tracks.";

    case "set_visuals":
      ctx.setVisuals(String(args.code));
      return `Visuals updated${args.note ? `: ${args.note}` : ""}.`;
    case "set_view":
      const view = args.view === "visualizer" ? "visualizer" : "studio";
      ctx.setView(view);
      return `View: ${view}.`;

    case "play":
      await strudel.play();
      return "Playing.";
    case "stop":
      await strudel.stop();
      return "Stopped.";
    case "save_song":
      return `Saved as ${ctx.saveSong(String(args.name))}.`;
    case "list_songs": {
      const songs = ctx.listSongs();
      return songs.length ? songs.map((s) => `${s.name} [key: ${s.key}] ${s.bpm} BPM, ${s.tracks} tracks`).join("\n") : "No saved songs.";
    }
    case "load_song":
      return ctx.loadSong(String(args.key));
    case "get_knowledge":
      return KNOWLEDGE;
    case "list_library":
      return listLibrary((args.kind as "patch" | "pattern" | "progression" | "arrangement" | "all") ?? "all", args.query ? String(args.query) : undefined);
    case "use_patch": {
      const { instrument, patch } = usePatch(String(args.id), args.as ? String(args.as) : undefined);
      return `Instrument "${instrument}" ready (${patch.type}${patch.effects?.length ? `, fx: ${patch.effects.map((e) => e.type).join(">")}` : ""}). Mix: volume ${patch.mix.volume} dB, octaves ${patch.mix.octaveLow}-${patch.mix.octaveHigh}, grid ${patch.grid}${patch.mix.pan ? `, pan ${patch.mix.pan}` : ""}.${patch.mix.note ? ` ${patch.mix.note}.` : ""}`;
    }
    case "use_pattern": {
      const { pattern, steps } = usePattern(String(args.id), { bars: argNum(args, "bars"), octave: argNum(args, "octave"), key: args.key ? String(args.key) : undefined, scale: args.scale ? String(args.scale) : undefined, swingMs: argNum(args, "swing_ms") });
      return JSON.stringify({ subdivision: pattern.subdivision, meter: pattern.meter ?? [4, 4], notes: steps, hint: pattern.notes ?? "" });
    }
    case "use_progression": {
      const r = useProgression(String(args.id), { key: args.key ? String(args.key) : undefined, mode: args.mode ? String(args.mode) : undefined, voicing: args.voicing as never, octave: argNum(args, "octave"), bassOctave: argNum(args, "bass_octave") });
      return JSON.stringify(r);
    }
    case "apply_template": {
      const r = applyTemplate(String(args.id), { scale: argNum(args, "scale") });
      return `Sections ${r.sections.join(", ")}; arrangement ${r.arrangement.join(" → ")}.\nRecipes:\n${Object.values(r.recipes).join("\n")}`;
    }
    case "get_state":
      return JSON.stringify(compactState(engine.getState()));
    case "get_audio_status":
      return JSON.stringify({ selectedEngine: strudel.selected(), tone: engine.audioStatus(), strudel: strudel.status() });
    case "done":
      return String(args.summary ?? "Done.");
    default:
      return `Error: unknown tool "${name}"`;
  }
}

function generatePattern(args: Record<string, unknown>): unknown {
  const num = (k: string, d: number) => argNum(args, k) ?? d;
  switch (String(args.type)) {
    case "euclidean":
      return Mutators.euclidean(num("hits", 5), num("steps", 16), num("velocity", 0.8), (args.note as string) ?? null, (args.duration as string) ?? "16n", num("rotation", 0));
    case "polyrhythm":
      return Mutators.euclidean(num("hits", 3), num("steps", 7), num("velocity", 0.8), (args.note as string) ?? null, (args.duration as string) ?? "16n", num("rotation", 0));
    case "scale_sequence":
      return Mutators.scaleSequence((args.key as string) ?? engine.key, (args.scale as string) ?? engine.scale, num("octave", 4), num("length", 16), {
        direction: args.direction as "up" | "down" | "random" | "pendulum" | undefined,
        restProbability: num("rest_probability", 0.2),
        duration: (args.duration as string) ?? "8n",
      });
    case "lsystem": {
      const rules = args.rules ? (typeof args.rules === "string" ? (JSON.parse(args.rules) as Record<string, string>) : (args.rules as Record<string, string>)) : undefined;
      return lsys(
        (args.key as string) ?? engine.key,
        (args.scale as string) ?? engine.scale,
        args.axiom as string | undefined,
        rules,
        num("depth", 2),
        num("octave", 4),
        num("length", 32),
        (args.duration as string) ?? "8n",
      );
    }
    case "cellular": {
      const steps = Array.from({ length: num("steps", 16) }, () => ({ rest: true }));
      return caStep(steps, num("rule", 90), "random", true, { hit: true, duration: (args.duration as string) ?? "16n", velocity: num("velocity", 0.8) });
    }
    default:
      throw new Error(`unknown generator "${args.type}"`);
  }
}

/** Song state trimmed for the model's context: patterns as short strings. */
export function compactState(state: SongState): Record<string, unknown> {
  return {
    musicEngine: strudel.selected(),
    strudel: { code: strudel.code(), ...strudel.status() },
    bpm: state.bpm,
    timeSignature: state.timeSignature.join("/"),
    key: `${state.key} ${state.scale}`,
    playing: state.isPlaying,
    bar: state.totalBars,
    tracks: state.tracks.map((t) => ({
      id: t.id,
      instrument: t.instrument,
      volume: t.volume,
      muted: t.muted || undefined,
      solo: t.solo || undefined,
      grid: t.pattern.subdivision,
      steps: describeSteps(t.pattern.notes, 64),
      fx: t.fx.length ? t.fx.map((f, i) => `${i}:${f.type}`).join(">") : undefined,
      evolution: t.rules.length ? t.rules.map((r) => `${r.id}@${r.every}b[${r.ops.map((o) => o.type).join(",")}]`) : undefined,
    })),
    sections: state.sections.map((s) => `${s.id}(${s.bars}${s.timeSignature ? ` ${s.timeSignature.join("/")}` : ""}${s.bpm ? ` ${s.bpm}bpm` : ""})`),
    arrangement: state.arrangement,
    currentSection: state.currentSection,
    masterFx: state.masterFx.map((f, i) => `${i}:${f.type}`),
    modulations: state.modulations.map((m) => `${m.id}: ${m.source.type} → ${m.target}`),
    automations: state.automations.map((a) => `${a.id}: ${a.target} ${a.from}→${a.to} /${a.bars}b`),
    macros: state.macros,
    customPatches: state.customPatches.map((p) => p.id),
    builtinInstruments: BUILTIN_INSTRUMENTS,
    libraryPatches: "use list_library kind=patch; use_patch registers one as an instrument",
  };
}
