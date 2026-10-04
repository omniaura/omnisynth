import { createSignal } from "solid-js";

// Default example code
const DEFAULT_STRUDEL_CODE = `// Strudel pattern - Press Ctrl+Enter to run
s("bd sd:2 bd sd")
  .speed(1)
  .room(0.3)`;

const DEFAULT_HYDRA_CODE = `// Hydra visuals - Press Ctrl+Enter to run
osc(10, 0.1, 0.8)
  .color(1, 0.5, 0.8)
  .rotate(0, 0.1)
  .out()`;

// Strudel and Hydra code
export const [strudelCode, setStrudelCode] = createSignal(DEFAULT_STRUDEL_CODE);
export const [hydraCode, setHydraCode] = createSignal(DEFAULT_HYDRA_CODE);

// Playback state
export const [isPlaying, setIsPlaying] = createSignal(false);

// View mode: true = fullscreen visuals, false = code mode
export const [isViewMode, setIsViewMode] = createSignal(false);

// Modal states
export const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
export const [isAIPromptOpen, setIsAIPromptOpen] = createSignal(false);

// AI settings (persisted to localStorage)
const storedProvider = localStorage.getItem("ai_provider") as "ollama" | "openrouter" | null;
const storedModel = localStorage.getItem("ai_model");
const storedApiKey = localStorage.getItem("openrouter_api_key");

export const [aiProvider, setAIProviderInternal] = createSignal<"ollama" | "openrouter">(
  storedProvider || "ollama"
);
export const [aiModel, setAIModelInternal] = createSignal(storedModel || "");
export const [openrouterApiKey, setOpenrouterApiKeyInternal] = createSignal(storedApiKey || "");

// Persist settings to localStorage
export function setAIProvider(provider: "ollama" | "openrouter") {
  setAIProviderInternal(provider);
  localStorage.setItem("ai_provider", provider);
}

export function setAIModel(model: string) {
  setAIModelInternal(model);
  localStorage.setItem("ai_model", model);
}

export function setOpenrouterApiKey(key: string) {
  setOpenrouterApiKeyInternal(key);
  localStorage.setItem("openrouter_api_key", key);
}

// Audio state
export const [audioAnalyser, setAudioAnalyser] = createSignal<AnalyserNode | null>(null);

