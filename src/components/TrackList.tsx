import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { engine, type TrackState } from "../engine/engine";
import { store } from "../stores/app";
import { INSTRUMENT_PRESETS } from "../engine/presets";
import type { Step } from "../engine/patterns";

/**
 * Track list with inline mixer controls and a step grid per track. Short
 * patterns (≤ 64 steps) are clickable buttons; long ones (agent-written
 * 224–896 step lines) are drawn on a canvas strip so the DOM stays small and
 * the playhead costs one draw call instead of hundreds of class flips.
 */

const BUTTON_GRID_MAX = 64;

function stepLabel(s: Step): string {
  if (s.rest) return "";
  if (s.hit) return "●";
  if (Array.isArray(s.note)) return s.note.length > 1 ? `${s.note[0]}+` : s.note[0];
  return s.note ?? "";
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Canvas strip for long patterns: velocity-shaded cells, beat ticks, locks, playhead. */
function StepStrip(props: { track: TrackState; onToggle: (i: number) => void }) {
  let canvas: HTMLCanvasElement | undefined;
  let playhead: HTMLDivElement | undefined;
  const current = () => store.currentStep[props.track.id] ?? -1;

  function draw(): void {
    if (!canvas) return;
    const notes = props.track.pattern.notes;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = notes.length || 1;
    const cw = w / n;
    const accent = cssVar("--accent-primary", "#ff3366");
    const bg = cssVar("--bg-secondary", "#12121a");
    const border = cssVar("--border-strong", "#363648");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const s = notes[i];
      const x = i * cw;
      if (!s.rest) {
        const vel = Math.max(0.15, Math.min(1, s.velocity ?? 0.8));
        ctx.globalAlpha = 0.35 + vel * 0.65;
        ctx.fillStyle = accent;
        ctx.fillRect(x + 0.5, 2, Math.max(1, cw - 1), h - 4);
        ctx.globalAlpha = 1;
        if (s.ratchet && s.ratchet > 1) {
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          for (let r = 1; r < s.ratchet; r++) ctx.fillRect(x + (cw * r) / s.ratchet, 2, 1, h - 4);
        }
        if (s.prob !== undefined && s.prob < 1) {
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(x + 0.5, 2, Math.max(1, cw - 1), (h - 4) * (1 - s.prob));
        }
      }
      if (s.lock) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(x + 1, 1.5, Math.max(1, cw - 2), h - 3);
        ctx.setLineDash([]);
      }
      if (i % 16 === 0) {
        ctx.fillStyle = border;
        ctx.fillRect(Math.floor(x), 0, 1, h);
      } else if (i % 4 === 0 && cw >= 3) {
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(Math.floor(x), 0, 1, h);
      }
    }
  }

  // Redraw when the pattern changes; the playhead is a separate element so it never triggers a redraw.
  createEffect(() => {
    void props.track.pattern.notes;
    void props.track.pattern.notes.length;
    queueMicrotask(draw);
  });
  createEffect(() => {
    const i = current();
    if (!playhead || !canvas) return;
    const n = props.track.pattern.notes.length || 1;
    playhead.style.transform = `translateX(${(i / n) * canvas.clientWidth}px)`;
    playhead.style.width = `${Math.max(2, canvas.clientWidth / n)}px`;
  });
  onMount(() => {
    const ro = new ResizeObserver(() => draw());
    if (canvas) ro.observe(canvas);
    onCleanup(() => ro.disconnect());
  });

  function onClick(e: MouseEvent): void {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const n = props.track.pattern.notes.length || 1;
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    props.onToggle(Math.max(0, Math.min(n - 1, i)));
  }

  return (
    <div class="step-strip" title={`${props.track.pattern.notes.length} steps @ ${props.track.pattern.subdivision} — click to toggle a step`}>
      <canvas ref={canvas} onClick={onClick} />
      <div ref={playhead} class="step-strip-playhead" />
    </div>
  );
}

function TrackRow(props: { track: TrackState }) {
  const [editing, setEditing] = createSignal(false);
  const [notesText, setNotesText] = createSignal("");
  const current = () => store.currentStep[props.track.id] ?? -1;
  const isDrum = () => props.track.pattern.notes.every((s) => s.rest || s.hit);
  const dense = () => props.track.pattern.notes.length > BUTTON_GRID_MAX;

  function toggleStep(i: number): void {
    const notes = props.track.pattern.notes.map((s) => ({ ...s }));
    const s = notes[i];
    if (!s) return;
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
const parsed: unknown = JSON.parse(notesText());
        if (
          !Array.isArray(parsed) ||
          parsed.some((step) => {
            if (step === null || typeof step !== "object" || Array.isArray(step)) return true;
            const s = step as Record<string, unknown>;
            const validNote = typeof s.note === "string" || (Array.isArray(s.note) && s.note.every((note) => typeof note === "string"));
            return !(
              (s.rest === true || s.hit === true || validNote) &&
              (s.rest === undefined || typeof s.rest === "boolean") &&
              (s.hit === undefined || typeof s.hit === "boolean") &&
              (s.note === undefined || validNote) &&
              (s.velocity === undefined || typeof s.velocity === "number") &&
              (s.ratchet === undefined || typeof s.ratchet === "number") &&
              (s.prob === undefined || typeof s.prob === "number") &&
                (s.cond === undefined || typeof s.cond === "string") &&
                (s.nudge === undefined || typeof s.nudge === "number") &&
                (s.slide === undefined || typeof s.slide === "number") &&
                (s.duration === undefined || typeof s.duration === "string") &&
                (s.lock === undefined || typeof s.lock === "boolean")
            );
          })
        ) throw new Error("expected an array of valid step objects");
        const notes = parsed as Step[];
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
          <span class="grid-label">
            {props.track.pattern.notes.length}·{props.track.pattern.subdivision}
          </span>
          <button class="chip" onClick={openEditor} title="Edit pattern JSON">
            {"{}"}
          </button>
          <button class="chip danger" onClick={() => engine.removeTrack(props.track.id)} title="Remove track">
            ×
          </button>
        </div>
      </div>
      <Show when={!dense()} fallback={<StepStrip track={props.track} onToggle={toggleStep} />}>
        <div class="steps" style={{ "--count": props.track.pattern.notes.length }}>
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
      </Show>
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
    let n = song.tracks.length + 1;
    while (song.tracks.some((track) => track.id === `track-${n}`)) n++;
    const id = `track-${n}`;
    engine.addTrack({ id, name: `Track ${n}`, instrument: "synth", volume: -8, pattern: { subdivision: "16n", notes: Array.from({ length: 16 }, () => ({ rest: true })) } });
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
