import { Show, createSignal, onCleanup, onMount } from "solid-js";
import "./App.css";
import HydraCanvas from "./components/HydraCanvas";
import Transport from "./components/Transport";
import TrackList from "./components/TrackList";
import Arrangement from "./components/Arrangement";
import Composer from "./components/Composer";
import Settings from "./components/Settings";
import CodeEditor from "./components/CodeEditor";
import { engine } from "./engine/engine";
import { store } from "./stores/app";
import { refreshProviders } from "./lib/run";

export default function App() {
  const [visualError, setVisualError] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal(store.visuals());

  function onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    if (e.key === " " && !typing) {
      e.preventDefault();
      if (engine.isPlaying) engine.stop();
      else void engine.play();
    }
    if (e.key === "Escape") store.setSettingsOpen(false);
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      store.setSettingsOpen(true);
    }
  }

  onMount(() => {
    document.addEventListener("keydown", onKeyDown);
    void refreshProviders();
    // Resume the audio context on first interaction so Play is instant.
    const resume = () => void engine.init();
    window.addEventListener("pointerdown", resume, { once: true });
    // Debug/QA handle (scripts/qa.mjs reads state through it).
    (window as unknown as { __omnisynth: unknown }).__omnisynth = { engine, store };
  });
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  return (
    <div class="app" data-testid="app">
      <HydraCanvas onError={setVisualError} />
      <div class="chrome">
        <Transport />
        <main class={`workspace ${store.composerOpen() ? "" : "composer-hidden"}`}>
          <div class="center">
            <Arrangement />
            <TrackList />
            <Show when={store.visualsOpen()}>
              <section class="panel visuals-panel" data-testid="visuals">
                <div class="panel-head">
                  <h2>Visuals</h2>
                  <span class="muted">Hydra · a.fft[0..3] audio bands</span>
                  <Show when={visualError()}>
                    <span class="error tiny">{visualError()}</span>
                  </Show>
                  <div class="spacer" />
                  <button class="btn-primary small" onClick={() => store.setVisuals(draft())}>
                    Run ⌘↵
                  </button>
                </div>
                <div class="visuals-editor">
                  <CodeEditor label="hydra" code={store.visuals} onCodeChange={setDraft} onEvaluate={() => store.setVisuals(draft())} />
                </div>
              </section>
            </Show>
          </div>
          <Show when={store.composerOpen()} fallback={
            <button class="composer-tab" onClick={() => store.setComposerOpen(true)} title="Open composer">
              ‹ Compose
            </button>
          }>
            <Composer />
          </Show>
        </main>
      </div>
      <Settings />
      <Show when={store.toast()}>
        <div class="toast" data-testid="toast">{store.toast()}</div>
      </Show>
    </div>
  );
}
