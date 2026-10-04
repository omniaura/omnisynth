import type { ChatToolDefinition } from "../../shared/ipc";
import { engine, type SongState } from "../engine/engine";
import { BUILTIN_INSTRUMENTS, EFFECT_TYPES, INSTRUMENT_PRESETS, OSCILLATOR_TYPES, SCALE_NAMES, SYNTH_TYPES, type EffectConfig, type Patch, type SynthType } from "../engine/presets";
import { normalizeNote, parseSteps, type Subdivision } from "../engine/patterns";

/**
 * The DAW tool surface the orchestrator agent calls. Definitions are
 * OpenAI-compatible; `executeTool` applies each call to the engine (and the
 * visuals store) and returns a short result string the model reads back.
 */

export interface ToolContext {
  setVisuals(code: string): void;
  getVisuals(): string;
  saveSong(name: string): string;
  listSongs(): Array<{ name: string; key: string; bpm: number; tracks: number }>;
  loadSong(key: string): Promise<string>;
}

const NOTES_DOC =
  'JSON array of steps. Melodic: [{"note":"C4","duration":"8n","velocity":0.8},{"rest":true},{"note":["C4","Eb4","G4"],"duration":"4n"}]. Drums: [{"hit":true,"velocity":0.9},{"rest":true}]. Shorthand allowed: "C4" for a note, null or "-" for a rest, 1/0 for drum hit/rest.';

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
    def("set_bpm", "Set the tempo.", { bpm: { type: "number", description: "40-300" } }, ["bpm"]),
    def("set_key", "Set the song key and scale; generators use it.", { key: { type: "string", description: "Root: C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B" }, scale: { type: "string", enum: SCALE_NAMES } }, ["key", "scale"]),
    def("set_time_signature", "Set the time signature.", { beats: { type: "integer" }, unit: { type: "integer", description: "4 = quarter note" } }, ["beats", "unit"]),
    def(
      "add_track",
      "Add a step-sequenced track. One instrument per track; make separate tracks for kick, snare, hats, bass, lead, pad. Patterns loop; 16 steps of 16n = one bar in 4/4.",
      {
        id: { type: "string", description: "slug like kick, hats, acid-bass, lead" },
        name: { type: "string" },
        instrument: { type: "string", enum: instruments, description: "Preset or a patch created with create_patch" },
        volume: { type: "number", description: "dB. -6 drums, -8 bass, -12 pads, -10 leads" },
        pan: { type: "number", description: "-1 left .. 1 right" },
        subdivision: { type: "string", enum: ["4n", "8n", "16n", "32n"], description: "Grid. 16n drums/acid, 8n bass/melody, 4n chords" },
        notes: { type: "string", description: NOTES_DOC },
      },
      ["id", "name", "instrument", "subdivision", "notes"],
    ),
    def(
      "update_track",
      "Change a track's instrument, pattern, volume or pan.",
      { id: { type: "string" }, instrument: { type: "string", enum: instruments }, volume: { type: "number" }, pan: { type: "number" }, subdivision: { type: "string", enum: ["4n", "8n", "16n", "32n"] }, notes: { type: "string", description: NOTES_DOC }, name: { type: "string" } },
      ["id"],
    ),
    def("remove_track", "Remove a track.", { id: { type: "string" } }, ["id"]),
    def("mute_track", "Mute or unmute a track.", { id: { type: "string" }, muted: { type: "boolean" } }, ["id", "muted"]),
    def(
      "create_patch",
      "Design a synth patch (oscillator, envelope, FM/AM, filter, effects chain). Then use its id as an instrument in add_track/update_track. Re-creating an existing id edits that instrument live.",
      {
        id: { type: "string", description: "slug like hoover-lead, rubber-bass, airy-pad" },
        type: { type: "string", enum: SYNTH_TYPES },
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
        filter_frequency: { type: "number", description: "MonoSynth filter cutoff Hz" },
        filter_q: { type: "number" },
        filter_envelope_octaves: { type: "number", description: "MonoSynth filter env sweep in octaves" },
        portamento: { type: "number" },
        effects: {
          type: "string",
          description: `JSON array of effects in order. Types: ${EFFECT_TYPES.join(", ")}. e.g. [{"type":"filter","frequency":900,"Q":2},{"type":"distortion","distortion":0.3,"wet":0.5},{"type":"delay","delayTime":"8n.","feedback":0.35,"wet":0.25},{"type":"reverb","decay":4,"wet":0.3}]`,
        },
      },
      ["id", "type"],
    ),
    def("create_section", "Create a song section (intro, build, drop, break, outro). It starts as copies of current track patterns stretched to `bars`.", { id: { type: "string" }, name: { type: "string" }, bars: { type: "integer", description: "4, 8, 16 or 32" } }, ["id", "name", "bars"]),
    def("set_section_pattern", "Give one track a different pattern inside one section (e.g. drop drums hit harder than the intro).", { section_id: { type: "string" }, track_id: { type: "string" }, notes: { type: "string", description: NOTES_DOC } }, ["section_id", "track_id", "notes"]),
    def("set_arrangement", "Order sections into the song; it loops. e.g. [\"intro\",\"build\",\"drop\",\"break\",\"drop\",\"outro\"]", { sections: { type: "string", description: "JSON array of section ids" } }, ["sections"]),
    def("jump_to_section", "Jump playback to a section now.", { section_id: { type: "string" } }, ["section_id"]),
    def(
      "mutate_pattern",
      "Transform a track's current pattern generatively: dropout, humanize, reverse, rotate, euclidean, density, markov.",
      {
        track_id: { type: "string" },
        mutation: { type: "string", enum: ["dropout", "humanize", "reverse", "rotate", "euclidean", "density", "markov"] },
        probability: { type: "number" },
        amount: { type: "number" },
        steps: { type: "integer" },
        hits: { type: "integer" },
        density: { type: "number" },
        length: { type: "integer" },
        note: { type: "string" },
        velocity: { type: "number" },
      },
      ["track_id", "mutation"],
    ),
    def(
      "generate_pattern",
      "Generate a pattern algorithmically and return it (then pass it to add_track/update_track). euclidean rhythms or scale_sequence melodies in the song key.",
      {
        type: { type: "string", enum: ["euclidean", "scale_sequence"] },
        hits: { type: "integer" },
        steps: { type: "integer" },
        velocity: { type: "number" },
        note: { type: "string" },
        key: { type: "string" },
        scale: { type: "string", enum: SCALE_NAMES },
        octave: { type: "integer" },
        length: { type: "integer" },
        direction: { type: "string", enum: ["up", "down", "random", "pendulum"] },
        rest_probability: { type: "number" },
        duration: { type: "string", enum: ["4n", "8n", "16n"] },
      },
      ["type"],
    ),
    def(
      "set_visuals",
      "Set the Hydra sketch rendered behind the DAW. Hydra JS: osc(), noise(), voronoi(), shape(), gradient(), src(o0) chains with .color().rotate().modulate().kaleid().out(). `a.fft[0..3]` are audio bands 0..1 (bass..treble) for reactivity, e.g. osc(10,0.1,()=>a.fft[0]*2).out(). Finish with .out().",
      { code: { type: "string" }, note: { type: "string", description: "One line on the visual idea" } },
      ["code"],
    ),
    def("play", "Start playback.", {}),
    def("stop", "Stop playback.", {}),
    def("save_song", "Save the current song.", { name: { type: "string" } }, ["name"]),
    def("list_songs", "List saved songs.", {}),
    def("load_song", "Load a saved song by key.", { key: { type: "string" } }, ["key"]),
    def("get_state", "Return the current song state (tracks, patterns, sections, arrangement).", {}),
    def("done", "Call when all changes are made. Summarize what you built for the artist in 1-3 sentences.", { summary: { type: "string" } }, ["summary"]),
  ];
}

