import { createRunHandle, orchestrate, DEFAULT_ORCHESTRATE_MODEL, type RunHandle } from "../agent/orchestrate";
import { perceive, DEFAULT_PERCEIVE_MODEL } from "../agent/perceive";
import { detectProviders } from "../agent/client";
import { engine } from "../engine/engine";
import { store } from "../stores/app";
import { toolContext } from "./songs";

/**
 * Drives one "generate" run: Perceive (optional) → Orchestrate, writing
 * progress into the store. Also owns provider refresh and model defaults.
 */

let activeHandle: RunHandle | null = null;

export async function refreshProviders(): Promise<void> {
  const list = await detectProviders();
  store.setProviders(list);
  // First launch: pick the first authenticated provider for both stages.
  const auth = list.filter((p) => p.authenticated);
  const s = store.settings;
  const valid = (id: string) => auth.some((p) => p.id === id);
  if (auth.length && (!valid(s.orchestrateProvider) || !valid(s.perceiveProvider))) {
    const pick = auth.find((p) => p.id === "ditto") ?? auth.find((p) => p.id === "openrouter") ?? auth[0];
    store.updateSettings({
      orchestrateProvider: valid(s.orchestrateProvider) ? s.orchestrateProvider : pick.id,
      perceiveProvider: valid(s.perceiveProvider) ? s.perceiveProvider : pick.id,
    });
  }
}

export function resolveModel(stage: "perceive" | "orchestrate"): { provider: string; model: string } {
  const s = store.settings;
  const providerId = stage === "perceive" ? s.perceiveProvider : s.orchestrateProvider;
  const explicit = stage === "perceive" ? s.perceiveModel : s.orchestrateModel;
  const info = store.providers().find((p) => p.id === providerId);
  const table = stage === "perceive" ? DEFAULT_PERCEIVE_MODEL : DEFAULT_ORCHESTRATE_MODEL;
  // Ditto Router endpoints are pinned to a model server-side; the model name can be anything.
  const fallback = table[providerId] || info?.defaultModel || (providerId === "ditto" ? "default" : "");
  return { provider: providerId, model: explicit || fallback };
}

export function cancelRun(): void {
  activeHandle?.cancel();
}

export async function runGenerate(): Promise<void> {
  if (store.running() !== "idle") return;
  const prompt = store.prompt();
  const attachments = store.attachments();
  if (!prompt.trim() && attachments.length === 0) {
    store.showToast("Type a prompt or attach something first");
    return;
  }
  await engine.init();
  store.clearLog();
  const handle = createRunHandle();
  activeHandle = handle;

  try {
    let brief = store.brief();
    const wantsPerceive = !store.settings.skipPerceive && (attachments.length > 0 || !brief);
    if (wantsPerceive) {
      store.setRunning("perceiving");
      const { provider, model } = resolveModel("perceive");
      store.pushLog({ type: "status", text: `Perceiving with ${model || provider}…` });
      brief = await perceive({ provider: provider as never, model, prompt, attachments, signal: handle });
      store.setBrief(brief);
      store.pushLog({ type: "assistant", text: `Brief: ${brief.title} — ${brief.bpm} BPM, ${brief.key} ${brief.scale}; ${brief.mood.slice(0, 3).join(", ")}` });
      if (handle.cancelled) return;
    }

    store.setRunning("orchestrating");
    const { provider, model } = resolveModel("orchestrate");
    store.pushLog({ type: "status", text: `Producing with ${model || provider}…` });
    const summary = await orchestrate({ provider: provider as never, model, prompt, brief, ctx: toolContext, onEvent: store.pushLog, handle });
    store.setStatus("");
    store.showToast(summary.length > 160 ? `${summary.slice(0, 160)}…` : summary);
    if (!engine.isPlaying && engine.tracks.size > 0) await engine.play();
  } catch (err) {
    const msg = (err as Error).message;
    if (msg !== "cancelled") {
      store.pushLog({ type: "error", text: msg });
      store.showToast(msg.length > 200 ? `${msg.slice(0, 200)}…` : msg);
    } else {
      store.pushLog({ type: "status", text: "Cancelled." });
    }
  } finally {
    store.setRunning("idle");
    store.setStatus("");
    activeHandle = null;
  }
}
