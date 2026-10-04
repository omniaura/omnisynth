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

`set_bpm`, `set_key`, `set_time_signature`, `add_track`, `update_track`,
`remove_track`, `mute_track`, `create_patch`, `create_section`,
`set_section_pattern`, `set_arrangement`, `jump_to_section`, `mutate_pattern`,
`generate_pattern`, `set_visuals`, `play`, `stop`, `save_song`, `list_songs`,
`load_song`, `get_state`, `done`.

Patches created mid-run are added to the instrument enum for the next turn.

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
