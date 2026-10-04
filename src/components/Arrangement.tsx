import { For, Show } from "solid-js";
import { engine } from "../engine/engine";
import { store } from "../stores/app";

/** Section chips in arrangement order; click to jump, drag-free reorder via arrows. */
export default function Arrangement() {
  const song = store.song;

  function move(i: number, dir: -1 | 1): void {
    const arr = [...song.arrangement];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    engine.setArrangement(arr);
  }

  function addSection(): void {
    const n = song.sections.length + 1;
    engine.createSection(`section-${n}`, `Section ${n}`, 8);
    if (!song.arrangement.includes(`section-${n}`)) engine.setArrangement([...song.arrangement, `section-${n}`]);
  }

  return (
    <section class="panel arrangement" data-testid="arrangement">
      <div class="panel-head">
        <h2>Arrangement</h2>
        <span class="muted">{song.arrangement.length ? `${song.arrangement.length} sections` : "looping patterns"}</span>
        <div class="spacer" />
        <button class="btn-ghost small" onClick={addSection}>
          + Section
        </button>
      </div>
      <Show when={song.arrangement.length > 0} fallback={<div class="empty small">No sections — the whole song loops the track patterns. Ask for an intro/build/drop or add a section.</div>}>
        <div class="section-strip">
          <For each={song.arrangement}>
            {(id, i) => {
              const sec = () => song.sections.find((s) => s.id === id);
              return (
                <div class={`section-chip ${i() === song.currentSectionIndex ? "current" : ""}`} style={{ "--bars": sec()?.bars ?? 8 }}>
                  <button class="section-jump" onClick={() => engine.jumpToSection(id)} title="Jump to section">
                    <span class="section-name">{sec()?.name ?? id}</span>
                    <span class="section-bars">
                      {sec()?.bars ?? "?"} bars
                      <Show when={sec()?.timeSignature}>{(t) => <span class="section-meta"> · {t()[0]}/{t()[1]}</span>}</Show>
                      <Show when={sec()?.bpm}>{(b) => <span class="section-meta"> · {b()} bpm</span>}</Show>
                    </span>
                  </button>
                  <div class="section-actions">
                    <button onClick={() => move(i(), -1)} title="Move left">
                      ‹
                    </button>
                    <button onClick={() => move(i(), 1)} title="Move right">
                      ›
                    </button>
                    <button onClick={() => engine.setArrangement(song.arrangement.filter((_, k) => k !== i()))} title="Remove from arrangement">
                      ×
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}
