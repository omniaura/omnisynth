<p align="center">
  <img src="assets/branding/omnisynth-logo-original.png" width="200" alt="OmniSynth logo — three flowing bands of light" />
</p>

# OmniSynth

Live coding audio-visual studio: [Strudel](https://strudel.cc/) for sound, [Hydra](https://hydra.ojack.xyz/) for visuals. Built with SolidJS + Vite.

Logo assets and source: [branding](assets/branding/README.md).

## Status

This default branch contains the original Tauri prototype. The full Electron
application, including Tone.js, Hydra, Strudel and Producer chat, is being
prepared in [the release pull request](https://github.com/omniaura/omnisynth/pull/13).
The separate [Bevy experiment](bevy-slice/) explores a smaller native slice.

## License

OmniSynth application source is licensed under [GNU AGPL version 3 only](LICENSE).
Third-party projects retain their own licenses, including Strudel and Hydra;
this repository's license does not replace their upstream terms.
The independent Bevy experiment remains [MIT licensed](bevy-slice/LICENSE).
Earlier revisions retain the licenses granted with those revisions.

Public source availability does not mean a signed desktop release is ready.
Binary packaging, signing, notarization and release verification are tracked
separately in the release pull request.

## Development

```sh
bun install
bun run dev
```
