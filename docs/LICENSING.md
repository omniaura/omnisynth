# OmniSynth licensing and source

The full Electron application is licensed under GNU AGPL version 3 only.
Peyton selected this license on 2026-11-04 to retain the upstream creative
projects rather than replace them for licensing reasons.

Hydra (`hydra-synth`) is retained under its upstream AGPL terms. The current
typed DAW engine uses Tone.js and includes code ported from Omar Barazanji's
MIT-licensed MIDI Gen; its original MIT notice is retained in
`third-party/midi-gen-MIT.txt`. Third-party components retain their own
licenses. The independent `bevy-slice/` remains MIT under its own LICENSE.

The packaging step includes LICENSE, upstream notices and corresponding
application source with its lockfile and build instructions in the app's
Resources directory. The bundled source is generated from this checkout,
without account files, credentials, build output or node_modules.
Dependency notices and dependency source accompany it.

Build from source with Bun 1.3.14 and Node 22.23.4:
`bun install --frozen-lockfile && bun run build`.
macOS packaging uses `bun run dist:unsigned`; signing/notarization requires
owner-controlled credentials described in MACOS_RELEASE.md.

Private installation, source availability, signing/notarization and public
publication are separate states. Choosing AGPL does not make this private
repository public. Before public binary distribution, make the matching
source and all required dependency notices available to recipients.
