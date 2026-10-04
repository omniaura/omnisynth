import * as Tone from "tone";
import { DRUM_INSTRUMENTS, INSTRUMENT_PRESETS, MEMBRANE_INSTRUMENTS, MONO_TYPES, type EffectConfig, type Patch, type SynthType } from "./presets";
import { MarkovChain, Mutators, expandToBars, parseSteps, stepsPerBar, type Pattern, type Step, type Subdivision } from "./patterns";

/**
 * The OmniSynth audio engine: Tone.js transport, tracks (step-sequenced
 * instruments), sections + arrangement, patches and generative mutation.
 * Ported from MIDI Gen's AudioEngine and typed; UI and agent tools both talk
 * to this class only.
 */

export interface TrackConfig {
  id: string;
  name: string;
  instrument: string;
  /** dB, -60..6 */
  volume: number;
  pan?: number;
  pattern: Pattern;
}

export interface Section {
  id: string;
  name: string;
  bars: number;
  /** Per-track pattern override for this section (trackId -> steps). */
  trackPatterns: Record<string, Step[]>;
}

interface Track {
  config: TrackConfig;
  synth: Tone.ToneAudioNode & { triggerAttackRelease?: (...args: unknown[]) => unknown; volume?: Tone.Param<"decibels"> | Tone.Signal<"decibels"> };
  effects: Tone.ToneAudioNode[];
  panner: Tone.Panner;
  channel: Tone.Volume;
  loop: Tone.Loop;
  current: Pattern;
  muted: boolean;
  solo: boolean;
  stepIndex: number;
}

export interface TrackState {
  id: string;
  name: string;
  instrument: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  pattern: Pattern;
  stepCount: number;
}

export interface SongState {
  bpm: number;
  timeSignature: [number, number];
  key: string;
  scale: string;
  isPlaying: boolean;
  tracks: TrackState[];
  sections: Array<{ id: string; name: string; bars: number; trackIds: string[] }>;
  arrangement: string[];
  currentSectionIndex: number;
  currentSection: string | null;
  customPatches: Array<{ id: string; type: SynthType; effects: EffectConfig[] }>;
}

export interface SongFile {
  version: 2;
  name?: string;
  timestamp: number;
  bpm: number;
  timeSignature: [number, number];
  key: string;
  scale: string;
  tracks: Array<TrackConfig & { muted?: boolean }>;
  sections: Section[];
  arrangement: string[];
  customPatches: Array<Patch & { id: string }>;
  visuals?: string;
}

type Listener<T> = (payload: T) => void;

export class AudioEngine {
  readonly tracks = new Map<string, Track>();
  readonly sections = new Map<string, Section>();
  arrangement: string[] = [];
  currentSectionIndex = 0;
  currentBar = 0;
  isPlaying = false;
  bpm = 120;
  timeSignature: [number, number] = [4, 4];
  key = "C";
  scale = "minor";

  private started = false;
  private master!: Tone.Gain;
  private limiter!: Tone.Limiter;
  analyser: Tone.Analyser | null = null;
  /** Raw Web Audio analyser for visuals (Hydra consumes an AnalyserNode). */
  analyserNode: AnalyserNode | null = null;
  private markov = new MarkovChain();
  private stepListeners: Listener<{ trackId: string; step: number }>[] = [];
  private changeListeners: Listener<SongState>[] = [];
  private sectionListeners: Listener<{ section: Section | null; index: number }>[] = [];
  private barSteps = 0;

  async init(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Gain(0.8).connect(this.limiter);
    this.analyser = new Tone.Analyser("fft", 256);
    this.master.connect(this.analyser);
    const ctx = Tone.getContext().rawContext as AudioContext;
    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 512;
    this.analyserNode.smoothingTimeConstant = 0.6;
    Tone.connect(this.master, this.analyserNode);
    Tone.getTransport().bpm.value = this.bpm;
    Tone.getTransport().timeSignature = this.timeSignature;
    this.started = true;
  }

