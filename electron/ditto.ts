import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { CreditSnapshot, DittoDeviceCode, DittoEndpoint, DittoStatus } from "../shared/ipc";
import { deleteSecret, getSecret, setSecret } from "./secrets";
import { detectDittoDesktop } from "./ditto-desktop";

/**
 * "Sign in with Ditto": the same browser device flow the heyditto CLI uses,
 * plus endpoint/key provisioning against the Ditto management API, so the app
 * can route inference through the user's own Ditto Router endpoint.
 */

const API_BASE = (process.env.DITTO_API_BASE || "https://api.heyditto.ai").replace(/\/+$/, "");
const ROUTER_BASE = (process.env.DITTO_ROUTER_BASE || "https://router.heyditto.ai").replace(/\/+$/, "");
const DEVICE_CLIENT = "omnisynth";
const ENDPOINT_SLUG_PREFIX = "omnisynth";
/** Model the OmniSynth endpoint is pinned to by default; passthrough mode lets the app pick per stage. */
export const DEFAULT_ENDPOINT_MODEL = "anthropic/claude-sonnet-5.5";

const SECRET_ACCOUNT_KEY = "ditto.accountKey";
const SECRET_ENDPOINT_KEY = "ditto.endpointKey";
const SECRET_ENDPOINT = "ditto.endpoint";

export function dittoRouterBaseUrl(): string {
  return `${ROUTER_BASE}/v1`;
}

interface Session {
  loggedIn: boolean;
  source?: "app" | "cli" | "env" | "ditto-desktop";
  accountKey?: string;
  endpointKey?: string;
  endpoint?: DittoEndpoint;
}

function cliConfig(): { apiKey?: string; defaultEndpoint?: string } | undefined {
  const dir = process.env.DITTO_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "heyditto", "cli");
  try {
    return JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")) as { apiKey?: string; defaultEndpoint?: string };
  } catch {
    return undefined;
  }
}

/** The account credential: app login, then DITTO_API_KEY, then the heyditto CLI, then Ditto Desktop's linked account. */
export function readDittoSession(): Session {
  const endpointKey = getSecret(SECRET_ENDPOINT_KEY);
  let endpoint: DittoEndpoint | undefined;
  if (endpointRaw) {
    try {
      endpoint = JSON.parse(endpointRaw) as DittoEndpoint;
    } catch {
      endpoint = undefined;
    }
  }
  const appKey = getSecret(SECRET_ACCOUNT_KEY);
  if (appKey) return { loggedIn: true, source: "app", accountKey: appKey, endpointKey, endpoint };
  if (process.env.DITTO_API_KEY) return { loggedIn: true, source: "env", accountKey: process.env.DITTO_API_KEY, endpointKey, endpoint };
  const cli = cliConfig();
  if (cli?.apiKey) return { loggedIn: true, source: "cli", accountKey: cli.apiKey, endpointKey, endpoint };
  const desktop = detectDittoDesktop();
  if (desktop?.account) return { loggedIn: true, source: "ditto-desktop", accountKey: desktop.account.apiKey, endpointKey, endpoint };
  return { loggedIn: false, endpointKey, endpoint };
}

