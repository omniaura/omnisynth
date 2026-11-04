import { initStrudel, evaluate, hush, getAudioContext, getAnalyserById } from "@strudel/web";

type Pattern = { analyze(id: number): Pattern; queryArc(start: number, end: number): unknown[] };
let error: string | null = null;
let playing = false;
let generation = 0;
let events = 0;
let ready = false;
const message = (value: Record<string, unknown>) => parent.postMessage({ channel: "omnisynth-strudel", operation: generation, ...value }, "*");
const state = () => ({ playing, error, events, audioContext: getAudioContext().state });
const initialization = initStrudel({
  editPattern: (pattern: Pattern) => pattern.analyze(1),
  beforeStart: () => getAudioContext().resume(),
  onToggle: (value: boolean) => { playing = value; },
  onUpdateState: (value: { error?: Error }) => { error = value.error?.message ?? null; },
  onEvalError: (value: Error) => { error = value.message; },
}).then(() => { ready = true; message({ type: "ready" }); });

window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.data?.channel !== "omnisynth-strudel") return;
  const { id, action, code, operation } = event.data;
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(operation)) return;
  if (operation < generation) { message({ type: "reply", id, ok: false, error: "Superseded command." }); return; }
  generation = operation;
  const ticket = operation;
  try {
    await initialization;
    if (action === "stop") { hush(); playing = false; }
    else if (action === "evaluate") {
      if (typeof code !== "string" || !code.trim() || code.length > 32000) throw new Error("Use 1–32,000 characters of Strudel code.");
      if (ticket !== generation) throw new Error("Superseded by a newer transport command.");
      error = null;
      await getAudioContext().resume();
      const pattern = await evaluate(code, true) as Pattern | undefined;
      if (ticket !== generation) { hush(); playing = false; message({ type: "reply", id, ok: false, error: "Superseded by a newer transport command." }); return; }
      if (error || !pattern) { hush(); playing = false; throw new Error(error || "Code did not produce a Strudel pattern."); }
      events = pattern.queryArc(0, 1).length;
    } else throw new Error("Unknown Strudel action.");
    message({ type: "reply", id, ok: true, state: state() });
  } catch (value) {
    error = value instanceof Error ? value.message : String(value);
    message({ type: "reply", id, ok: false, error, state: ready ? state() : undefined });
  }
});

const samples = new Float32Array(1024);
const spectrum = new Uint8Array(512);
setInterval(() => {
  if (!ready) return;
  const node = getAnalyserById(1, 1024);
  node.getFloatTimeDomainData(samples);
  node.getByteFrequencyData(spectrum);
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const bands = [[1, 6], [6, 24], [24, 80], [80, 200]].map(([lo, hi]) => {
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += spectrum[i];
    return sum / (hi - lo) / 255;
  });
  message({ type: "meter", rms: Math.sqrt(energy / samples.length), bands, ...state() });
}, 100);