  get ready(): boolean {
    return this.started;
  }

  // --- Events ---
  onStep(cb: Listener<{ trackId: string; step: number }>): () => void {
    this.stepListeners.push(cb);
    return () => (this.stepListeners = this.stepListeners.filter((l) => l !== cb));
  }
  onChange(cb: Listener<SongState>): () => void {
    this.changeListeners.push(cb);
    return () => (this.changeListeners = this.changeListeners.filter((l) => l !== cb));
  }
  onSectionChange(cb: Listener<{ section: Section | null; index: number }>): () => void {
    this.sectionListeners.push(cb);
    return () => (this.sectionListeners = this.sectionListeners.filter((l) => l !== cb));
  }
  private emitChange(): void {
    const state = this.getState();
    for (const l of this.changeListeners) l(state);
  }

  // --- Transport ---
  setBPM(bpm: number): void {
    this.bpm = Math.max(40, Math.min(300, bpm));
    if (this.started) Tone.getTransport().bpm.rampTo(this.bpm, 0.1);
    this.emitChange();
  }

  setTimeSignature(beats: number, unit: number): void {
    this.timeSignature = [beats, unit];
    if (this.started) Tone.getTransport().timeSignature = this.timeSignature;
    this.emitChange();
  }

  setKey(key: string, scale: string): void {
    this.key = key;
    this.scale = scale;
    this.emitChange();
  }

  async play(): Promise<void> {
    await this.init();
    this.tracks.forEach((t) => {
      t.stepIndex = 0;
      t.loop.start(0);
    });
    this.currentBar = 0;
    this.barSteps = 0;
    this.applySectionPatterns();
    Tone.getTransport().start("+0.05");
    this.isPlaying = true;
    this.emitChange();
  }

  stop(): void {
    if (!this.started) return;
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
    this.tracks.forEach((t) => {
      t.loop.stop();
      t.stepIndex = 0;
    });
    this.isPlaying = false;
    this.currentBar = 0;
    this.barSteps = 0;
    this.emitChange();
  }

  // --- Patches ---
  private createSynth(instrument: string): Track["synth"] {
    const preset = INSTRUMENT_PRESETS[instrument];
    const ToneAny = Tone as unknown as Record<string, new (opts?: unknown) => Tone.ToneAudioNode>;
    if (!preset) {
      console.warn(`Unknown instrument "${instrument}", using default synth`);
      return new Tone.PolySynth(Tone.Synth) as unknown as Track["synth"];
    }
    const Cls = ToneAny[preset.type];
    if (!Cls) return new Tone.PolySynth(Tone.Synth) as unknown as Track["synth"];
    if (MONO_TYPES.has(preset.type)) return new Cls(preset.options) as unknown as Track["synth"];
    const poly = new Tone.PolySynth(Cls as unknown as typeof Tone.Synth, preset.options as never);
    poly.maxPolyphony = 16;
    return poly as unknown as Track["synth"];
  }