export function cliInstalled(): boolean {
  try {
    execFileSync("/usr/bin/which", ["heyditto"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function dittoStatus(): DittoStatus {
  const s = readDittoSession();
  const desktop = detectDittoDesktop();
  return {
    loggedIn: s.loggedIn,
    source: s.source,
    cliInstalled: cliInstalled(),
    endpoint: s.endpoint,
    hasEndpointKey: Boolean(s.endpointKey),
    dittoDesktop: desktop ? { installed: true, linked: Boolean(desktop.account), appPath: desktop.appPath } : { installed: false, linked: false },
  };
}

/** GET /v1/key on the router: the credit snapshot for whichever key powers inference. */
export async function creditSnapshot(key: string): Promise<CreditSnapshot> {
  const res = await fetch(`${ROUTER_BASE}/v1/key`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`router /v1/key: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Record<string, unknown> };
  const d = body.data ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    balance: num(d.balance),
    currency: String(d.currency ?? "USD"),
    billingMode: d.billing_mode as string | undefined,
    label: d.label as string | undefined,
    usage: num(d.usage) ?? undefined,
    reserved: num(d.reserved) ?? undefined,
    limitRemaining: num(d.limit_remaining),
    topUpUrl: d.top_up_url as string | undefined,
    asOf: d.as_of as string | undefined,
  };
}

async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "omnisynth-desktop" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.auth !== false) {
    const key = readDittoSession().accountKey;
    if (!key) throw new Error("Not signed in with Ditto");
    headers.Authorization = `Bearer ${key}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      detail = parsed.message || parsed.error || text;
    } catch {
      /* raw */
    }
    throw new Error(`${init.method ?? "GET"} ${path} failed: HTTP ${res.status}${detail ? ` - ${detail.slice(0, 300)}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}
interface DeviceTokenResponse {
  status: "ok" | "pending" | "slow_down" | "denied" | "expired";
  accessToken?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the device flow; `onCode` receives the code + URL to show/open, resolves once the key is minted. */
export async function deviceLogin(onCode: (code: DittoDeviceCode) => void): Promise<void> {
  const code = await api<DeviceCodeResponse>("/api/v2/mcp/device-code", {
    method: "POST",
    auth: false,
    body: { client: DEVICE_CLIENT, intent: "login" },
  });
  if (!code.device_code || !code.user_code || !code.verification_url) {
    throw new Error("device login is not available on this API");
  }
  const sep = code.verification_url.includes("?") ? "&" : "?";
  const url = code.verification_uri_complete ?? `${code.verification_url}${sep}code=${encodeURIComponent(code.user_code)}`;
  onCode({ user_code: code.user_code, verification_url: url });

  const deadline = Date.now() + Math.max(30, code.expires_in || 600) * 1000;
  let interval = Math.max(2, code.interval || 5) * 1000;
  let wait = 1000;
  while (Date.now() < deadline) {
    await sleep(wait);
    wait = interval;
    const result = await api<DeviceTokenResponse>("/api/v2/mcp/device-token", {
      method: "POST",
      auth: false,
      body: { device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
    });
    switch (result.status) {
      case "ok":
        if (!result.accessToken) throw new Error("login succeeded but no key was returned");
        setSecret(SECRET_ACCOUNT_KEY, result.accessToken);
        return;
      case "slow_down":
        interval += 5000;
        wait = interval;
        break;
      case "denied":
        throw new Error("login was denied in the browser");
      case "expired":
        throw new Error("the login code expired before it was approved");
      default:
        break;
    }
  }
  throw new Error("timed out waiting for browser approval");
}

export function logout(): void {
  deleteSecret(SECRET_ACCOUNT_KEY);
  deleteSecret(SECRET_ENDPOINT_KEY);
  deleteSecret(SECRET_ENDPOINT);
}

interface EndpointRecord {
  id: string;
  slug: string;
  name: string;
  model: string;
}

export async function listEndpoints(): Promise<DittoEndpoint[]> {
  const res = await api<{ endpoints?: EndpointRecord[] }>("/api/v5/inference/endpoints");
  return (res.endpoints ?? []).map(({ id, slug, name, model }) => ({ id, slug, name, model }));
}

async function mintKey(endpoint: DittoEndpoint): Promise<void> {
  const key = await api<{ key?: string }>(`/api/v5/inference/endpoints/${encodeURIComponent(endpoint.id)}/keys`, {
    method: "POST",
    body: { name: `OmniSynth on ${process.env.HOSTNAME || "this Mac"}` },
  });
  if (!key.key) throw new Error("key creation succeeded but no plaintext key was returned");
  setSecret(SECRET_ENDPOINT_KEY, key.key);
  setSecret(SECRET_ENDPOINT, JSON.stringify(endpoint));
}

/** Reuses an existing omnisynth-* endpoint when present, otherwise creates one; always mints a fresh key for this install. */
export async function createEndpoint(model = DEFAULT_ENDPOINT_MODEL): Promise<DittoEndpoint> {
  const existing = (await listEndpoints()).find((e) => e.slug.startsWith(ENDPOINT_SLUG_PREFIX));
  let endpoint = existing;
  if (!endpoint) {
    const created = await api<EndpointRecord | { endpoint: EndpointRecord }>("/api/v5/inference/endpoints", {
      method: "POST",
      body: {
        name: "OmniSynth",
        slug: `${ENDPOINT_SLUG_PREFIX}-${Math.random().toString(36).slice(2, 6)}`,
        model,
        systemPrompt: "",
        // The app sends its own system prompt and tools; keep the endpoint a plain gateway.
        modelMode: "passthrough",
        streamGranularity: "final",
        routingMode: "balanced",
        recallEnabled: false,
        recordEnabled: false,
        memoryDepth: 0,
        tools: [],
        maxToolRounds: 0,
        contextCompaction: "off",
      },
    });
    const rec = "endpoint" in created ? created.endpoint : created;
    endpoint = { id: rec.id, slug: rec.slug, name: rec.name, model: rec.model };
  }
  await mintKey(endpoint);
  return endpoint;
}

export async function useEndpoint(id: string): Promise<DittoEndpoint> {
  const endpoint = (await listEndpoints()).find((e) => e.id === id || e.slug === id);
  if (!endpoint) throw new Error(`no endpoint "${id}"`);
  await mintKey(endpoint);
  return endpoint;
}
