import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ProviderId, ProviderInfo } from "../shared/ipc";
import { getSecret } from "./secrets";
import { dittoRouterBaseUrl, readDittoSession } from "./ditto";

export const DITTO_ROUTER_URL = "https://router.heyditto.ai/v1";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1";
export const OLLAMA_URL = "http://127.0.0.1:11434/v1";

/** Resolved credentials for a provider: where to send requests and how to sign them. */
export interface ResolvedProvider {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Reads a TOML-ish `key = "value"` from a small config file without a parser dependency. */
function readTomlString(path: string, key: string): string | undefined {
  try {
    const m = readFileSync(path, "utf-8").match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
    return m?.[1];
  } catch {
    return undefined;
  }
}

function which(bin: string): boolean {
  try {
    execFileSync("/usr/bin/which", [bin], { stdio: "ignore", env: loginEnv(), timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

let cachedLoginEnv: NodeJS.ProcessEnv | undefined;
/**
 * A packaged macOS app launched from Finder inherits a minimal environment, so
 * read the user's login shell once to find things like nvm/bun bins and the
 * ANTHROPIC_* variables Claude Code is configured with.
 */
export function loginEnv(): NodeJS.ProcessEnv {
  if (cachedLoginEnv) return cachedLoginEnv;
  cachedLoginEnv = { ...process.env };
  if (process.platform !== "darwin" && process.platform !== "linux") return cachedLoginEnv;
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shell, ["-ilc", "env"], { encoding: "utf-8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) cachedLoginEnv[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch {
    /* fall back to the inherited env */
  }
  return cachedLoginEnv;
}

function claudeCodeProvider(): ProviderInfo {
  const env = loginEnv();
  const settings = readJson(join(homedir(), ".claude", "settings.json"));
  const settingsEnv = (settings?.env as Record<string, string> | undefined) ?? {};
  const baseUrl = env.ANTHROPIC_BASE_URL || settingsEnv.ANTHROPIC_BASE_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN || settingsEnv.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  const installed = which("claude");
  if (!installed) {
    return { id: "claude-code", label: "Claude Code", baseUrl: "", authenticated: false, note: "claude CLI not found" };
  }
  if (!baseUrl || !token) {
    return {
      id: "claude-code",
      label: "Claude Code",
      baseUrl: "",
      authenticated: false,
      note: "Claude Code is installed but not configured with an OpenAI-compatible gateway (ANTHROPIC_BASE_URL)",
    };
  }
  const url = baseUrl.replace(/\/+$/, "");
  return {
    id: "claude-code",
    label: "Claude Code's gateway",
    baseUrl: url.endsWith("/v1") ? url : `${url}/v1`,
    authenticated: true,
    source: "ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN",
    defaultModel: env.ANTHROPIC_MODEL || settingsEnv.ANTHROPIC_MODEL || "",
  };
}

function codexProvider(): ProviderInfo {
  const cfg = join(homedir(), ".codex", "config.toml");
  if (!which("codex") && !existsSync(cfg)) {
    return { id: "codex", label: "Codex", baseUrl: "", authenticated: false, note: "codex CLI not found" };
  }
  const baseUrl = readTomlString(cfg, "base_url");
  const envKeyName = readTomlString(cfg, "env_key") || "OPENAI_API_KEY";
  const key = loginEnv()[envKeyName];
  const model = readTomlString(cfg, "model");
  if (!baseUrl || !key) {
    return { id: "codex", label: "Codex", baseUrl: "", authenticated: false, note: "Codex found but no OpenAI-compatible provider configured" };
  }
  return { id: "codex", label: "Codex's provider", baseUrl: baseUrl.replace(/\/+$/, ""), authenticated: true, source: cfg, defaultModel: model };
}

function opencodeProvider(): ProviderInfo {
  const auth = readJson(join(homedir(), ".local", "share", "opencode", "auth.json"));
  if (!which("opencode") && !auth) {
    return { id: "opencode", label: "OpenCode", baseUrl: "", authenticated: false, note: "opencode CLI not found" };
  }
  const or = auth?.openrouter as { key?: string } | undefined;
  if (or?.key) {
    return { id: "opencode", label: "OpenCode (OpenRouter key)", baseUrl: OPENROUTER_URL, authenticated: true, source: "~/.local/share/opencode/auth.json" };
  }
  return { id: "opencode", label: "OpenCode", baseUrl: "", authenticated: false, note: "OpenCode found but no OpenAI-compatible key stored" };
}

async function ollamaProvider(): Promise<ProviderInfo> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      // Skip embedding-only models; prefer something that can follow tool-calling prompts.
      const names = (body.models ?? []).map((m) => m.name).filter((n) => !/embed|bge|minilm|nomic/i.test(n));
      const first = names.find((n) => /qwen|llama3|mistral|gemma3|gpt-oss|command/i.test(n)) ?? names[0];
      return { id: "ollama", label: "Ollama (local)", baseUrl: OLLAMA_URL, authenticated: true, source: "localhost:11434", defaultModel: first };
    }
  } catch {
    /* not running */
  }
  return { id: "ollama", label: "Ollama (local)", baseUrl: OLLAMA_URL, authenticated: false, note: which("ollama") ? "Ollama installed but not running" : "Ollama not installed" };
}

function dittoProvider(): ProviderInfo {
  const session = readDittoSession();
  if (session.endpointKey) {
    return {
      id: "ditto",
      label: `Ditto Router (${session.endpoint?.slug ?? "endpoint"})`,
      baseUrl: dittoRouterBaseUrl(),
      authenticated: true,
      source: session.source === "cli" ? "heyditto CLI login" : "Signed in with Ditto",
      defaultModel: session.endpoint?.model,
    };
  }
  // Claude Code pointed at Ditto Router counts as a Ditto credential too.
  const env = loginEnv();
  if (env.ANTHROPIC_BASE_URL?.includes("router.heyditto.ai") && env.ANTHROPIC_AUTH_TOKEN) {
    return {
      id: "ditto",
      label: "Ditto Router (Claude Code key)",
      baseUrl: DITTO_ROUTER_URL,
      authenticated: true,
      source: "ANTHROPIC_AUTH_TOKEN",
      defaultModel: env.ANTHROPIC_MODEL,
    };
  }
  return {
    id: "ditto",
    label: "Ditto Router",
    baseUrl: DITTO_ROUTER_URL,
    authenticated: false,
    note: session.loggedIn ? "Signed in — create an endpoint to start" : "Sign in with Ditto to use your account's inference",
  };
}

function openrouterProvider(): ProviderInfo {
  const key = getSecret("openrouter") || loginEnv().OPENROUTER_API_KEY;
  return {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: OPENROUTER_URL,
    authenticated: Boolean(key),
    source: getSecret("openrouter") ? "stored key" : key ? "OPENROUTER_API_KEY" : undefined,
    defaultModel: "typesafe/jev-router",
    note: key ? undefined : "Add an OpenRouter key to use Jev",
  };
}

function customProvider(): ProviderInfo {
  const baseUrl = getSecret("custom.baseUrl");
  return {
    id: "custom",
    label: "Custom OpenAI-compatible",
    baseUrl: baseUrl ?? "",
    authenticated: Boolean(baseUrl),
    defaultModel: getSecret("custom.model"),
  };
}

export async function detectProviders(): Promise<ProviderInfo[]> {
  const [ollama] = await Promise.all([ollamaProvider()]);
  return [dittoProvider(), openrouterProvider(), claudeCodeProvider(), codexProvider(), opencodeProvider(), ollama, customProvider()];
}

export async function resolveProvider(id: ProviderId): Promise<ResolvedProvider> {
  const infos = await detectProviders();
  const info = infos.find((p) => p.id === id);
  if (!info?.authenticated) throw new Error(`${info?.label ?? id} is not configured: ${info?.note ?? "no credentials"}`);
  const env = loginEnv();
  switch (id) {
    case "ditto": {
      const session = readDittoSession();
      const key = session.endpointKey || env.ANTHROPIC_AUTH_TOKEN;
      return { baseUrl: info.baseUrl, apiKey: key };
    }
    case "openrouter":
      return {
        baseUrl: info.baseUrl,
        apiKey: getSecret("openrouter") || env.OPENROUTER_API_KEY,
        headers: { "HTTP-Referer": "https://github.com/omniaura/omnisynth", "X-Title": "OmniSynth" },
      };
    case "claude-code":
      return { baseUrl: info.baseUrl, apiKey: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY };
    case "codex": {
      const cfg = join(homedir(), ".codex", "config.toml");
      const envKeyName = readTomlString(cfg, "env_key") || "OPENAI_API_KEY";
      return { baseUrl: info.baseUrl, apiKey: env[envKeyName] };
    }
    case "opencode": {
      const auth = readJson(join(homedir(), ".local", "share", "opencode", "auth.json"));
      return { baseUrl: info.baseUrl, apiKey: (auth?.openrouter as { key?: string } | undefined)?.key };
    }
    case "ollama":
      return { baseUrl: info.baseUrl, apiKey: "ollama" };
    case "custom":
      return { baseUrl: info.baseUrl, apiKey: getSecret("custom.key") };
  }
}
