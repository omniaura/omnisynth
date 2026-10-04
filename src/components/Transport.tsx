import { Show } from "solid-js";
import { engine } from "../engine/engine";
import { store } from "../stores/app";
import { NOTE_NAMES, SCALE_NAMES } from "../engine/presets";
import { exportSongFile, importSongFile, saveSong } from "../lib/songs";

const Icon = {
  play: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  stop: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ),
  gear: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
};

export default function Transport() {
  const song = store.song;
  const provider = () => store.providers().find((p) => p.id === store.settings.orchestrateProvider);

  async function toggle(): Promise<void> {
    if (song.isPlaying) engine.stop();
    else await engine.play();
  }

  return (
    <header class="transport" data-testid="transport">
      <div class="transport-left">
        <div class="brand">
          <span class="brand-mark" />
          <span class="brand-name">OmniSynth</span>
        </div>
        <input
          class="song-name"
          value={store.songName()}
          onChange={(e) => store.setSongName(e.currentTarget.value)}
          aria-label="Song name"
          data-testid="song-name"
        />
      </div>

      <div class="transport-center">
        <button class={`btn-play ${song.isPlaying ? "playing" : ""}`} onClick={toggle} title={song.isPlaying ? "Stop (Space)" : "Play (Space)"} data-testid="play">
          {song.isPlaying ? <Icon.stop /> : <Icon.play />}
        </button>
        <label class="field">
          <span>BPM</span>
          <input type="number" min="40" max="300" value={song.bpm} onChange={(e) => engine.setBPM(Number(e.currentTarget.value))} data-testid="bpm" />
        </label>
        <label class="field">
          <span>Key</span>
          <select value={song.key} onChange={(e) => engine.setKey(e.currentTarget.value, song.scale)} data-testid="key">
            {NOTE_NAMES.map((n) => (
              <option value={n}>{n}</option>
            ))}
          </select>
          <select value={song.scale} onChange={(e) => engine.setKey(song.key, e.currentTarget.value)} data-testid="scale">
            {SCALE_NAMES.map((s) => (
              <option value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Sig</span>
          <select value={`${song.timeSignature[0]}/${song.timeSignature[1]}`} onChange={(e) => {
            const [b, u] = e.currentTarget.value.split("/").map(Number);
            engine.setTimeSignature(b, u);
          }}>
            {["4/4", "3/4", "6/8", "7/8", "5/4"].map((s) => (
              <option value={s}>{s}</option>
            ))}
          </select>
        </label>
        <Show when={song.currentSection}>
          <span class="section-pill" data-testid="current-section">
            ▸ {song.currentSection}
          </span>
        </Show>
      </div>

      <div class="transport-right">
        <button class="btn-ghost" onClick={() => saveSong(store.songName() || "Untitled")} title="Save to library">
          Save
        </button>
        <button class="btn-ghost" onClick={() => void exportSongFile()} title="Export .omnisynth.json">
          Export
        </button>
        <button class="btn-ghost" onClick={() => void importSongFile()} title="Import song file">
          Import
        </button>
        <button class={`btn-ghost ${store.visualsOpen() ? "active" : ""}`} onClick={() => store.setVisualsOpen(!store.visualsOpen())} title="Visuals code">
          Visuals
        </button>
        <button class={`btn-ghost ${store.composerOpen() ? "active" : ""}`} onClick={() => store.setComposerOpen(!store.composerOpen())} title="Toggle composer">
          Composer
        </button>
        <button class={`provider-pill ${provider()?.authenticated ? "ok" : "warn"}`} onClick={() => store.setSettingsOpen(true)} title="Inference settings" data-testid="provider-pill">
          <span class="dot" />
          <span class="pill-label">{provider()?.authenticated ? provider()!.label : "Connect inference"}</span>
        </button>
        <button class="btn-icon" onClick={() => store.setSettingsOpen(true)} title="Settings" data-testid="settings">
          <Icon.gear />
        </button>
      </div>
    </header>
  );
}
