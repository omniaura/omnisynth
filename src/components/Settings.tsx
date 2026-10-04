import { createSignal, createEffect, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface SettingsProps {
  isOpen: () => boolean;
  onClose: () => void;
  provider: () => "ollama" | "openrouter";
  setProvider: (provider: "ollama" | "openrouter") => void;
  model: () => string;
  setModel: (model: string) => void;
  apiKey: () => string;
  setApiKey: (key: string) => void;
}

// Popular OpenRouter models for code generation
const OPENROUTER_MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-exp:free",
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.3-70b-instruct",
  "qwen/qwen-2.5-coder-32b-instruct",
];

export default function Settings(props: SettingsProps) {
  const [ollamaModels, setOllamaModels] = createSignal<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = createSignal(false);

  // Fetch Ollama models
  createEffect(() => {
    if (props.isOpen() && props.provider() === "ollama") {
      fetchOllamaModels();
    }
  });

  async function fetchOllamaModels() {
    setIsLoadingModels(true);
    try {
      const models = await invoke<string[]>("list_ollama_models");
      setOllamaModels(models);
      // Set first model as default if none selected
      if (!props.model() && models.length > 0) {
        props.setModel(models[0]);
      }
    } catch (err) {
      console.error("Failed to fetch Ollama models:", err);
      setOllamaModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }

  function handleProviderChange(provider: "ollama" | "openrouter") {
    props.setProvider(provider);
    // Reset model when switching providers
    if (provider === "openrouter") {
      props.setModel(OPENROUTER_MODELS[0]);
    } else {
      props.setModel("");
      fetchOllamaModels();
    }
  }

  return (
    <Show when={props.isOpen()}>
      <div class="settings-overlay" onClick={() => props.onClose()}>
        <div class="settings-modal" onClick={(e) => e.stopPropagation()}>
          <div class="settings-header">
            <h2>Settings</h2>
            <button class="close-btn" onClick={() => props.onClose()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="settings-body">
            {/* Provider Selection */}
            <div class="setting-group">
              <label class="setting-label">AI Provider</label>
              <div class="provider-toggle">
                <button
                  class="provider-btn"
                  classList={{ active: props.provider() === "ollama" }}
                  onClick={() => handleProviderChange("ollama")}
                >
                  <span class="provider-icon">🦙</span>
                  Ollama (Local)
                </button>
                <button
                  class="provider-btn"
                  classList={{ active: props.provider() === "openrouter" }}
                  onClick={() => handleProviderChange("openrouter")}
                >
                  <span class="provider-icon">🌐</span>
                  OpenRouter
                </button>
              </div>
            </div>

            {/* Model Selection */}
            <div class="setting-group">
              <label class="setting-label">Model</label>
              <Show
                when={props.provider() === "ollama"}
                fallback={
                  <select
                    class="setting-select"
                    value={props.model()}
                    onChange={(e) => props.setModel(e.currentTarget.value)}
                  >
                    <For each={OPENROUTER_MODELS}>
                      {(model) => <option value={model}>{model}</option>}
                    </For>
                  </select>
                }
              >
                <Show
                  when={!isLoadingModels()}
                  fallback={<div class="loading-text">Loading models...</div>}
                >
                  <Show
                    when={ollamaModels().length > 0}
                    fallback={
                      <div class="warning-text">
                        No Ollama models found. Make sure Ollama is running and you have models installed.
                        <br />
                        <code>ollama pull llama3.2</code>
                      </div>
                    }
                  >
                    <select
                      class="setting-select"
                      value={props.model()}
                      onChange={(e) => props.setModel(e.currentTarget.value)}
                    >
                      <For each={ollamaModels()}>
                        {(model) => <option value={model}>{model}</option>}
                      </For>
                    </select>
                  </Show>
                </Show>
              </Show>
            </div>

            {/* API Key (OpenRouter only) */}
            <Show when={props.provider() === "openrouter"}>
              <div class="setting-group">
                <label class="setting-label">
                  OpenRouter API Key
                  <a href="https://openrouter.ai/keys" target="_blank" class="key-link">
                    Get one here
                  </a>
                </label>
                <input
                  type="password"
                  class="setting-input"
                  placeholder="sk-or-..."
                  value={props.apiKey()}
                  onInput={(e) => props.setApiKey(e.currentTarget.value)}
                />
              </div>
            </Show>
          </div>

          <div class="settings-footer">
            <button class="save-btn" onClick={() => props.onClose()}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

