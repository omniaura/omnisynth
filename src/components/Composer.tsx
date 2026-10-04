import { For, Show, createSignal } from "solid-js";
import type { Attachment } from "../../shared/ipc";
import { store } from "../stores/app";
import { bridge } from "../agent/client";
import { cancelRun, runGenerate, resolveModel } from "../lib/run";
import type { Brief } from "../agent/perceive";

/**
 * The prompt composer: text + attachments (images, audio, notes) → Generate.
 * Shows the perceived brief (editable) and the orchestrator's tool-call log.
 */

async function fileToAttachment(file: File): Promise<Attachment | null> {
  const kind: Attachment["kind"] | null = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("text/") || /\.(md|txt|json|lrc)$/i.test(file.name) ? "text" : null;
  if (!kind) return null;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  if (kind === "text") return { id, kind, name: file.name, mime: file.type || "text/plain", data: await file.text(), size: file.size };
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { id, kind, name: file.name, mime: file.type || (kind === "image" ? "image/png" : "audio/wav"), data: btoa(bin), size: file.size };
}

function AttachmentChip(props: { a: Attachment; onRemove: () => void }) {
  return (
    <div class={`attachment ${props.a.kind}`} title={`${props.a.name} · ${(props.a.size / 1024).toFixed(0)} KB`}>
      <Show when={props.a.kind === "image"} fallback={<span class="attachment-icon">{props.a.kind === "audio" ? "♫" : "¶"}</span>}>
        <img src={`data:${props.a.mime};base64,${props.a.data}`} alt="" />
      </Show>
      <span class="attachment-name">{props.a.name}</span>
      <button onClick={props.onRemove} title="Remove">
        ×
      </button>
    </div>
  );
}

