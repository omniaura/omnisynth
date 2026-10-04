import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { engine, type EvolveEvent } from "../engine/engine";
import { store } from "../stores/app";

/**
 * Modulation & evolution panel: live mod values, automations, macros and the
 * evolution rules per track, with a feed of evolution events as they fire.
 */
export default function ModPanel() {
  const song = store.song;
  const [values, setValues] = createSignal<Record<string, number>>({});
  const [events, setEvents] = createSignal<EvolveEvent[]>([]);

  onMount(() => {
    engine.mods.subscribe((v) => setValues(v));
    const off = engine.onEvolve((e) => setEvents((list) => [e, ...list].slice(0, 12)));
    onCleanup(off);
  });

  const rules = () => song.tracks.flatMap((t) => t.rules.map((r) => ({ track: t.id, rule: r })));
  const hasContent = () => song.modulations.length + song.automations.length + rules().length + Object.keys(song.macros).length > 0;

  return (
    <section class="panel mods" data-testid="mods">
      <div class="panel-head">
        <h2>Modulation & Evolution</h2>
        <span class="muted">
          {song.modulations.length} mods · {song.automations.length} auto · {rules().length} rules
        </span>
        <div class="spacer" />
        <Show when={song.masterFx.length}>
          <span class="muted tiny">master: {song.masterFx.map((f) => f.type).join(" › ")}</span>
        </Show>
      </div>
      <Show when={hasContent()} fallback={<div class="empty small">No modulation yet. Ask for sidechain, LFO movement, automation across the build, or evolution rules that mutate patterns every few bars.</div>}>
        <div class="mods-body">
          <For each={song.modulations}>
            {(m) => (
              <div class="mod-row">
                <span class="mod-id">{m.id}</span>
                <span class="mod-src">{m.source.type}{m.source.type === "follower" ? `(${m.source.track})` : m.source.type === "lfo" ? `(${m.source.rate})` : ""}</span>
                <span class="mod-arrow">→</span>
                <span class="mod-target">{m.target}</span>
                <span class="mod-value">{values()[m.id] !== undefined ? values()[m.id].toFixed(2) : "—"}</span>
                <div class="mod-bar">
                  <div class="mod-fill" style={{ width: `${Math.round(normalized(values()[m.id], m) * 100)}%` }} />
                </div>
                <button class="chip danger" onClick={() => engine.removeModulation(m.id)} title="Remove">
                  ×
                </button>
              </div>
            )}
          </For>
          <For each={song.automations}>
            {(a) => (
              <div class="mod-row auto">
                <span class="mod-id">{a.id}</span>
                <span class="mod-src">auto</span>
                <span class="mod-arrow">→</span>
                <span class="mod-target">{a.target}</span>
                <span class="mod-value">
                  {a.from} → {a.to} / {a.bars}b
                </span>
                <button class="chip danger" onClick={() => { engine.mods.removeAutomation(a.id); }} title="Remove">
                  ×
                </button>
              </div>
            )}
          </For>
          <For each={Object.entries(song.macros)}>
            {([name, value]) => (
              <div class="mod-row macro">
                <span class="mod-id">{name}</span>
                <span class="mod-src">macro</span>
                <input type="range" min="0" max="1" step="0.01" value={value} onInput={(e) => engine.setMacro(name, Number(e.currentTarget.value))} />
                <span class="mod-value">{value.toFixed(2)}</span>
              </div>
            )}
          </For>
          <For each={rules()}>
            {({ track, rule }) => (
              <div class="mod-row rule">
                <span class="mod-id">{track}</span>
                <span class="mod-src">every {rule.every}b{rule.prob !== undefined && rule.prob < 1 ? ` p${rule.prob}` : ""}</span>
                <span class="mod-target">{rule.ops.map((o) => o.type).join(" · ")}</span>
                <span class="mod-value">×{rule.fired ?? 0}{rule.max_generations ? `/${rule.max_generations}` : ""}</span>
                <button class="chip" onClick={() => engine.applyRule(track, rule)} title="Evolve now">
                  ▸
                </button>
                <button class="chip danger" onClick={() => engine.setEvolution(track, engine.getState().tracks.find((t) => t.id === track)!.rules.filter((r) => r.id !== rule.id))} title="Remove rule">
                  ×
                </button>
              </div>
            )}
          </For>
          <Show when={events().length}>
            <div class="evolve-feed">
              <For each={events()}>{(e) => <span class="evolve-event">bar {e.bar} · {e.trackId} · {e.ops.join(",")}</span>}</For>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}

function normalized(v: number | undefined, m: { offset: number; depth: number; bipolar?: boolean }): number {
  if (v === undefined) return 0.5;
  const lo = m.bipolar ? m.offset - Math.abs(m.depth) : Math.min(m.offset, m.offset + m.depth);
  const hi = m.bipolar ? m.offset + Math.abs(m.depth) : Math.max(m.offset, m.offset + m.depth);
  if (hi === lo) return 0.5;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}
