import { For, Show, createSignal } from "solid-js";
import { engine, type TrackState } from "../engine/engine";
import { store } from "../stores/app";
import { INSTRUMENT_PRESETS } from "../engine/presets";
import type { Step } from "../engine/patterns";

/** Track list with inline mixer controls and a clickable step grid per track. */

function stepLabel(s: Step): string {
  if (s.rest) return "";
  if (s.hit) return "●";
  if (Array.isArray(s.note)) return s.note.length > 1 ? `${s.note[0]}+` : s.note[0];
  return s.note ?? "";
}

function TrackRow(props: { track: TrackState }) {
  const [editing, setEditing] = createSignal(false);
  const [notesText, setNotesText] = createSignal("");
  const current = () => store.currentStep[props.track.id] ?? -1;
  const isDrum = () => props.track.pattern.notes.every((s) => s.rest || s.hit);

  function toggleStep(i: number): void {
    const notes = props.track.pattern.notes.map((s) => ({ ...s }));
    const s = notes[i];
    if (s.rest) notes[i] = isDrum() ? { hit: true, velocity: 0.85 } : { note: `${store.song.key}3`, duration: props.track.pattern.subdivision, velocity: 0.8 };
    else notes[i] = { rest: true };
    engine.updateTrack(props.track.id, { notes });
  }

  function openEditor(): void {
    setNotesText(JSON.stringify(props.track.pattern.notes));
    setEditing(true);
  }

  function applyNotes(): void {
    try {
      const notes = JSON.parse(notesText()) as Step[];
      engine.updateTrack(props.track.id, { notes });
      setEditing(false);
    } catch (err) {
      store.showToast(`Pattern JSON invalid: ${(err as Error).message}`);
    }
  }

  return (
    <div class={`track ${props.track.muted ? "muted" : ""} ${props.track.solo ? "solo" : ""}`} data-testid={`track-${props.track.id}`}>
      <div class="track-head">
        <div class="track-title">
          <input class="track-name" value={props.track.name} onChange={(e) => engine.updateTrack(props.track.id, { name: e.currentTarget.value })} />
          <select class="track-instrument" value={props.track.instrument} onChange={(e) => engine.updateTrack(props.track.id, { instrument: e.currentTarget.value })} title="Instrument">
            <For each={Object.keys(INSTRUMENT_PRESETS)}>{(name) => <option value={name}>{name}</option>}</For>
          </select>
        </div>
        <div class="track-controls">
          <Show when={props.track.fx.length}>
            <span class="badge tiny" title={props.track.fx.map((f) => f.type).join(" › ")}>fx {props.track.fx.length}</span>
          </Show>
          <Show when={props.track.modCount}>
            <span class="badge tiny mod" title="modulations">mod {props.track.modCount}</span>
          </Show>
          <Show when={props.track.rules.length}>
            <span class="badge tiny evolve" title={props.track.rules.map((r) => `${r.id}: ${r.ops.map((o) => o.type).join(",")} every ${r.every} bars`).join("\n")}>evolving</span>
          </Show>
          <button class={`chip ${props.track.muted ? "on" : ""}`} onClick={() => engine.setMute(props.track.id, !props.track.muted)} title="Mute">
            M
          </button>
          <button class={`chip ${props.track.solo ? "on solo" : ""}`} onClick={() => engine.setSolo(props.track.id, !props.track.solo)} title="Solo">
            S
          </button>
          <input class="fader" type="range" min="-40" max="6" step="0.5" value={props.track.volume} onInput={(e) => engine.updateTrack(props.track.id, { volume: Number(e.currentTarget.value) })} title={`${props.track.volume} dB`} />
          <input class="pan" type="range" min="-1" max="1" step="0.05" value={props.track.pan} onInput={(e) => engine.updateTrack(props.track.id, { pan: Number(e.currentTarget.value) })} title="Pan" />
          <span class="grid-label">{props.track.pattern.subdivision}</span>
          <button class="chip" onClick={openEditor} title="Edit pattern JSON">
            {"{}"}
          </button>
          <button class="chip danger" onClick={() => engine.removeTrack(props.track.id)} title="Remove track">
            ×
          </button>
        </div>
      </div>
      <div class={`steps ${props.track.pattern.notes.length > 32 ? "dense" : ""}`} style={{ "--count": props.track.pattern.notes.length }}>
        <For each={props.track.pattern.notes}>
          {(step, i) => (
            <button class={`step ${step.rest ? "" : "on"} ${current() === i() ? "now" : ""} ${i() % 4 === 0 ? "beat" : ""} ${step.lock ? "locked" : ""} ${step.prob !== undefined && step.prob < 1 ? "prob" : ""}`} style={{ "--vel": step.velocity ?? 0.8 }} onClick={() => toggleStep(i())} title={`Step ${i() + 1}${step.prob !== undefined ? ` · p${step.prob}` : ""}${step.ratchet ? ` · ×${step.ratchet}` : ""}${step.cond ? ` · ${step.cond}` : ""}`}>
              <span>{stepLabel(step)}</span>
              <Show when={step.ratchet && step.ratchet > 1}>
                <i class="ratchet">×{step.ratchet}</i>
              </Show>
            </button>
          )}
        </For>
      </div>
      <Show when={editing()}>
        <div class="pattern-editor">
          <textarea value={notesText()} onInput={(e) => setNotesText(e.currentTarget.value)} rows="3" spellcheck={false} />
          <div class="row">
            <button class="btn-primary small" onClick={applyNotes}>
              Apply
            </button>
            <button class="btn-ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default function TrackList() {
  const song = store.song;

  async function addEmptyTrack(): Promise<void> {
    await engine.init();
    const id = `track-${song.tracks.length + 1}`;
    engine.addTrack({ id, name: `Track ${song.tracks.length + 1}`, instrument: "synth", volume: -8, pattern: { subdivision: "16n", notes: Array.from({ length: 16 }, () => ({ rest: true })) } });
  }

  return (
    <section class="panel tracks" data-testid="tracks">
      <div class="panel-head">
        <h2>Tracks</h2>
        <span class="muted">{song.tracks.length}</span>
        <div class="spacer" />
        <button class="btn-ghost small" onClick={() => void addEmptyTrack()} data-testid="add-track">
          + Track
        </button>
      </div>
      <Show
        when={song.tracks.length > 0}
        fallback={
          <div class="empty">
            <p>No tracks yet.</p>
            <p class="muted">Describe a track, drop in reference images or a song, and hit Generate — or add a track and draw steps.</p>
          </div>
        }
      >
        <div class="track-list">
          <For each={song.tracks}>{(t) => <TrackRow track={t} />}</For>
        </div>
      </Show>
    </section>
  );
}
