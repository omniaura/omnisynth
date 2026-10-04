# OmniSynth architecture

OmniSynth is an LLM-native DAW for electronic music. The artist gives a
multisensory prompt — text plus images, audio and notes — and an agent builds a
playable, editable song out of synthesizers, step sequencers, effects and
audio-reactive visuals.

```
 prompt + attachments
        │
        ▼
 ┌──────────────┐   brief (JSON)   ┌──────────────────┐   tool calls   ┌─────────────────┐
 │  PERCEIVE    │ ───────────────▶ │   ORCHESTRATE    │ ─────────────▶ │  DAW ENGINE     │
 │ cheap multi- │                  │ producer agent   │                │ Tone.js tracks, │
 │ modal model  │                  │ (Jev / Sonnet /  │ ◀───────────── │ patches,        │
 │ + local audio│                  │  any tool-caller)│   results      │ sections, Hydra │
 │   analysis   │                  └──────────────────┘                └─────────────────┘
 └──────────────┘
```

## Processes

**Electron main** (`electron/`)
- `providers.ts` — detects inference providers on this machine: Ditto Router
  (app sign-in, `heyditto` CLI login, or Claude Code's `ANTHROPIC_*` env when it
  points at the router), OpenRouter, Ollama, and coding-agent gateways (Claude
  Code, Codex, OpenCode). Reads the user's login shell once so packaged apps
  see the same env as the terminal.
- `inference.ts` — OpenAI-compatible `/chat/completions` proxy. Keys never
  reach the renderer; no CORS. Retries without sampling params when a model
  rejects them.
- `ditto.ts` — "Sign in with Ditto" via the same device flow as `heyditto
  login`; lists/creates inference endpoints and mints a key for this install.
  The OmniSynth endpoint is created in passthrough mode with memory and
  server-side tools off, so the app chooses the model per stage.
- `secrets.ts` — `safeStorage`-encrypted key/value store in `userData`.
- `main.ts` — window, IPC registration, file dialogs, `OMNISYNTH_QA_PORT`
  (exposes CDP for `scripts/qa.mjs`).

**Preload** (`electron/preload.ts`) exposes `window.omnisynth` (typed in
`shared/ipc.ts`). Built as CJS so it exists before the renderer boots.

