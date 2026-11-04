# OmniSynth Bevy Slice

A separate native executable: one original synthesizer, a 16-step pattern,
audio-reactive ribbons, and authenticated agent control. This is a vertical
slice, not a DAW replacement. The existing Tauri/Electron app, dependencies,
assets, signing pipeline and stored data are unchanged.

## Run

Install Rust via rustup and use this directory's pinned toolchain:

```sh
cd bevy-slice
cargo run --locked
```

On Linux the build needs ALSA/X11 development packages. On macOS Rust uses
CoreAudio and Metal. Builds/tests in the coding workspace run on Omni Aura
Boat; native macOS builds use the dedicated macOS CI job. Nothing needs an
inference key or a Ditto login.

The app starts silent. Press **Space** to play/stop, **Up/Down** to change
tempo, **W** to switch sine/triangle, **R** to restore the initial pattern, or
click a step to toggle it. The fixed-size experimental window is named
**OmniSynth Bevy Slice**. Output gain is bounded to 0.25.

The audio callback owns the transport and synth. Timing uses sample frames,
not the render loop; the renderer reads measured RMS from the same generated
samples. Parameter changes cross a bounded command queue. The audio callback
does not take the controller lock, allocate, read files, or make HTTP calls.
This is a monophonic, decaying oscillator prototype, not a full DSP engine.

For explicit device-free simulation, use `--offline-audio`. Its label makes
that mode visible; it does not claim to produce device output. To export an
8-second WAV from the same synth without initializing a window/audio device:

```sh
cargo run --locked -- --render-wav /tmp/omnisynth-native.wav --seconds 8
```

## Agent tool call

Only a random `127.0.0.1` port is opened. Discovery is separate from existing
OmniSynth and Ditto:

* macOS: `~/Library/Application Support/OmniSynth Bevy Slice/bridge.json`
* Linux: `$XDG_CONFIG_HOME/omnisynth-bevy-slice/bridge.json` (defaults to `~/.config`)
* Windows: `%APPDATA%/OmniSynth Bevy Slice/bridge.json` (not yet validated)

The file contains `url`, `port`, `pid`, `app_id` and a random bearer token;
its Unix permissions are 0600. A second instance cannot overwrite the file.
Normal shutdown removes the instance's own file. A stale file after a crash
fails closed: inspect its PID before removing it. `--data-dir PATH` selects a
separate profile for QA or parallel instances, never a production app profile.
No URL scheme, updater or existing credential store is registered/read.

Use an MCP Streamable HTTP client with the discovered `url` and an
`Authorization: Bearer <token>` header. Supported methods are `initialize`,
`notifications/initialized`, `ping`, `tools/list`, and `tools/call`. Tools:

| Tool | Arguments | Result |
| --- | --- | --- |
| `set_pattern` | `notes`: exactly 16 MIDI notes (24–96) or null; `bpm`: 40–240; `gain`: 0–0.25; `waveform`: `sine` or `triangle` | accepted revision |
| `set_transport` | `playing`: boolean | accepted revision |
| `get_state` | empty object | sample frames, applied revision, transport, pattern, RMS and peak |

Example `tools/call` payload after initialization:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"set_transport","arguments":{"playing":true}}}
```

Acceptance is not application: poll `get_state.applied_revision` until it
reaches the returned `accepted_revision`. Telemetry fields are sampled
independently and may span adjacent callbacks. Browser Origin headers and
non-loopback Host values are rejected. Request bodies are limited to 8 KiB,
with four-second read deadlines, a 64-command queue and a fixed tool surface. No tool reads arbitrary
files, executes code, changes accounts, or invokes paid inference.

## Verification

```sh
cargo test --locked
cargo fmt --check
cargo build --locked
python3 scripts/smoke.py target/debug/omnisynth-bevy-slice --out .tmp/qa-unique
```

The Linux smoke uses its own Xvfb display, PulseAudio null sink and profile.
It drives the actual Bevy window, calls MCP to apply a pattern and start the
audio callback, edits a step and waveform through mouse/keyboard, and records
CPAL device output through the sink's monitor. It asserts audible sample
energy, bounded peaks and silence after stop. It writes `native.png`,
`native.mp4`, `loopback.wav` and `proof.json`, with no discovery token in the
proof. It shuts down only the processes it created.

This proves native rendering and virtual-device output. Physical speakers,
macOS hardware latency, signing/notarization, Windows, long sessions, full
arrangement/automation, polyphony and compatibility with existing songs are
not established by this slice. The current app remains the existing product.

## Licensing and isolation

This directory's original implementation is MIT; that grant does not relicense
the existing app. Bevy is MIT OR Apache-2.0; the audio and utility crates use
permissive licenses. `Cargo.lock` is independent of Bun and the
old Tauri lockfile. No Hydra/Strudel code or assets are copied into this crate.
Run `cargo metadata --locked --format-version 1` to inspect dependency license
expressions. Retain third-party notices and audit the complete target-specific
dependency/asset closure before distributing a binary.