  private createEffect(fx: EffectConfig): Tone.ToneAudioNode | null {
    const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
    const wet = (node: { wet?: Tone.Signal<"normalRange"> }) => {
      if (fx.wet !== undefined && node.wet) node.wet.value = Math.max(0, Math.min(1, fx.wet));
    };
    switch (String(fx.type).toLowerCase()) {
      case "reverb": {
        const n = new Tone.Reverb({ decay: num(fx.decay, 2.5), wet: num(fx.wet, 0.3) });
        return n;
      }
      case "delay":
      case "feedbackdelay": {
        const n = new Tone.FeedbackDelay((fx.delayTime as string) ?? "8n", num(fx.feedback, 0.3));
        wet(n);
        return n;
      }
      case "pingpong": {
        const n = new Tone.PingPongDelay((fx.delayTime as string) ?? "8n", num(fx.feedback, 0.3));
        wet(n);
        return n;
      }
      case "chorus": {
        const n = new Tone.Chorus(num(fx.frequency, 1.5), num(fx.delayTime, 3.5), num(fx.depth, 0.7)).start();
        wet(n);
        return n;
      }
      case "distortion": {
        const n = new Tone.Distortion(num(fx.distortion, 0.4));
        wet(n);
        return n;
      }
      case "phaser": {
        const n = new Tone.Phaser({ frequency: num(fx.frequency, 0.5), octaves: num(fx.octaves, 3), baseFrequency: num(fx.baseFrequency, 350) });
        wet(n);
        return n;
      }
      case "tremolo": {
        const n = new Tone.Tremolo(num(fx.frequency, 9), num(fx.depth, 0.75)).start();
        wet(n);
        return n;
      }
      case "bitcrusher": {
        const n = new Tone.BitCrusher(num(fx.bits, 4));
        wet(n);
        return n;
      }
      case "autofilter": {
        const n = new Tone.AutoFilter({ frequency: (fx.frequency as string | number) ?? "4n", baseFrequency: num(fx.baseFrequency, 200), octaves: num(fx.octaves, 4) }).start();
        wet(n);
        return n;
      }
      case "eq":
      case "eq3":
        return new Tone.EQ3({ low: num(fx.low, 0), mid: num(fx.mid, 0), high: num(fx.high, 0) });
      case "compressor":
        return new Tone.Compressor({ threshold: num(fx.threshold, -24), ratio: num(fx.ratio, 4) });
      case "filter":
        return new Tone.Filter({ frequency: num(fx.frequency, 800), type: (fx.filterType as BiquadFilterType) ?? "lowpass", Q: num(fx.Q, 1) });
      default:
        console.warn(`Unknown effect "${fx.type}" ignored`);
        return null;
    }
  }

  /** Registers a runtime patch so it can be used as an instrument. */
  createPatch(id: string, patch: Patch): Patch {
    INSTRUMENT_PRESETS[id] = { ...patch, custom: true, name: patch.name ?? id };
    // Re-create any tracks already using this instrument so the edit is audible.
    for (const track of [...this.tracks.values()]) {
      if (track.config.instrument === id) this.rebuildTrack(track.config);
    }
    this.emitChange();
    return INSTRUMENT_PRESETS[id];
  }

  getPatch(id: string): Patch | undefined {
    return INSTRUMENT_PRESETS[id];
  }

  listInstruments(): string[] {
    return Object.keys(INSTRUMENT_PRESETS);
  }