function argNum(args: Record<string, unknown>, k: string): number | undefined {
  const v = args[k];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
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
      options.filterEnvelope = { baseFrequency: argNum(args, "filter_frequency") ?? 400, octaves: argNum(args, "filter_envelope_octaves") ?? 3, attack: 0.02, decay: 0.3, sustain: 0.3, release: 0.4 };
    }
  }
  let effects: EffectConfig[] = [];
  if (args.effects) {
    const raw = typeof args.effects === "string" ? (JSON.parse(args.effects) as unknown) : args.effects;
    if (Array.isArray(raw)) effects = raw.filter((e) => e && typeof e === "object" && "type" in e) as EffectConfig[];
  }
  return { type, options, effects, custom: true, name: (args.name as string) ?? (args.id as string) };
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
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
      });
      return `Track "${state.id}" (${state.instrument}) added, ${state.stepCount} steps @ ${state.pattern.subdivision}.`;
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
    case "create_section": {
      const s = engine.createSection(String(args.id), String(args.name ?? args.id), argNum(args, "bars") ?? 8);
      return `Section "${s.id}" (${s.bars} bars) created with ${Object.keys(s.trackPatterns).length} track patterns.`;
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
      return `Applied ${args.mutation} to ${args.track_id}: ${out.length} steps.`;
    }
    case "generate_pattern": {
      const out = engine.generate(String(args.type), args);
      return JSON.stringify(out);
    }
    case "set_visuals":
      ctx.setVisuals(String(args.code));
      return `Visuals updated${args.note ? `: ${args.note}` : ""}.`;
    case "play":
      await engine.play();
      return "Playing.";
    case "stop":
      engine.stop();
      return "Stopped.";
    case "save_song":
      return `Saved as ${ctx.saveSong(String(args.name))}.`;
    case "list_songs": {
      const songs = ctx.listSongs();
      return songs.length ? songs.map((s) => `${s.name} [key: ${s.key}] ${s.bpm} BPM, ${s.tracks} tracks`).join("\n") : "No saved songs.";
    }
    case "load_song":
      return ctx.loadSong(String(args.key));
    case "get_state":
      return JSON.stringify(compactState(engine.getState()));
    case "done":
      return String(args.summary ?? "Done.");
    default:
      return `Error: unknown tool "${name}"`;
  }
}

/** Song state trimmed for the model's context: patterns as short strings. */
export function compactState(state: SongState): Record<string, unknown> {
  return {
    bpm: state.bpm,
    timeSignature: state.timeSignature.join("/"),
    key: `${state.key} ${state.scale}`,
    playing: state.isPlaying,
    tracks: state.tracks.map((t) => ({
      id: t.id,
      instrument: t.instrument,
      volume: t.volume,
      muted: t.muted || undefined,
      grid: t.pattern.subdivision,
      steps: t.pattern.notes
        .slice(0, 64)
        .map((s) => (s.rest ? "-" : s.hit ? "x" : Array.isArray(s.note) ? s.note.join("+") : s.note))
        .join(" "),
    })),
    sections: state.sections.map((s) => `${s.id}(${s.bars})`),
    arrangement: state.arrangement,
    currentSection: state.currentSection,
    customPatches: state.customPatches.map((p) => p.id),
    builtinInstruments: BUILTIN_INSTRUMENTS,
  };
}
