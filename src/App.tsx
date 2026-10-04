import { Show, createSignal, onCleanup, onMount } from "solid-js";
import "./App.css";
import HydraCanvas from "./components/HydraCanvas";
import Transport from "./components/Transport";
import TrackList from "./components/TrackList";
import Arrangement from "./components/Arrangement";
import ModPanel from "./components/ModPanel";
import Composer from "./components/Composer";
import Settings from "./components/Settings";
import CodeEditor from "./components/CodeEditor";
import { engine } from "./engine/engine";
import { store } from "./stores/app";
import { refreshProviders } from "./lib/run";
import { executeTool } from "./agent/tools";
import { toolContext } from "./lib/songs";

export default function App() {
  const [visualError, setVisualError] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal(store.visuals());
  const [cursorHidden, setCursorHidden] = createSignal(false);
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;

  const toggleView = () => store.setView(store.view() === "visualizer" ? "studio" : "visualizer");

  function onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    if (typing) return;
    if (e.key === " ") {
      e.preventDefault();
      if (engine.isPlaying) engine.stop();
      else void engine.play();
    }
    if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      toggleView();
    }
    if (e.key === "Escape") {
      if (store.view() === "visualizer") store.setView("studio");
      store.setSettingsOpen(false);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      store.setSettingsOpen(true);
    }
  }

  function onPointerMove(): void {
    if (store.view() !== "visualizer") return;
    setCursorHidden(false);
    if (cursorTimer) clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => setCursorHidden(true), 2500);
  }

  onMount(() => {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointermove", onPointerMove);
    void refreshProviders();
    // Resume the audio context on first interaction so Play is instant.
    const resume = () => void engine.init();
    window.addEventListener("pointerdown", resume, { once: true });
    // Debug/QA handle (scripts/qa.mjs reads state and drives tools through it).
    (window as unknown as { __omnisynth: unknown }).__omnisynth = { engine, store, tools: (name: string, args: Record<string, unknown>) => executeTool(name, args, toolContext) };
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointermove", onPointerMove);
  });

  return (
    <div class={`app view-${store.view()} ${cursorHidden() && store.view() === "visualizer" ? "cursor-hidden" : ""}`} data-testid="app" data-view={store.view()}>
      <HydraCanvas onError={setVisualError} />
      <Show when={store.view() === "studio"}>
        <div class="chrome">
          <Transport onToggleView={toggleView} />
          <main class={`workspace ${store.composerOpen() ? "" : "composer-hidden"}`}>
            <div class="center">
              <Arrangement />
              <TrackList />
              <ModPanel />
              <Show when={store.visualsOpen()}>
                <section class="panel visuals-panel" data-testid="visuals">
                  <div class="panel-head">
                    <h2>Visuals</h2>
                    <span class="muted">Hydra · a.fft[0..3], level(), time, bpm</span>
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
            <Show
              when={store.composerOpen()}
              fallback={
                <button class="composer-tab" onClick={() => store.setComposerOpen(true)} title="Open composer">
                  ‹ Compose
                </button>
              }
            >
              <Composer />
            </Show>
          </main>
        </div>
      </Show>
      <Show when={store.view() === "visualizer"}>
        <div class="visualizer-overlay" data-testid="visualizer-overlay">
          <button class="visualizer-pill" onClick={() => store.setView("studio")} title="Back to studio (F or Esc)" data-testid="exit-visualizer">
            <span class="dot" classList={{ live: store.song.isPlaying }} />
            {store.songName()} · {store.song.bpm} BPM
            <Show when={store.song.currentSection}>
              <span class="muted"> · {store.song.currentSection}</span>
            </Show>
            <kbd>F</kbd>
          </button>
          <Show when={store.running() !== "idle"}>
            <div class="visualizer-status">
              <span class="spinner" />
              {store.status() || "Working…"}
            </div>
          </Show>
        </div>
      </Show>
      <Settings />
      <Show when={store.toast()}>
        <div class="toast" data-testid="toast">
          {store.toast()}
        </div>
      </Show>
    </div>
  );
}