function BriefCard(props: { brief: Brief }) {
  const [open, setOpen] = createSignal(true);
  const b = () => props.brief;
  const update = (patch: Partial<Brief>) => store.setBrief({ ...b(), ...patch });
  return (
    <div class="brief" data-testid="brief">
      <button class="brief-head" onClick={() => setOpen(!open())}>
        <span class="brief-title">{b().title}</span>
        <span class="muted">
          {b().bpm} BPM · {b().key} {b().scale}
        </span>
        <span class="muted">{open() ? "▾" : "▸"}</span>
      </button>
      <Show when={open()}>
        <div class="brief-body">
          <div class="chips">
            <For each={[...b().mood, ...b().genre]}>{(m) => <span class="chip tag">{m}</span>}</For>
          </div>
          <label>
            <span>Energy</span>
            <input value={b().energy_curve} onChange={(e) => update({ energy_curve: e.currentTarget.value })} />
          </label>
          <label>
            <span>Rhythm</span>
            <input value={b().rhythm} onChange={(e) => update({ rhythm: e.currentTarget.value })} />
          </label>
          <label>
            <span>Palette</span>
            <input value={b().sound_palette.join("; ")} onChange={(e) => update({ sound_palette: e.currentTarget.value.split(";").map((s) => s.trim()).filter(Boolean) })} />
          </label>
          <div class="swatches">
            <For each={b().visual_palette}>{(c) => <span class="swatch" style={{ background: /^#|^rgb|^hsl/.test(c) ? c : undefined }} title={c}>{/^#|^rgb|^hsl/.test(c) ? "" : c}</span>}</For>
          </div>
          <button class="btn-ghost small" onClick={() => store.setBrief(null)}>
            Discard brief
          </button>
        </div>
      </Show>
    </div>
  );
}

export default function Composer() {
  const [dragging, setDragging] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  let logEl: HTMLDivElement | undefined;

  async function pick(): Promise<void> {
    const b = bridge();
    if (b) {
      const picked = await b.files.pick(["image", "audio", "text"]);
      store.setAttachments([...store.attachments(), ...picked]);
    } else fileInput?.click();
  }

  async function onFiles(files: FileList | File[]): Promise<void> {
    try {
      const list = Array.from(files);
      const paths = list.map((f) => (f as File & { path?: string }).path).filter((p): p is string => Boolean(p));
      const b = bridge();
      let added: Attachment[] = [];
      if (b && paths.length === list.length) added = await b.files.readPaths(paths);
      else added = (await Promise.all(list.map(fileToAttachment))).filter((a): a is Attachment => a !== null);
      if (added.length < list.length) store.showToast("Some files were skipped (images, audio and text only)");
      store.setAttachments([...store.attachments(), ...added]);
    } catch (err) {
      store.showToast(`Could not attach files: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) void onFiles(e.dataTransfer.files);
  }

  function onKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void runGenerate();
    }
  }

  const busy = () => store.running() !== "idle";
  const orchestrator = () => resolveModel("orchestrate");
  const perceiver = () => resolveModel("perceive");

  return (
    <aside class={`panel composer ${dragging() ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} data-testid="composer">
      <div class="panel-head">
        <h2>Compose</h2>
        <span class="muted">multisensory prompt</span>
        <div class="spacer" />
        <button class="btn-ghost small" onClick={() => store.setComposerOpen(false)} title="Hide">
          ›
        </button>
      </div>

      <textarea
        class="prompt"
        placeholder="Describe the track. Reference artists, textures, structure… Attach images for mood and palette, a song for tempo/groove/timbre, lyrics or notes for constraints."
        value={store.prompt()}
        onInput={(e) => store.setPrompt(e.currentTarget.value)}
        onKeyDown={onKey}
        rows="5"
        data-testid="prompt"
      />

      <div class="attachments">
        <For each={store.attachments()}>{(a) => <AttachmentChip a={a} onRemove={() => store.setAttachments(store.attachments().filter((x) => x.id !== a.id))} />}</For>
        <button class="attach-btn" onClick={() => void pick()} title="Attach images, audio or text" data-testid="attach">
          + Attach
        </button>
        <input ref={fileInput} type="file" multiple accept="image/*,audio/*,.txt,.md,.json,.lrc" style={{ display: "none" }} onChange={(e) => e.currentTarget.files && void onFiles(e.currentTarget.files)} />
      </div>

      <div class="run-row">
        <Show when={!busy()} fallback={
          <button class="btn-danger" onClick={cancelRun} data-testid="cancel">
            Stop
          </button>
        }>
          <button class="btn-primary" onClick={() => void runGenerate()} data-testid="generate">
            Generate <kbd>⌘↵</kbd>
          </button>
        </Show>
        <div class="run-models muted" title="Perceive → Orchestrate models (change in Settings)">
          <span>{store.settings.skipPerceive ? "perceive off" : perceiver().model || perceiver().provider}</span>
          <span>→</span>
          <span>{orchestrator().model || orchestrator().provider}</span>
        </div>
      </div>

      <Show when={store.status()}>
        <div class="status-line" data-testid="status">
          <span class="spinner" />
          {store.status()}
        </div>
      </Show>

      <Show when={store.brief()}>{(b) => <BriefCard brief={b()} />}</Show>

      <div class="log" ref={logEl} data-testid="log">
        <For each={store.log()}>
          {(e) => {
            queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }));
            return (
              <div class={`log-entry ${e.type} ${e.ok === false ? "fail" : ""}`}>
                <Show when={e.type === "tool_call"}>
                  <span class="log-tool">{e.text}</span>
                </Show>
                <Show when={e.type === "tool_result"}>
                  <span class="log-result">{e.text}</span>
                </Show>
                <Show when={e.type === "assistant" || e.type === "done"}>
                  <span class="log-assistant">{e.text}</span>
                </Show>
                <Show when={e.type === "error"}>
                  <span class="log-error">{e.text}</span>
                </Show>
                <Show when={e.type === "status"}>
                  <span class="log-status">{e.text}</span>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </aside>
  );
}
