import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment, ChatRequest, ProviderId } from "../shared/ipc";
import { IPC } from "../shared/ipc";
import { detectProviders } from "./providers";
import { cancelChat, chat, listModels } from "./inference";
import { createEndpoint, creditSnapshot, deviceLogin, dittoStatus, listEndpoints, logout, readDittoSession, useEndpoint } from "./ditto";
import { deleteSecret, setSecret } from "./secrets";
import { Bridge } from "./bridge";
import { loginEnv } from "./providers";
import type { BridgeReply } from "../shared/ipc";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// QA automation: OMNISYNTH_QA_PORT exposes the Chrome DevTools protocol so a
// driver (Playwright over CDP) can control the packaged app end to end.
if (process.env.OMNISYNTH_QA_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.OMNISYNTH_QA_PORT);
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}
// Web Audio must be allowed to start without a user gesture inside the DAW.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let win: BrowserWindow | null = null;
const bridge = new Bridge({ window: () => win, readAttachments: (paths) => paths.map(readAttachment).filter((a): a is Attachment => a !== null) });
/** A deep-link job that arrived before the renderer finished loading. */
let pendingGenerate: { prompt: string; mode?: "new" | "iterate"; source?: string } | null = null;

// omnisynth://generate?prompt=...&mode=new — Ditto Desktop and the shell can open the app with a job.
const PROTOCOL = "omnisynth";
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
else app.setAsDefaultProtocolClient(PROTOCOL);

function handleDeepLink(raw: string): void {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${PROTOCOL}:`) return;
    const action = url.hostname || url.pathname.replace(/^\/+/, "");
    if (action === "generate") {
      const args = {
        prompt: url.searchParams.get("prompt") ?? "",
        mode: url.searchParams.get("mode") === "iterate" ? ("iterate" as const) : url.searchParams.get("mode") === "new" ? ("new" as const) : undefined,
        source: url.searchParams.get("source") ?? "deep-link",
      };
      if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send(IPC.bridgeGenerateRequest, args);
      else pendingGenerate = args;
      win?.show();
      win?.focus();
    }
  } catch {
    /* ignore malformed links */
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleDeepLink(link);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on("open-url", (e, url) => {
  e.preventDefault();
  handleDeepLink(url);
});

function createWindow(): void {
  win = new BrowserWindow({
    title: "OmniSynth",
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0a0a0f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(join(__dirname, "../dist/index.html"));
  }
  win.webContents.on("did-finish-load", () => {
    if (pendingGenerate && win) {
      win.webContents.send(IPC.bridgeGenerateRequest, pendingGenerate);
      pendingGenerate = null;
    }
  });
  win.on("closed", () => {
    win = null;
  });
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".aif", ".aiff"]);
const TEXT_EXT = new Set([".txt", ".md", ".json", ".lrc"]);

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".lrc": "text/plain",
};

function readAttachment(path: string): Attachment | null {
  const ext = extname(path).toLowerCase();
  const kind: Attachment["kind"] | null = IMAGE_EXT.has(ext) ? "image" : AUDIO_EXT.has(ext) ? "audio" : TEXT_EXT.has(ext) ? "text" : null;
  if (!kind) return null;
  const buf = readFileSync(path);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    name: basename(path),
    mime: MIME[ext] ?? "application/octet-stream",
    data: kind === "text" ? buf.toString("utf-8") : buf.toString("base64"),
    size: buf.byteLength,
    path,
  };
}

function registerIpc(): void {
  ipcMain.handle(IPC.providersDetect, () => detectProviders());
  ipcMain.handle(IPC.providersSetKey, (_e, provider: ProviderId, key: string) => {
    setSecret(provider === "custom" ? "custom.key" : provider, key.trim());
  });
  ipcMain.handle(IPC.providersClearKey, (_e, provider: ProviderId) => {
    deleteSecret(provider === "custom" ? "custom.key" : provider);
  });
  ipcMain.handle(IPC.providersSetCustom, (_e, baseUrl: string, model: string) => {
    setSecret("custom.baseUrl", baseUrl.replace(/\/+$/, ""));
    setSecret("custom.model", model);
  });

  ipcMain.handle(IPC.inferenceChat, (_e, req: ChatRequest) => chat(req));
  ipcMain.handle(IPC.inferenceCancel, (_e, id: string) => cancelChat(id));
  ipcMain.handle(IPC.inferenceModels, (_e, provider: ProviderId) => listModels(provider));

  ipcMain.handle(IPC.dittoStatus, () => dittoStatus());
  ipcMain.handle(IPC.dittoCredits, async () => {
    const session = readDittoSession();
    const env = loginEnv();
    const key = session.endpointKey || (env.ANTHROPIC_BASE_URL?.includes("router.heyditto.ai") ? env.ANTHROPIC_AUTH_TOKEN : undefined) || session.accountKey;
    if (!key) return null;
    try {
      return await creditSnapshot(key);
    } catch {
      return null;
    }
  });
  ipcMain.handle(IPC.bridgeInfo, () => bridge.current);
  ipcMain.on(IPC.bridgeReply, (_e, reply: BridgeReply) => bridge.onReply(reply));
  ipcMain.handle(IPC.dittoLogin, async (e) => {
    try {
      await deviceLogin((code) => {
        e.sender.send(IPC.dittoLoginCode, code);
        void shell.openExternal(code.verification_url);
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle(IPC.dittoLogout, () => logout());
  ipcMain.handle(IPC.dittoListEndpoints, () => listEndpoints());
  ipcMain.handle(IPC.dittoCreateEndpoint, (_e, model?: string) => createEndpoint(model));
  ipcMain.handle(IPC.dittoUseEndpoint, (_e, id: string) => useEndpoint(id));

  ipcMain.handle(IPC.filesPick, async (_e, kinds: Array<"image" | "audio" | "text">) => {
    const filters = [];
    if (kinds.includes("image")) filters.push({ name: "Images", extensions: [...IMAGE_EXT].map((x) => x.slice(1)) });
    if (kinds.includes("audio")) filters.push({ name: "Audio", extensions: [...AUDIO_EXT].map((x) => x.slice(1)) });
    if (kinds.includes("text")) filters.push({ name: "Text", extensions: [...TEXT_EXT].map((x) => x.slice(1)) });
    const result = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], filters });
    if (result.canceled) return [];
    return result.filePaths.map(readAttachment).filter((a): a is Attachment => a !== null);
  });
  ipcMain.handle(IPC.filesReadPaths, (_e, paths: string[]) => paths.map(readAttachment).filter((a): a is Attachment => a !== null));
  ipcMain.handle(IPC.filesSaveJson, async (_e, suggestedName: string, json: string) => {
    const result = await dialog.showSaveDialog(win!, { defaultPath: suggestedName, filters: [{ name: "OmniSynth song", extensions: ["omnisynth.json", "json"] }] });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, json);
    return result.filePath;
  });
  ipcMain.handle(IPC.filesOpenJson, async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: [{ name: "OmniSynth song", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return readFileSync(result.filePaths[0], "utf-8");
  });

  ipcMain.handle(IPC.shellOpenExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
    return Promise.resolve();
  });
}

app.whenReady().then(async () => {
  registerIpc();
  createWindow();
  try {
    const info = await bridge.start();
    console.log(`[omnisynth] bridge listening on 127.0.0.1:${info.port}`);
  } catch (err) {
    console.warn("[omnisynth] bridge failed to start:", (err as Error).message);
  }
  const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleDeepLink(link);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => bridge.stop());