  // --- Tracks ---
  addTrack(config: TrackConfig): TrackState {
    if (!this.started) throw new Error("engine not started");
    if (this.tracks.has(config.id)) this.removeTrack(config.id);

    const synth = this.createSynth(config.instrument);
    const preset = INSTRUMENT_PRESETS[config.instrument];
    const effects: Tone.ToneAudioNode[] = [];
    for (const fx of preset?.effects ?? []) {
      const node = this.createEffect(fx);
      if (node) effects.push(node);
    }
    const panner = new Tone.Panner(config.pan ?? 0);
    const channel = new Tone.Volume(config.volume ?? -8);
    const chain: Tone.ToneAudioNode[] = [synth, ...effects, panner, channel];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    channel.connect(this.master);

    const subdivision = config.pattern.subdivision ?? "16n";
    const isDrum = DRUM_INSTRUMENTS.has(config.instrument) || (preset ? MONO_TYPES.has(preset.type) && ["NoiseSynth", "MetalSynth", "MembraneSynth"].includes(preset.type) : false);
    const isMembrane = MEMBRANE_INSTRUMENTS.has(config.instrument) || preset?.type === "MembraneSynth";
    const isMetal = preset?.type === "MetalSynth";
    const isNoise = preset?.type === "NoiseSynth";

    const track: Track = {
      config,
      synth,
      effects,
      panner,
      channel,
      current: config.pattern,
      muted: false,
      solo: false,
      stepIndex: 0,
      loop: null as unknown as Tone.Loop,
    };

    track.loop = new Tone.Loop((time) => {
      const steps = track.current.notes;
      this.advanceBarClock(track, subdivision);
      if (!steps || steps.length === 0) return;
      const idx = track.stepIndex % steps.length;
      const step = steps[idx];
      track.stepIndex++;
      Tone.getDraw().schedule(() => {
        for (const l of this.stepListeners) l({ trackId: config.id, step: idx });
      }, time);

      if (!step || step.rest) return;
      if (track.muted) return;
      if (this.anySolo() && !track.solo) return;
      const velocity = step.velocity ?? (isDrum ? 0.8 : 0.7);
      try {
        if (isDrum) {
          if (!step.hit && !step.note) return;
          if (isMembrane) synth.triggerAttackRelease?.(step.note ?? "C1", step.duration ?? "16n", time, velocity);
          else if (isMetal || isNoise) synth.triggerAttackRelease?.(step.duration ?? (isMetal ? "32n" : "16n"), time, velocity);
          else synth.triggerAttackRelease?.(step.note ?? "C2", step.duration ?? "16n", time, velocity);
        } else if (step.note) {
          synth.triggerAttackRelease?.(step.note, step.duration ?? "8n", time, velocity);
        } else if (step.hit) {
          synth.triggerAttackRelease?.("C3", step.duration ?? "8n", time, velocity);
        }
      } catch (err) {
        console.warn(`Track ${config.id} playback error:`, (err as Error).message);
      }
    }, subdivision);

    if (this.isPlaying) track.loop.start(Tone.getTransport().nextSubdivision("1m"));
    this.tracks.set(config.id, track);

    // New tracks join every existing section with their base pattern.
    this.sections.forEach((section) => {
      if (!section.trackPatterns[config.id]) {
        section.trackPatterns[config.id] = expandToBars(config.pattern.notes, subdivision, section.bars, this.timeSignature[0]);
      }
    });
    this.emitChange();
    return this.trackState(track);
  }

  /** Only the first track's clock advances the section/bar counter. */
  private advanceBarClock(track: Track, subdivision: Subdivision): void {
    const first = this.tracks.keys().next().value;
    if (first !== track.config.id) return;
    this.barSteps++;
    const perBar = stepsPerBar(subdivision, this.timeSignature[0]);
    if (this.barSteps % perBar === 0 && this.arrangement.length > 0) {
      this.currentBar++;
      const section = this.getCurrentSection();
      if (section && this.currentBar >= section.bars) {
        this.currentBar = 0;
        this.currentSectionIndex = (this.currentSectionIndex + 1) % this.arrangement.length;
        this.applySectionPatterns();
        this.notifySection();
      }
    }
  }

  private anySolo(): boolean {
    for (const t of this.tracks.values()) if (t.solo) return true;
    return false;
  }

  private rebuildTrack(config: TrackConfig): void {
    const old = this.tracks.get(config.id);
    const muted = old?.muted ?? false;
    const solo = old?.solo ?? false;
    const wasPlaying = this.isPlaying;
    this.removeTrack(config.id, false);
    this.addTrack(config);
    const t = this.tracks.get(config.id)!;
    t.muted = muted;
    t.solo = solo;
    if (wasPlaying) t.loop.start(0);
  }

  removeTrack(id: string, emit = true): void {
    const track = this.tracks.get(id);
    if (!track) return;
    track.loop.stop();
    track.loop.dispose();
    track.synth.dispose();
    track.effects.forEach((n) => n.dispose());
    track.panner.dispose();
    track.channel.dispose();
    this.tracks.delete(id);
    this.sections.forEach((s) => delete s.trackPatterns[id]);
    if (emit) this.emitChange();
  }

