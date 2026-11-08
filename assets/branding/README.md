# OmniSynth logo

Peyton selected **Light loom**, direction 06, on 2026-11-01. Three broad flowing bands connect sound, synthesis and light. This is OmniSynth's product mark, distinct from Omni Aura's parent mark and Ditto Desktop's identity.

- `omnisynth-logo-original.png`: the exact owner-supplied 1254 × 1254 PNG, preserved byte for byte. SHA-256: `8beeadcb8a23385c038e97c0e97af7459dd4f2ad6ad3e75bdec31a04367c852f`.
- `omnisynth-logo.svg` and `omnisynth-logo-reverse.svg`: editable outline traces for light and dark backgrounds. Trace curves are derived from the selected raster; they are not a hand-drawn vector master.
- `omnisynth-logo-2048.png` and `omnisynth-logo-reverse-2048.png`: transparent 2048 × 2048 exports from the traced geometry. These are vector rerenders, not additional native generated detail.

The README displays the exact chosen image. Peyton also selected it as the app icon on 2026-11-08. Run `bun run icons` to regenerate the Tauri desktop icon files, the browser favicon and `build/icon.icns`, the path used by the pending Electron macOS packaging configuration. `omnisynth-app-icon.png` is the generated desktop raster. Generation uses the original PNG unchanged as its source, with the selected black mark on white. SVG favicon geometry comes from the existing outline trace with a white ground.

This updates the desktop icon assets, not the separate Bevy experiment's window icon or mobile project scaffolding. Signing and release activation are separate work. A rebuilt app uses the new bundle icon; an already installed app requires a new build or a Finder custom-icon override.

The full ten-direction archive, generation prompts, comparison sheets and small-icon studies live in the shared [OmniSynth logo archive](https://drive.google.com/drive/folders/1yRLnkBq85xw1MoigoLzrHOrDvStW3NGl), alongside preserved Omni Aura legacy assets. None of the other nine candidates is selected.
