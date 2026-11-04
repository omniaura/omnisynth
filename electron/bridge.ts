import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import type { Attachment } from "../shared/ipc";
import { IPC } from "../shared/ipc";
import { serveStrudel } from "./strudel-assets";

/**
 * The OmniSynth bridge: a loopback HTTP + MCP (streamable HTTP, JSON-RPC)
 * server that other local apps — Ditto Desktop first — use to drive the DAW.
 *
 * Tool execution happens in the renderer (the engine lives there), so every
 * call is forwarded over IPC and awaited. A discovery file advertises the
 * port and bearer token while the app runs so clients never guess ports.
 *
 *   GET  /health                      -> { ok, version, pid, song }
 *   GET  /tools                       -> [{ name, description, parameters }]
 *   POST /tools/:name  { ...args }    -> { ok, result }
 *   POST /generate     { prompt, attachments?, mode?, source? } -> { ok, summary, state }
 *   GET  /state                       -> compact song state
 *   POST /mcp          JSON-RPC 2.0   -> initialize | tools/list | tools/call | ping
 *
 * Authorization: Bearer <token> on every route except /health.
 */

export interface BridgeInfo {
  port: number;
  token: string;
  pid: number;
  version: string;
  appPath: string;
  startedAt: string;
  protocol: 1;
}

export interface GenerateRequest {
  prompt: string;
  attachments?: Array<{ path: string } | Attachment>;
  mode?: "new" | "iterate";
  /** Who asked: e.g. "ditto-desktop:thread:abc". Shown in OmniSynth's run log. */
  source?: string;
  /** Wait for the run to finish (default) or return once accepted. */
  wait?: boolean;
}

interface RendererCall {
  id: string;
  kind: "tool" | "generate" | "state" | "tools";
  name?: string;
  args?: unknown;
}

interface RendererReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const DISCOVERY_FILE = "bridge.json";

export function bridgeDir(): string {
  if (process.env.OMNISYNTH_QA_USER_DATA_DIR) return process.env.OMNISYNTH_QA_USER_DATA_DIR;
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "OmniSynth");
    case "win32":
      return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "OmniSynth");
    default:
      return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omnisynth");
  }
}

export function discoveryPath(): string {
  return join(bridgeDir(), DISCOVERY_FILE);
}

export class Bridge {
  private server: Server | null = null;
  private info: BridgeInfo | null = null;
  private pending = new Map<string, { resolve: (r: RendererReply) => void; timer: ReturnType<typeof setTimeout> }>();
  private windowProvider: () => BrowserWindow | null;
  private readAttachments: (paths: string[]) => Attachment[];

  constructor(opts: { window: () => BrowserWindow | null; readAttachments: (paths: string[]) => Attachment[] }) {
    this.windowProvider = opts.window;
    this.readAttachments = opts.readAttachments;
  }

  get current(): BridgeInfo | null {
    return this.info;
  }

  async start(): Promise<BridgeInfo> {
    if (this.info) return this.info;
    const token = randomBytes(24).toString("base64url");
    const server = createServer((req, res) => void this.handle(req, res, token));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(process.env.OMNISYNTH_BRIDGE_PORT) || 0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.server = server;
    this.info = { port, token, pid: process.pid, version: app.getVersion(), appPath: app.getPath("exe"), startedAt: new Date().toISOString(), protocol: 1 };
    try {
      mkdirSync(bridgeDir(), { recursive: true });
      writeFileSync(discoveryPath(), JSON.stringify(this.info, null, 2), { mode: 0o600 });
    } catch (err) {
      this.stop();
      throw err;
    }
    return this.info;
  }