  updateTrack(id: string, updates: Partial<Omit<TrackConfig, "id">> & { notes?: Step[] }): TrackState {
    const track = this.tracks.get(id);
    if (!track) throw new Error(`no track "${id}"`);
    const config: TrackConfig = { ...track.config, ...updates, id, pattern: { ...track.config.pattern, ...(updates.pattern ?? {}) } };
    if (updates.notes) config.pattern = { ...config.pattern, notes: updates.notes };

    const needsRebuild = (updates.instrument && updates.instrument !== track.config.instrument) || (updates.pattern?.subdivision && updates.pattern.subdivision !== track.config.pattern.subdivision);
    if (needsRebuild) {
      const sectionPatterns = new Map(
        [...this.sections].map(([sectionId, section]) => [sectionId, section.trackPatterns[id]] as const),
      );
      const subdivisionChanged = updates.pattern?.subdivision !== undefined && updates.pattern.subdivision !== track.config.pattern.subdivision;
      this.rebuildTrack(config);
      if (!subdivisionChanged) {
        this.sections.forEach((section, sectionId) => {
          const pattern = sectionPatterns.get(sectionId);
          if (pattern !== undefined) section.trackPatterns[id] = pattern;
        });
      }
      if (updates.notes !== undefined || updates.pattern?.notes !== undefined) {
        const section = this.getCurrentSection();
        if (section) section.trackPatterns[id] = config.pattern.notes;
      }
      this.applySectionPatterns();
      this.emitChange();
      return this.trackState(this.tracks.get(id)!);
    }
    track.config = config;
    track.current = config.pattern;
    if (updates.notes !== undefined || updates.pattern?.notes !== undefined) {
      const section = this.getCurrentSection();
      if (section) section.trackPatterns[id] = config.pattern.notes;
    }
    if (updates.volume !== undefined) track.channel.volume.rampTo(updates.volume, 0.05);
    if (updates.pan !== undefined) track.panner.pan.rampTo(updates.pan, 0.05);
    if (updates.name) track.config.name = updates.name;
    this.emitChange();
    return this.trackState(track);
  }

