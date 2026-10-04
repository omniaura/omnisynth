import { createSignal, createRoot } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Attachment, ProviderId, ProviderInfo } from "../../shared/ipc";
import { engine, type SongState } from "../engine/engine";
import type { Brief } from "../agent/perceive";
import type { RunEvent } from "../agent/orchestrate";

/** Renderer-wide reactive state. Engine state is mirrored here via engine.onChange. */

const DEFAULT_VISUALS = `// OmniSynth visuals — a.fft[0..3] are audio bands (bass..treble)
osc(8, 0.05, 0.6)
  .color(1.0, 0.2, 0.4)
  .rotate(0.1, 0.02)
  .modulate(noise(2, 0.1), () => 0.1 + a.fft[0] * 0.4)
  .kaleid(3)
  .brightness(() => a.fft[1] * 0.3 - 0.1)
  .out()`;

export interface LogEntry extends RunEvent {
  id: number;
  at: number;
}

export interface Settings {
  perceiveProvider: ProviderId;
  perceiveModel: string;
  orchestrateProvider: ProviderId;
  orchestrateModel: string;
  skipPerceive: boolean;
  /** True until the user picks a provider by hand; auto-selection may then change it. */
  autoProvider: boolean;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("omnisynth.settings");
    if (raw) return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return defaultSettings();
}

function defaultSettings(): Settings {
  return { perceiveProvider: "ditto", perceiveModel: "", orchestrateProvider: "ditto", orchestrateModel: "", skipPerceive: false, autoProvider: true };
}

export const store = createRoot(() => {
  const [song, setSong] = createStore<SongState>(engine.getState());
  const [currentStep, setCurrentStep] = createStore<Record<string, number>>({});
  const [visuals, setVisualsSignal] = createSignal(localStorage.getItem("omnisynth.visuals") ?? DEFAULT_VISUALS);
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [prompt, setPrompt] = createSignal(localStorage.getItem("omnisynth.prompt") ?? "");
  const [brief, setBrief] = createSignal<Brief | null>(null);
  const [log, setLog] = createSignal<LogEntry[]>([]);
  const [running, setRunning] = createSignal<"idle" | "perceiving" | "orchestrating">("idle");
  const [status, setStatus] = createSignal("");
  const [providers, setProviders] = createSignal<ProviderInfo[]>([]);
  const [settings, setSettingsStore] = createStore<Settings>(loadSettings());
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [visualsOpen, setVisualsOpen] = createSignal(false);
  const [composerOpen, setComposerOpen] = createSignal(true);
  const [songName, setSongName] = createSignal("Untitled");
  const [toast, setToast] = createSignal<string | null>(null);
  let logId = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  engine.onChange((state) => setSong(reconcile(state)));
  engine.onStep(({ trackId, step }) => setCurrentStep(trackId, step));

  function setVisuals(code: string): void {
    setVisualsSignal(code);
    localStorage.setItem("omnisynth.visuals", code);
  }

  function updateSettings(patch: Partial<Settings>): void {
    const modelSet = (patch.perceiveModel !== undefined && patch.perceiveModel !== "") || (patch.orchestrateModel !== undefined && patch.orchestrateModel !== "");
    if (modelSet && settings.autoProvider) patch = { ...patch, autoProvider: false };
    setSettingsStore(patch);
    localStorage.setItem("omnisynth.settings", JSON.stringify({ ...settings, ...patch }));
  }
  }

  function pushLog(e: RunEvent): void {
    setLog((l) => [...l.slice(-199), { ...e, id: logId++, at: Date.now() }]);
    if (e.type === "status") setStatus(e.text);
  }

  function showToast(text: string): void {
    setToast(text);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 3200);
  }

  function savePrompt(p: string): void {
    setPrompt(p);
    localStorage.setItem("omnisynth.prompt", p);
  }

  return {
    song,
    currentStep,
    visuals,
    setVisuals,
    attachments,
    setAttachments,
    prompt,
    setPrompt: savePrompt,
    brief,
    setBrief,
    log,
    pushLog,
    clearLog: () => setLog([]),
    running,
    setRunning,
    status,
    setStatus,
    providers,
    setProviders,
    settings,
    updateSettings,
    settingsOpen,
    setSettingsOpen,
    visualsOpen,
    setVisualsOpen,
    composerOpen,
    setComposerOpen,
    songName,
    setSongName,
    toast,
    showToast,
  };
});

export type Store = typeof store;