  stop(): void {
    try {
      rmSync(discoveryPath(), { force: true });
    } catch {
      /* ignore */
    }
    this.server?.close();
    this.server = null;
    this.info = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ id, ok: false, error: "bridge is shutting down" });
    }
    this.pending.clear();
  }

  /** Renderer replies arrive here (wired from main.ts via ipcMain.on). */
  onReply(reply: RendererReply): void {
    const p = this.pending.get(reply.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(reply.id);
    p.resolve(reply);
  }

  private callRenderer(call: Omit<RendererCall, "id">, timeoutMs: number): Promise<RendererReply> {
    const win = this.windowProvider();
    if (!win || win.isDestroyed()) return Promise.resolve({ id: "", ok: false, error: "OmniSynth window is not open" });
    const id = randomBytes(8).toString("hex");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, ok: false, error: `timed out after ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      win.webContents.send(IPC.bridgeCall, { id, ...call } satisfies RendererCall);
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname.startsWith("/strudel/")) {
      const site = req.headers["sec-fetch-site"];
      if (req.headers.host !== `127.0.0.1:${this.info?.port}` || (site !== "none" && site !== "same-origin")) {
        return json(res, 403, { error: "forbidden_origin" });
      }
      return serveStrudel(url.pathname, res);
    }
    res.setHeader("Cache-Control", "no-store");
    // Loopback only; still refuse browser cross-origin use so a web page can't drive the DAW.
    if (req.headers.origin) return json(res, 403, { error: "forbidden_origin" });
    const auth = req.headers.authorization ?? "";
    if (url.pathname === "/health") {
      const authorized = auth === `Bearer ${token}`;
      const state = authorized ? await this.callRenderer({ kind: "state" }, 3000) : null;
      return json(res, 200, { ok: true, version: this.info?.version, pid: process.pid, song: state?.ok ? state.result : null });
    }
    if (auth !== `Bearer ${token}`) return json(res, 401, { error: "invalid_token", message: "Authorization: Bearer <token> from bridge.json is required." });

    try {
      if (url.pathname === "/tools" && req.method === "GET") {
        const r = await this.callRenderer({ kind: "tools" }, 5000);
        return r.ok ? json(res, 200, r.result) : json(res, 500, { error: r.error });
      }
      if (url.pathname === "/state" && req.method === "GET") {
        const r = await this.callRenderer({ kind: "state" }, 5000);
        return r.ok ? json(res, 200, r.result) : json(res, 500, { error: r.error });
      }
      if (url.pathname.startsWith("/tools/") && req.method === "POST") {
        const name = decodeURIComponent(url.pathname.slice("/tools/".length));
        const args = (await readJson(req)) as Record<string, unknown>;
        const r = await this.callRenderer({ kind: "tool", name, args }, 60_000);
        return json(res, r.ok ? 200 : 400, { ok: r.ok, result: r.result, error: r.error });
      }
      if (url.pathname === "/generate" && req.method === "POST") {
        const body = (await readJson(req)) as GenerateRequest;
        const attachments = this.resolveAttachments(body.attachments);
        const wait = body.wait !== false;
        if (!wait) {
          const win = this.windowProvider();
          if (!win || win.isDestroyed()) return json(res, 503, { ok: false, error: "OmniSynth window is not open" });
        }
        const call = this.callRenderer({ kind: "generate", args: { ...body, attachments } }, wait ? 15 * 60_000 : 5000);
        if (!wait) return json(res, 202, { ok: true, accepted: true });
        const r = await call;
        return json(res, r.ok ? 200 : 500, { ok: r.ok, ...(typeof r.result === "object" && r.result ? (r.result as object) : {}), error: r.error });
      }
      if (url.pathname === "/mcp" && req.method === "POST") {
        const rpc = (await readJson(req)) as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
        return json(res, 200, await this.mcp(rpc));
      }
      if (url.pathname === "/mcp" && (req.method === "GET" || req.method === "DELETE")) {
        // No server-initiated stream; sessions are stateless.
        res.statusCode = 405;
        res.end();
        return;
      }
      return json(res, 404, { error: "not_found" });
    } catch (err) {
      return json(res, 500, { error: (err as Error).message });
    }
  }

  private resolveAttachments(list: GenerateRequest["attachments"]): Attachment[] {
    if (!list?.length) return [];
    const paths = list.filter((a): a is { path: string } => "path" in a && !("data" in a)).map((a) => a.path);
    const inline = list.filter((a): a is Attachment => "data" in a);
    return [...this.readAttachments(paths), ...inline];
  }

  /** Minimal MCP server: initialize, ping, tools/list, tools/call. */
  private async mcp(rpc: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }): Promise<unknown> {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: rpc.id ?? null, result });
    const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code, message } });
    switch (rpc.method) {
      case "initialize":
        return reply({
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "omnisynth", version: this.info?.version ?? "0" },
          instructions:
            "OmniSynth is an LLM-native DAW running on this machine. Use omnisynth_generate for a whole song from a prompt (and optional image/audio/text attachments); use the individual DAW tools to add tracks, design patches, wire modulation, set evolution rules and arrange sections. Call get_state first when editing an existing song.",
        });
      case "notifications/initialized":
        return { jsonrpc: "2.0", id: rpc.id ?? null, result: {} };
      case "ping":
        return reply({});
      case "tools/list": {
        const r = await this.callRenderer({ kind: "tools" }, 5000);
        if (!r.ok) return error(-32000, r.error ?? "tools unavailable");
        const tools = (r.result as Array<{ name: string; description: string; parameters: unknown }>).map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters }));
        tools.unshift({
          name: "omnisynth_generate",
          description: "Run OmniSynth's Perceive→Orchestrate pipeline: build or iterate a whole song from a prompt and optional attachments (file paths to images, audio, lyrics/notes). Returns the producer's summary and the resulting song state. Takes 1-6 minutes.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              attachments: { type: "array", items: { type: "string" }, description: "absolute file paths" },
              mode: { type: "string", enum: ["new", "iterate"], description: "new clears the current song first" },
            },
            required: ["prompt"],
          },
        });
        return reply({ tools });
      }
      case "tools/call": {
        const name = String(rpc.params?.name ?? "");
        const args = (rpc.params?.arguments as Record<string, unknown>) ?? {};
        if (name === "omnisynth_generate") {
          const attachments = this.resolveAttachments(((args.attachments as string[]) ?? []).map((p) => ({ path: p })));
          const r = await this.callRenderer({ kind: "generate", args: { prompt: String(args.prompt ?? ""), attachments, mode: args.mode, source: "mcp" } }, 15 * 60_000);
          const text = r.ok ? JSON.stringify(r.result) : `Error: ${r.error}`;
          return reply({ content: [{ type: "text", text }], isError: !r.ok });
        }
        const r = await this.callRenderer({ kind: "tool", name, args }, 60_000);
        return reply({ content: [{ type: "text", text: r.ok ? String(r.result) : `Error: ${r.error}` }], isError: !r.ok });
      }
      default:
        return error(-32601, `method not found: ${rpc.method}`);
    }
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error(`invalid JSON body: ${(e as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}
