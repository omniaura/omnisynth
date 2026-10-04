# OmniSynth

An LLM-native DAW for electronic music. Give it a multisensory prompt — words,
reference images, a song, your notes — and a producer agent builds a playable,
editable track out of synthesizers, step sequencers, effects and audio-reactive
visuals. Made for the Aphex Twin / Autechre / Four Tet lineage and anyone making
EDM.

Built with Electron + SolidJS + Tone.js + Hydra. Inference runs through
[Ditto Router](https://router.heyditto.ai) (sign in with your Ditto account),
OpenRouter (for [Jev](https://openrouter.ai/typesafe/jev-router)), Ollama, or
whatever coding agent on your machine already has a gateway configured.

## How it works

1. **Perceive** — a cheap multimodal model turns the prompt and attachments
   into a creative brief: mood, tempo, key, energy curve, sound palette, visual
   palette. Attached audio is also analyzed locally (BPM, key, energy curve).
2. **Orchestrate** — a tool-calling producer agent builds the song: designs
   patches, adds tracks, writes sections and the arrangement, sets visuals,
   hits play.
3. **Edit** — everything it made is a normal DAW object you can tweak: steps,
   instruments, faders, sections. Prompt again to iterate.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```sh
bun install
bun run dev          # Vite + Electron
bun run typecheck
bun run dist         # package release/OmniSynth-<version>-arm64.dmg
```

QA against a running app: `OMNISYNTH_QA_PORT=9333 bun run dev` then
`node scripts/qa.mjs smoke|generate|attach|edit`.

## Tracking

Work is tracked in Jira project **SYNTH**: https://omniaura-team.atlassian.net/jira/software/projects/SYNTH/boards/37

Epics: Electron shell (SYNTH-4), DAW engine (SYNTH-5), multimodal pipeline
(SYNTH-6), inference providers (SYNTH-7), visuals (SYNTH-8), packaging/QA
(SYNTH-9). Jev on Ditto Router is tracked as SYNTH-24.

## Lineage

OmniSynth started in 2019 as a SuperCollider sound engine with a Kivy GUI and
hardware controllers ([omnisynth-dev](https://github.com/omniaura/omnisynth-dev),
[omnisynth-dsp](https://github.com/omniaura/omnisynth-dsp)). The engine and
agent tool surface here are ported from
[MIDI Gen](https://github.com/omarzanji/midi-gen).
