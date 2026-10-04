import { createRunHandle, orchestrate, DEFAULT_ORCHESTRATE_MODEL, type RunHandle } from "../agent/orchestrate";
import { perceive, DEFAULT_PERCEIVE_MODEL } from "../agent/perceive";
import { bridge, detectProviders } from "../agent/client";
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
  // Until the user picks a provider explicitly, follow a preference order so
  // a better option (Ditto, OpenRouter) wins over whatever happened to be
  // detected first (e.g. Ollama).
  const auth = list.filter((p) => p.authenticated);
  const s = store.settings;
  const valid = (id: string) => auth.some((p) => p.id === id);
  if (!auth.length) return;
  const order: string[] = ["ditto", "openrouter", "claude-code", "codex", "opencode", "ollama", "custom"];
  const preferred = order.map((id) => auth.find((p) => p.id === id)).find(Boolean) ?? auth[0];
  if (s.autoProvider) {
    if (s.orchestrateProvider !== preferred.id || s.perceiveProvider !== preferred.id) {
      store.updateSettings({ orchestrateProvider: preferred.id, perceiveProvider: preferred.id, orchestrateModel: "", perceiveModel: "" });
    }
  } else if (!valid(s.orchestrateProvider) || !valid(s.perceiveProvider)) {
    store.updateSettings({
      orchestrateProvider: valid(s.orchestrateProvider) ? s.orchestrateProvider : preferred.id,
      perceiveProvider: valid(s.perceiveProvider) ? s.perceiveProvider : preferred.id,
    });
  }
}

/** Budget tiers: how much the run may spend. The router balance is read live and clamps the tier down. */
const TIERS = {
  frugal: { ditto: { perceive: "z-ai/glm-5.3-flash", orchestrate: "z-ai/glm-5.3-flash" }, openrouter: { perceive: "google/gemini-3.5-flash-lite", orchestrate: "google/gemini-3.5-flash-lite" }, maxTurns: 14 },
  balanced: { ditto: { perceive: "anthropic/claude-sonnet-5.5", orchestrate: "anthropic/claude-sonnet-5.5" }, openrouter: { perceive: "google/gemini-3.5-flash-lite", orchestrate: "typesafe/jev-router" }, maxTurns: 40 },
  lavish: { ditto: { perceive: "anthropic/claude-sonnet-5.5", orchestrate: "anthropic/claude-opus-5.5" }, openrouter: { perceive: "google/gemini-3.8-flash", orchestrate: "typesafe/jev-router" }, maxTurns: 60 },
} as const;
type Tier = keyof typeof TIERS;

/** Clamp the chosen tier by what the signed-in Ditto account can actually pay for. */
export function effectiveTier(balance: number | null | undefined): Tier {
  const wanted = store.settings.budget;
  if (balance === null || balance === undefined) return wanted;
  if (balance < 1) return "frugal";
  if (balance < 5 && wanted === "lavish") return "balanced";
  return wanted;
}

export function resolveModel(stage: "perceive" | "orchestrate", tier: Tier = store.settings.budget): { provider: string; model: string; maxTurns: number } {
  const s = store.settings;
  const providerId = stage === "perceive" ? s.perceiveProvider : s.orchestrateProvider;
  const explicit = stage === "perceive" ? s.perceiveModel : s.orchestrateModel;
  const info = store.providers().find((p) => p.id === providerId);
  const table = stage === "perceive" ? DEFAULT_PERCEIVE_MODEL : DEFAULT_ORCHESTRATE_MODEL;
  const tiered = (TIERS[tier] as Record<string, { perceive: string; orchestrate: string } | number>)[providerId];
  const tierModel = tiered && typeof tiered === "object" ? tiered[stage] : "";
  // Ditto Router endpoints are pinned to a model server-side; the model name can be anything.
  const fallback = tierModel || table[providerId] || info?.defaultModel || (providerId === "ditto" ? "default" : "");
  return { provider: providerId, model: explicit || fallback, maxTurns: TIERS[tier].maxTurns };
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
    // Credit-aware: read the router balance and clamp the budget tier before spending.
    const credits = await bridge()?.ditto.credits().catch(() => null);
    const tier = effectiveTier(credits?.balance);
    store.setCredits(credits ?? null);
    if (tier !== store.settings.budget) store.pushLog({ type: "status", text: `Balance ${credits?.balance?.toFixed(2)} ${credits?.currency ?? ""} — running ${tier} instead of ${store.settings.budget}` });

    let brief = store.brief();
    const wantsPerceive = !store.settings.skipPerceive && (attachments.length > 0 || !brief);
    if (wantsPerceive) {
      store.setRunning("perceiving");
      const { provider, model } = resolveModel("perceive", tier);
      store.pushLog({ type: "status", text: `Perceiving with ${model || provider}…` });
      brief = await perceive({ provider: provider as never, model, prompt, attachments, signal: handle });
      store.setBrief(brief);
      store.pushLog({ type: "assistant", text: `Brief: ${brief.title} — ${brief.bpm} BPM, ${brief.key} ${brief.scale}; ${brief.mood.slice(0, 3).join(", ")}` });
      if (handle.cancelled) return;
    }

    store.setRunning("orchestrating");
    const { provider, model, maxTurns } = resolveModel("orchestrate", tier);
    store.pushLog({ type: "status", text: `Producing with ${model || provider} (${tier})…` });
    const summary = await orchestrate({ provider: provider as never, model, prompt, brief, ctx: toolContext, onEvent: store.pushLog, handle, maxTurns });
    void bridge()?.ditto.credits().then((c) => store.setCredits(c)).catch(() => undefined);
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
