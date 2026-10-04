import type { ChatRequest, ChatResponse, ModelInfo, OmniSynthBridge, ProviderId, ProviderInfo } from "../../shared/ipc";

/**
 * Thin wrapper over the desktop bridge. In Electron every call goes through
 * the main process; in a plain browser (vite dev without electron) we fall
 * back to direct fetch so the UI still works for quick iteration.
 */

export function bridge(): OmniSynthBridge | undefined {
  return window.omnisynth;
}

export function isDesktop(): boolean {
  return Boolean(window.omnisynth);
}

const BROWSER_BASES: Partial<Record<ProviderId, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  ditto: "https://router.heyditto.ai/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

function browserKey(provider: ProviderId): string {
  return localStorage.getItem(`omnisynth.browserKey.${provider}`) ?? "";
}

export async function detectProviders(): Promise<ProviderInfo[]> {
  const b = bridge();
  if (b) return b.providers.detect();
  return (Object.keys(BROWSER_BASES) as ProviderId[]).map((id) => ({
    id,
    label: id,
    baseUrl: BROWSER_BASES[id]!,
    authenticated: Boolean(browserKey(id)) || id === "ollama",
    note: "browser mode: key stored in localStorage",
  }));
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const b = bridge();
  if (b) return b.inference.chat(req);
  const base = BROWSER_BASES[req.provider];
  if (!base) throw new Error(`provider ${req.provider} unavailable in browser mode`);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${browserKey(req.provider) || "ollama"}` },
    body: JSON.stringify({ model: req.model, messages: req.messages, tools: req.tools, tool_choice: req.tools ? (req.tool_choice ?? "auto") : undefined, temperature: req.temperature ?? 0.7, response_format: req.response_format }),
  });
  if (!res.ok) throw new Error(`${req.provider}: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: ChatResponse["message"]; finish_reason?: string }> };
  return { message: data.choices[0].message, finish_reason: data.choices[0].finish_reason };
}

export async function cancelChat(requestId: string): Promise<void> {
  await bridge()?.inference.cancel(requestId);
}

export async function listModels(provider: ProviderId): Promise<ModelInfo[]> {
  const b = bridge();
  if (b) return b.inference.models(provider);
  return [];
}

export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
