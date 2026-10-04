import { onMount, onCleanup, createEffect } from "solid-js";
import "./App.css";

// Components
import HydraCanvas from "./components/HydraCanvas";
import StrudelEditor from "./components/StrudelEditor";
import HydraEditor from "./components/HydraEditor";
import Controls from "./components/Controls";
import AIPrompt from "./components/AIPrompt";
import Settings from "./components/Settings";

// Strudel lib
import {
  initStrudel,
  evaluateStrudelCode,
  hush,
  getAnalyserNode,
} from "./lib/strudel";

// Store
import {
  strudelCode,
  setStrudelCode,
  hydraCode,
  setHydraCode,
  isPlaying,
  setIsPlaying,
  isViewMode,
  setIsViewMode,
  isSettingsOpen,
  setIsSettingsOpen,
  isAIPromptOpen,
  setIsAIPromptOpen,
  aiProvider,
  setAIProvider,
  aiModel,
  setAIModel,
  openrouterApiKey,
  setOpenrouterApiKey,
  audioAnalyser,
  setAudioAnalyser,
} from "./stores/app";

function App() {
  let strudelEditorRef: HTMLDivElement | undefined;
  let hydraEditorRef: HTMLDivElement | undefined;

  onMount(async () => {
    // Initialize Strudel
    await initStrudel();
    setAudioAnalyser(getAnalyserNode());
  });

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    // Escape to toggle view mode
    if (e.key === "Escape") {
      setIsViewMode(!isViewMode());
      e.preventDefault();
    }
    // Space to toggle play/pause (when not in an editor)
    if (e.key === " " && e.target === document.body) {
      if (isPlaying()) {
        handlePause();
      } else {
        handlePlay();
      }
      e.preventDefault();
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    hush();
  });

  // Handlers
  async function handlePlay() {
    try {
      await evaluateStrudelCode(strudelCode());
      setIsPlaying(true);
    } catch (err) {
      console.error("Failed to play:", err);
    }
  }

  function handlePause() {
    hush();
    setIsPlaying(false);
  }

  async function handleEvaluateStrudel() {
    try {
      await evaluateStrudelCode(strudelCode());
      setIsPlaying(true);
    } catch (err) {
      console.error("Strudel error:", err);
    }
  }

  function handleEvaluateHydra() {
    // Hydra evaluation is handled by the HydraCanvas component
    // via createEffect watching hydraCode
  }

  function handleUndo() {
    // Get the focused editor and call undo
    const activeEditor = document.activeElement?.closest(".code-editor");
    if (activeEditor) {
      const container = activeEditor.querySelector(".editor-container") as
        | (HTMLDivElement & { editorRef?: { undo: () => void } })
        | null;
      container?.editorRef?.undo();
    }
  }

  function handleRedo() {
    // Get the focused editor and call redo
    const activeEditor = document.activeElement?.closest(".code-editor");
    if (activeEditor) {
      const container = activeEditor.querySelector(".editor-container") as
        | (HTMLDivElement & { editorRef?: { redo: () => void } })
        | null;
      container?.editorRef?.redo();
    }
  }

  function handleAIGenerate(strudel: string | null, hydra: string | null) {
    if (strudel) {
      setStrudelCode(strudel);
    }
    if (hydra) {
      setHydraCode(hydra);
    }
  }

  return (
    <div class="app" classList={{ "view-mode": isViewMode() }}>
      {/* Hydra Canvas - always visible */}
      <HydraCanvas
        code={hydraCode}
        audioAnalyser={audioAnalyser}
        isFullscreen={isViewMode}
      />

      {/* Code editors - hidden in view mode */}
      <div class="editors-container" classList={{ hidden: isViewMode() }}>
        <div class="editor-panel" ref={strudelEditorRef}>
          <StrudelEditor
            code={strudelCode}
            onCodeChange={setStrudelCode}
            onEvaluate={handleEvaluateStrudel}
          />
        </div>
        <div class="editor-panel" ref={hydraEditorRef}>
          <HydraEditor
            code={hydraCode}
            onCodeChange={setHydraCode}
            onEvaluate={handleEvaluateHydra}
          />
        </div>
      </div>

      {/* Controls - always visible */}
      <Controls
        isPlaying={isPlaying}
        isViewMode={isViewMode}
        onPlay={handlePlay}
        onPause={handlePause}
        onToggleViewMode={() => setIsViewMode(!isViewMode())}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAI={() => setIsAIPromptOpen(true)}
      />

      {/* Modals */}
      <AIPrompt
        isOpen={isAIPromptOpen}
        onClose={() => setIsAIPromptOpen(false)}
        onGenerate={handleAIGenerate}
        currentStrudelCode={strudelCode}
        currentHydraCode={hydraCode}
        provider={aiProvider}
        model={aiModel}
        apiKey={openrouterApiKey}
      />

      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        provider={aiProvider}
        setProvider={setAIProvider}
        model={aiModel}
        setModel={setAIModel}
        apiKey={openrouterApiKey}
        setApiKey={setOpenrouterApiKey}
      />
    </div>
  );
}

export default App;