  setMute(id: string, muted: boolean): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.muted = muted;
    this.emitChange();
  }
  setSolo(id: string, solo: boolean): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.solo = solo;
    this.emitChange();
  }

  private trackState(t: Track): TrackState {
    return {
      id: t.config.id,
      name: t.config.name,
      instrument: t.config.instrument,
      volume: t.config.volume,
      pan: t.config.pan ?? 0,
      muted: t.muted,
      solo: t.solo,
      pattern: t.current,
      stepCount: t.current.notes.length,
    };
  }

  // --- Sections / arrangement ---
  createSection(id: string, name: string, bars: number): Section {
    const section: Section = { id, name, bars, trackPatterns: {} };
    this.tracks.forEach((t, trackId) => {
      section.trackPatterns[trackId] = expandToBars(t.current.notes, t.current.subdivision, bars, this.timeSignature[0]);
    });
    this.sections.set(id, section);
    if (this.arrangement.length === 0) this.arrangement.push(id);
    this.emitChange();
    return section;
  }

  removeSection(id: string): void {
    this.sections.delete(id);
    this.arrangement = this.arrangement.filter((s) => s !== id);
    this.emitChange();
  }

  setSectionPattern(sectionId: string, trackId: string, notes: Step[]): void {
    const section = this.sections.get(sectionId);
    if (!section) throw new Error(`no section "${sectionId}"`);
    if (!this.tracks.has(trackId)) throw new Error(`no track "${trackId}"`);
    section.trackPatterns[trackId] = notes;
    if (this.getCurrentSection()?.id === sectionId) this.applySectionPatterns();
    this.emitChange();
  }

  setArrangement(sectionIds: string[]): void {
    const unknown = sectionIds.filter((id) => !this.sections.has(id));
    if (unknown.length) throw new Error(`unknown sections: ${unknown.join(", ")}`);
    this.arrangement = [...sectionIds];
    this.currentSectionIndex = 0;
    this.applySectionPatterns();
    this.emitChange();
  }

  getCurrentSection(): Section | null {
    if (this.arrangement.length === 0) return null;
    return this.sections.get(this.arrangement[this.currentSectionIndex % this.arrangement.length]) ?? null;
  }

  jumpToSection(idOrIndex: string | number): void {
    if (typeof idOrIndex === "number") this.currentSectionIndex = idOrIndex % Math.max(1, this.arrangement.length);
    else {
      const idx = this.arrangement.indexOf(idOrIndex);
      if (idx < 0) throw new Error(`section "${idOrIndex}" is not in the arrangement`);
      this.currentSectionIndex = idx;
    }
    this.currentBar = 0;
    this.applySectionPatterns();
    this.notifySection();
    this.emitChange();
  }

  private applySectionPatterns(): void {
    const section = this.getCurrentSection();
    this.tracks.forEach((track, id) => {
      const notes = section?.trackPatterns[id];
      track.current = notes ? { ...track.config.pattern, notes } : track.config.pattern;
    });
  }

  private notifySection(): void {
    const payload = { section: this.getCurrentSection(), index: this.currentSectionIndex };
    for (const l of this.sectionListeners) l(payload);
  }

  // --- Generative ---
  mutate(trackId: string, mutation: string, params: Record<string, unknown> = {}): Step[] {
    const track = this.tracks.get(trackId);
    if (!track) throw new Error(`no track "${trackId}"`);
    const notes = [...track.current.notes];
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    const isDrum = DRUM_INSTRUMENTS.has(track.config.instrument);
    let out: Step[];
    switch (mutation) {
      case "dropout":
        out = Mutators.dropout(notes, num("probability", 0.15));
        break;
      case "humanize":
        out = Mutators.humanize(notes, num("amount", 0.12));
        break;
      case "reverse":
        out = Mutators.reverse(notes);
        break;
      case "rotate":
        out = Mutators.rotate(notes, num("steps", 1));
        break;
      case "euclidean":
        out = Mutators.euclidean(num("hits", 5), notes.length || 16, num("velocity", 0.8), (params.note as string) ?? (isDrum ? null : "C3"), track.config.pattern.subdivision);
        break;
      case "density":
        out = Mutators.densityMorph(notes, num("density", 0.5), isDrum ? { hit: true, duration: "16n" } : { note: `${this.key}3`, duration: "8n" });
        break;
      case "markov": {
        this.markov.train(notes);
        const seed = notes[notes.length - 1] ?? { rest: true };
        const generated = this.markov.generate(seed, num("length", notes.length * 2) - notes.length);
        out = [...notes, ...generated.slice(1)];
        break;
      }
      default:
        throw new Error(`unknown mutation "${mutation}"`);
    }
    const section = this.getCurrentSection();
    if (section) {
      track.config.pattern = { ...track.config.pattern, notes: out };
      section.trackPatterns[trackId] = out;
      track.current = track.config.pattern;
    } else {
      track.config.pattern = { ...track.config.pattern, notes: out };
      track.current = track.config.pattern;
    }
    this.emitChange();
    return out;
  }

  generate(type: string, params: Record<string, unknown> = {}): Step[] {
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    switch (type) {
      case "euclidean":
        return Mutators.euclidean(num("hits", 5), num("steps", 16), num("velocity", 0.8), (params.note as string) ?? null, (params.duration as string) ?? "16n");
      case "scale_sequence":
        return Mutators.scaleSequence((params.key as string) ?? this.key, (params.scale as string) ?? this.scale, num("octave", 4), num("length", 16), {
          direction: params.direction as "up" | "down" | "random" | "pendulum" | undefined,
          restProbability: num("rest_probability", 0.2),
          duration: (params.duration as string) ?? "8n",
        });
      default:
        throw new Error(`unknown generator "${type}"`);
    }
  }

  // --- State / persistence ---
  getState(): SongState {
    const tracks = [...this.tracks.values()].map((t) => this.trackState(t));
    const sections = [...this.sections.values()].map((s) => ({ id: s.id, name: s.name, bars: s.bars, trackIds: Object.keys(s.trackPatterns) }));
    const customPatches = Object.entries(INSTRUMENT_PRESETS)
      .filter(([, p]) => p.custom)
      .map(([id, p]) => ({ id, type: p.type, effects: p.effects ?? [] }));
    return {
      bpm: this.bpm,
      timeSignature: this.timeSignature,
      key: this.key,
      scale: this.scale,
      isPlaying: this.isPlaying,
      tracks,
      sections,
      arrangement: [...this.arrangement],
      currentSectionIndex: this.currentSectionIndex,
      currentSection: this.getCurrentSection()?.id ?? null,
      customPatches,
    };
  }

  exportSong(name?: string, visuals?: string): SongFile {
    return {
      version: 2,
      name,
      timestamp: Date.now(),
      bpm: this.bpm,
      timeSignature: this.timeSignature,
      key: this.key,
      scale: this.scale,
      tracks: [...this.tracks.values()].map((t) => ({ ...t.config, muted: t.muted })),
      sections: [...this.sections.values()].map((s) => ({ ...s, trackPatterns: { ...s.trackPatterns } })),
      arrangement: [...this.arrangement],
      customPatches: Object.entries(INSTRUMENT_PRESETS)
        .filter(([, p]) => p.custom)
        .map(([id, p]) => ({ id, ...p })),
      visuals,
    };
  }

  async importSong(song: SongFile): Promise<void> {
    const tracks = (song.tracks ?? []).map((t) => {
      const { muted, ...config } = t;
      return {
        config: { ...config, pattern: { subdivision: config.pattern?.subdivision ?? "16n", notes: parseSteps(config.pattern?.notes ?? []) } },
        muted,
      };
    });
    await this.init();
    this.stop();
    [...this.tracks.keys()].forEach((id) => this.removeTrack(id, false));
    this.sections.clear();
    this.arrangement = [];
    this.currentSectionIndex = 0;
    this.bpm = song.bpm ?? 120;
    Tone.getTransport().bpm.value = this.bpm;
    this.timeSignature = song.timeSignature ?? [4, 4];
    Tone.getTransport().timeSignature = this.timeSignature;
    this.key = song.key ?? "C";
    this.scale = song.scale ?? "minor";
    for (const patch of song.customPatches ?? []) {
      const { id, ...rest } = patch;
      INSTRUMENT_PRESETS[id] = { ...rest, custom: true };
    }
    for (const { config, muted } of tracks) {
      this.addTrack(config);
      if (muted) this.setMute(config.id, true);
    }
    for (const s of song.sections ?? []) this.sections.set(s.id, { ...s, trackPatterns: { ...s.trackPatterns } });
    this.arrangement = (song.arrangement ?? []).filter((id) => this.sections.has(id));
    this.applySectionPatterns();
    this.emitChange();
  }
    for (const s of song.sections ?? []) this.sections.set(s.id, { ...s, trackPatterns: { ...s.trackPatterns } });
    this.arrangement = (song.arrangement ?? []).filter((id) => this.sections.has(id));
    this.applySectionPatterns();
    this.emitChange();
  }

  clear(): void {
    this.stop();
    [...this.tracks.keys()].forEach((id) => this.removeTrack(id, false));
    this.sections.clear();
    this.arrangement = [];
    this.currentSectionIndex = 0;
    this.emitChange();
  }

  /** Average level 0..1 from the FFT, for meters. */
  level(): number {
    if (!this.analyser) return 0;
    const values = this.analyser.getValue() as Float32Array;
    let sum = 0;
    for (const v of values) sum += Math.max(0, (v + 100) / 100);
    return Math.min(1, sum / values.length);
  }
}

export const engine = new AudioEngine();