**Renderer** (`src/`, SolidJS)
- `engine/` — the DAW engine (ported from [MIDI Gen](https://github.com/omarzanji/midi-gen)):
  `presets.ts` instrument presets + patch model, `patterns.ts` step model and
  generators (Markov, euclidean, scale sequences, mutations), `engine.ts`
  transport, tracks, effects chains, sections/arrangement, persistence.
- `agent/` — `perceive.ts` (brief extraction; audio is analyzed locally in
  `lib/audio-analysis.ts` for BPM/key/energy so any model can use it),
  `orchestrate.ts` (tool loop), `tools.ts` (tool schemas + executor),
  `client.ts` (bridge wrapper with a browser fallback for `vite dev`).
- `components/` — Transport, Arrangement, TrackList (step grid + mixer),
  Composer (prompt, attachments, brief, run log), Settings (providers,
  Ditto sign-in, per-stage model), HydraCanvas (visuals; `a.fft[0..3]`,
  `level`, `time` are live inside sketches).
- `stores/app.ts` — reactive mirror of engine state + UI state.

## Tool surface

Transport/song: `set_bpm`, `set_key`, `set_time_signature`
Tracks: `add_track`, `update_track`, `remove_track`, `mute_track`
Sound design: `create_patch`, `set_track_fx`, `set_master_fx`
Parameter graph: `list_params`, `set_param`, `automate_param`
Modulation: `add_modulation`, `remove_modulation`, `set_macro`
Structure: `create_section` (optional per-section meter/tempo), `update_section`, `set_section_pattern`, `set_arrangement`, `jump_to_section`
Generative: `generate_pattern`, `mutate_pattern`, `set_evolution`, `evolve_now`, `clear_evolution`
Visuals/view: `set_visuals`, `set_view`
Persistence: `play`, `stop`, `save_song`, `list_songs`, `load_song`, `get_state`, `done`

Patches created mid-run are added to the instrument enum for the next turn.

## Parameter graph

Every node the engine builds is addressable by path, so the agent can patch
anything into anything (Max/MSP style):

```
kick.synth.pitchDecay          acid.synth.filterEnvelope.baseFrequency
acid.fx.2.frequency            pad.volume      hats.pan
master.fx.1.wet                bpm
```

`<track>.fx.<i>` indexes the combined chain: the patch's own effects first,
then the track chain set by `add_track`/`set_track_fx`. Signals/Params
(filter frequency, wet, feedback, detune, volume…) get audio-rate handles;
option leaves (PolySynth envelope.attack, oscillator.spread, Reverb.decay)
go through `node.set()`. Ranges are clamped per parameter name.

## Mod matrix (`engine/modulation.ts`)

`value = offset + depth * source`, clamped to the target range.

| Source | Notes |
| --- | --- |
| `lfo` | tempo-synced (`"1m"`, `"4n"`) or Hz; sine/triangle/sawtooth/square connect at audio rate when the target is a Signal, random/S&H tick at 32n |
| `follower` | envelope follower on a track's output; `invert: true` = sidechain ducking |
| `random` | smoothed random walk at a rate |
| `steps` | a mod lane of 0..1 values |
| `band` | live audio band 0..3 from the visualizer analyser |
| `macro` | 0..1 knob set with `set_macro` |
| `bar` / `section` | position within the current section / arrangement |

Automations (`automate_param`) are bar-synced ramps scheduled on the bar
clock; they are removed when they finish.

## Evolution engine (`engine/evolution.ts`)

Rules live on tracks: `{every, prob, ops[], min_density, max_density,
max_generations}`. On each bar boundary the engine runs due rules on the
track's current pattern (and the active section's copy), then applies
density constraints. Locked steps are never touched.

Ops: `markov` (order-N, temperature), `cellular` (elementary CA on the hit
mask), `lsystem` (scale-degree rewriting), `genetic` (hill-climb toward
density/syncopation/similarity), `euclid_morph`, `rotate`, `dropout`,
`humanize`, `density`, `transpose_scale`, `stutter` (ratchets),
`probability`, `reverse`, `param_walk` (random-walk any parameter path),
`reset` (back to the seed).

Steps carry `prob`, `ratchet`, `nudge`, `cond` (`"1:4"`, `"!1:2"`), `slide`
and `lock`, evaluated per pass in the track loop.

## Sections

Sections own `bars`, optional `timeSignature` and `bpm`, and per-track
pattern copies. The first track's loop advances the bar clock using the
active meter; at a section boundary the transport switches meter/tempo and
patterns swap.

## Views

`studio` (transport, arrangement, tracks, modulation panel, composer) and
`visualizer` (Hydra full-window; `F`/⛶ toggles, Esc returns, cursor
auto-hides). The agent can switch with `set_view`.


## Models

| Stage | Ditto Router | OpenRouter | Local |
| --- | --- | --- | --- |
| Perceive | `anthropic/claude-sonnet-5.5` (images; audio as analysis text) | `google/gemini-3.5-flash-lite` (images + audio) | any vision model |
| Orchestrate | `anthropic/claude-sonnet-5.5` | `typesafe/jev-router` (Jev) | any tool-calling model |

Jev is not on Ditto Router yet (SYNTH-24). When it lands, the Ditto defaults
switch to it.

## QA

```sh
OMNISYNTH_QA_PORT=9333 bun run dev            # or the packaged app binary
node scripts/qa.mjs smoke|generate|edit|all   # Playwright over CDP
```

Screenshots land in `/tmp/omnisynth-qa/`. `window.__omnisynth` exposes the
engine and store for inspection.

## Build

```sh
bun install
bun run dev        # Vite + Electron with HMR
bun run dist       # release/OmniSynth-<version>-arm64.dmg (unsigned)
```
