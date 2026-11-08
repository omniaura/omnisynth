import { createSignal } from "solid-js";
import { bridge } from "../agent/client";
import { engine } from "./engine";

export const DEFAULT_STRUDEL = `setcpm(120/4)
stack(
  s("sbd*4").gain(0.55),
  s("white*8").hpf(6500).decay(0.03).sustain(0).gain(0.12),
  note("<c2 eb2 f2 bb1>").s("sawtooth").lpf(700).decay(0.2).sustain(0).gain(0.2),
  note("c4 [eb4 g4] bb4 g4").s("sine").slow(2).room(0.3).gain(0.2)
)`;
const [code, setCodeSignal] = createSignal(localStorage.getItem("omnisynth.strudel.code") ?? DEFAULT_STRUDEL);
const [selected, setSelected] = createSignal<"tone" | "strudel">(localStorage.getItem("omnisynth.music-engine") === "strudel" ? "strudel" : "tone");
const [status, setStatus] = createSignal({ playing: false, error: null as string | null, events: 0, rms: 0, bands: [0, 0, 0, 0], audioContext: "uninitialized" });
let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let origin = "";
let nextID = 0;
let revision = 0;
let removeListener = () => {};
const pending = new Map<number, { operation: number; resolve: (state: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function update(value: Record<string, unknown>): void {
  setStatus((previous) => ({
    ...previous,
    playing: typeof value.playing === "boolean" ? value.playing : previous.playing,
    error: value.error === null ? null : typeof value.error === "string" ? value.error.slice(0, 2000) : previous.error,
    events: typeof value.events === "number" ? value.events : previous.events,
    audioContext: typeof value.audioContext === "string" ? value.audioContext : previous.audioContext,
    rms: typeof value.rms === "number" && Number.isFinite(value.rms) ? Math.max(0, Math.min(1, value.rms)) : previous.rms,
    bands: Array.isArray(value.bands) && value.bands.length === 4 && value.bands.every((v) => typeof v === "number" && Number.isFinite(v))
      ? value.bands.map((v: number) => Math.max(0, Math.min(1, v))) : previous.bands,
  }));
}

async function initialize(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const info = await bridge()?.bridge.info();
    if (!info?.port) throw new Error("Strudel needs the OmniSynth desktop bridge.");
    const url = `http://127.0.0.1:${info.port}/strudel/index.html`;
    origin = new URL(url).origin;
    frame = document.createElement("iframe");
    frame.title = "Isolated Strudel audio engine";
    frame.sandbox.add("allow-scripts", "allow-same-origin");
    frame.allow = "autoplay";
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;border:0";
    frame.setAttribute("aria-hidden", "true");
    const iframe = frame;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Strudel engine did not initialize.")); }, 15000);
      const receive = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.origin !== origin || event.data?.channel !== "omnisynth-strudel") return;
        const data = event.data;
        if (data.type === "ready") { clearTimeout(timer); resolve(); return; }
        if (data.type === "meter") { if (data.operation === revision) update(data); return; }
        if (data.type !== "reply") return;
        const call = pending.get(data.id);
        if (!call) return;
        clearTimeout(call.timer);
        pending.delete(data.id);
        if (data.state && call.operation === revision) update(data.state);
        if (data.ok === true) call.resolve(data.state);
        else call.reject(new Error(typeof data.error === "string" ? data.error : "Strudel evaluation failed."));
      };
      window.addEventListener("message", receive);
      removeListener = () => window.removeEventListener("message", receive);
      iframe.src = url;
      document.body.append(iframe);
    });
  })();
  try { await ready; }
  catch (error) { removeListener(); frame?.remove(); frame = null; ready = null; throw error; }
}

function resetFrame(ownedFrame: HTMLIFrameElement | null, operation: number, reason: Error): void {
  if (!ownedFrame || frame !== ownedFrame || revision !== operation) return;
  for (const call of pending.values()) {
    clearTimeout(call.timer);
    call.reject(reason);
  }
  pending.clear();
  removeListener();
  ownedFrame.remove();
  frame = null;
  ready = null;
  setStatus((state) => ({ ...state, playing: false, rms: 0, bands: [0, 0, 0, 0] }));
}

async function request(action: "evaluate" | "stop", source?: string, operation = revision): Promise<unknown> {
  await initialize();
  if (operation !== revision) throw new Error("Superseded by a newer transport command.");
  const id = ++nextID;
  const ownedFrame = frame!;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const error = new Error("Strudel command timed out.");
      // Destroy the current frame's pending queue as well as its audio context.
      // A timed-out older request must not reset a newer operation's frame.
      resetFrame(ownedFrame, operation, error);
      reject(error);
    }, action === "stop" ? 2000 : 15000);
    pending.set(id, { operation, resolve, reject, timer });
    ownedFrame.contentWindow!.postMessage({ channel: "omnisynth-strudel", id, operation, action, code: source }, origin);
  });
}

export function setStrudelCode(value: string): void {
  if (value.length > 32000) throw new Error("Strudel code exceeds 32,000 characters.");
  setCodeSignal(value);
  localStorage.setItem("omnisynth.strudel.code", value);
}
export async function stopStrudel(): Promise<void> {
  const ticket = ++revision;
  const ownedFrame = frame;
  if (frame) {
    try { await request("stop", undefined, ticket); }
    catch {
      resetFrame(ownedFrame, ticket, new Error("Strudel frame was reset."));
    }
  }
  if (revision === ticket) setStatus((state) => ({ ...state, playing: false, rms: 0, bands: [0, 0, 0, 0] }));
}
export async function evaluateStrudel(value = code()): Promise<string> {
  setStrudelCode(value);
  const ticket = ++revision;
  engine.stop();
  setSelected("strudel");
  localStorage.setItem("omnisynth.music-engine", "strudel");
  try {
    await initialize();
    if (ticket !== revision) throw new Error("Strudel evaluation was cancelled.");
    await request("evaluate", value, ticket);
    if (ticket !== revision) throw new Error("Strudel evaluation was cancelled.");
    setStatus((state) => ({ ...state, error: null }));
    return JSON.stringify({ engine: "strudel", ...status(), code: code() });
  } catch (value) {
    const error = value instanceof Error ? value : new Error(String(value));
    if (ticket === revision) setStatus((state) => ({ ...state, error: error.message }));
    throw error;
  }
}
export async function selectEngine(value: "tone" | "strudel"): Promise<void> {
  engine.stop();
  const ticket = revision + 1;
  await stopStrudel();
  if (revision === ticket) { setSelected(value); localStorage.setItem("omnisynth.music-engine", value); }
}
export async function playSelected(): Promise<void> {
  if (selected() === "strudel") { await evaluateStrudel(); return; }
  const ticket = revision + 1;
  await stopStrudel();
  if (revision !== ticket || selected() !== "tone") return;
  await engine.play();
  if (revision !== ticket || selected() !== "tone") engine.stop();
}
export async function stopAll(): Promise<void> { engine.stop(); await stopStrudel(); }
export const strudel = { code, selected, status, setCode: setStrudelCode, evaluate: evaluateStrudel, stop: stopAll, play: playSelected, select: selectEngine };
