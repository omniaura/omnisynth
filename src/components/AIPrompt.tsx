import { createSignal, createEffect, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface AIPromptProps {
  isOpen: () => boolean;
  onClose: () => void;
  onGenerate: (strudel: string | null, hydra: string | null) => void;
  currentStrudelCode: () => string;
  currentHydraCode: () => string;
  provider: () => "ollama" | "openrouter";
  model: () => string;
  apiKey: () => string;
}

interface GenerateResult {
  strudel_code: string | null;
  hydra_code: string | null;
  strudel_error: string | null;
  hydra_error: string | null;
}

export default function AIPrompt(props: AIPromptProps) {
  const [prompt, setPrompt] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [ollamaModels, setOllamaModels] = createSignal<string[]>([]);

  // Fetch Ollama models when provider is ollama
  createEffect(() => {
    if (props.provider() === "ollama") {
      fetchOllamaModels();
    }
  });

  async function fetchOllamaModels() {
    try {
      const models = await invoke<string[]>("list_ollama_models");
      setOllamaModels(models);
    } catch (err) {
      console.error("Failed to fetch Ollama models:", err);
      setOllamaModels([]);
    }
  }

  async function handleGenerate() {
    const promptText = prompt().trim();
    if (!promptText) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await invoke<GenerateResult>("generate_both", {
        provider: props.provider(),
        model: props.model(),
        prompt: promptText,
        strudelCode: props.currentStrudelCode() || null,
        hydraCode: props.currentHydraCode() || null,
        apiKey: props.provider() === "openrouter" ? props.apiKey() : null,
      });

      // Handle results
      if (result.strudel_error && result.hydra_error) {
        setError(`Strudel: ${result.strudel_error}\nHydra: ${result.hydra_error}`);
      } else if (result.strudel_error) {
        setError(`Strudel generation failed: ${result.strudel_error}`);
      } else if (result.hydra_error) {
        setError(`Hydra generation failed: ${result.hydra_error}`);
      }

      props.onGenerate(result.strudel_code, result.hydra_code);

      if (!result.strudel_error && !result.hydra_error) {
        setPrompt("");
        props.onClose();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    } else if (e.key === "Escape") {
      props.onClose();
    }
  }

  return (
    <Show when={props.isOpen()}>
      <div class="ai-prompt-overlay" onClick={() => props.onClose()}>
        <div class="ai-prompt-modal" onClick={(e) => e.stopPropagation()}>
          <div class="ai-prompt-header">
            <h2>Generate with AI</h2>
            <button class="close-btn" onClick={() => props.onClose()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="ai-prompt-info">
            <span class="provider-badge">{props.provider()}</span>
            <span class="model-badge">{props.model()}</span>
          </div>

          <div class="ai-prompt-body">
            <textarea
              class="prompt-input"
              placeholder="Describe what you want to create...&#10;&#10;Examples:&#10;• A chill lo-fi beat with rain sounds&#10;• Psychedelic kaleidoscope visuals&#10;• Techno with acid bassline and glitchy visuals"
              value={prompt()}
              onInput={(e) => setPrompt(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading()}
              autofocus
            />

            <Show when={error()}>
              <div class="error-message">{error()}</div>
            </Show>

            <div class="ai-prompt-footer">
              <span class="hint">Both Strudel and Hydra agents will generate code in parallel</span>
              <div class="button-group">
                <button class="cancel-btn" onClick={() => props.onClose()} disabled={isLoading()}>
                  Cancel
                </button>
                <button
                  class="generate-btn"
                  onClick={handleGenerate}
                  disabled={isLoading() || !prompt().trim()}
                >
                  {isLoading() ? (
                    <>
                      <span class="spinner" />
                      Generating...
                    </>
                  ) : (
                    <>Generate (Ctrl+Enter)</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

