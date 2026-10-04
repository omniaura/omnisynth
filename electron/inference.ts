import type { ChatRequest, ChatResponse, ModelInfo, ProviderId } from "../shared/ipc";
import { resolveProvider } from "./providers";

/**
 * OpenAI-compatible chat proxy. Runs in the main process so keys stay out of
 * the renderer and CORS never applies. Every provider we support (Ditto
 * Router, OpenRouter, Ollama, coding-agent gateways) speaks /v1/chat/completions.
 */

const inflight = new Map<string, AbortController>();

export function cancelChat(requestId: string): void {
  inflight.get(requestId)?.abort();
  inflight.delete(requestId);
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const provider = await resolveProvider(req.provider);
  const controller = new AbortController();
  if (req.requestId) inflight.set(req.requestId, controller);

  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
  };
  if (req.max_tokens) body.max_tokens = req.max_tokens;
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = req.tool_choice ?? "auto";
    body.parallel_tool_calls = true;
  }
  if (req.response_format) body.response_format = req.response_format;

  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        ...(provider.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        detail = (typeof parsed.error === "object" ? parsed.error?.message : parsed.error) || parsed.message || text;
      } catch {
        /* raw */
      }
      throw new Error(`${req.provider} ${req.model}: HTTP ${res.status} - ${detail.slice(0, 500)}`);
    }
    const data = JSON.parse(text) as {
      id?: string;
      model?: string;
      choices?: Array<{ message: ChatResponse["message"]; finish_reason?: string }>;
      usage?: ChatResponse["usage"];
    };
    const choice = data.choices?.[0];
    if (!choice?.message) throw new Error(`${req.provider} returned no choices`);
    return { id: data.id, model: data.model, message: choice.message, finish_reason: choice.finish_reason, usage: data.usage };
  } finally {
    if (req.requestId) inflight.delete(req.requestId);
  }
}

export async function listModels(providerId: ProviderId): Promise<ModelInfo[]> {
  const provider = await resolveProvider(providerId);
  const res = await fetch(`${provider.baseUrl}/models`, {
    headers: { Accept: "application/json", ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}), ...(provider.headers ?? {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${providerId} /models: HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string; name?: string; architecture?: { input_modalities?: string[] } }> };
  return (data.data ?? []).map((m) => ({ id: m.id, name: m.name, inputModalities: m.architecture?.input_modalities }));
}
