interface ControlsProps {
  isPlaying: () => boolean;
  isViewMode: () => boolean;
  onPlay: () => void;
  onPause: () => void;
  onToggleViewMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenSettings: () => void;
  onOpenAI: () => void;
}

export default function Controls(props: ControlsProps) {
  return (
    <div class="controls" classList={{ "view-mode": props.isViewMode() }}>
      <div class="controls-group">
        {/* Play/Pause */}
        <button
          class="control-btn play-btn"
          onClick={() => (props.isPlaying() ? props.onPause() : props.onPlay())}
          title={props.isPlaying() ? "Pause (Space)" : "Play (Space)"}
        >
          {props.isPlaying() ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Undo/Redo - only show in code mode */}
        {!props.isViewMode() && (
          <>
            <button
              class="control-btn"
              onClick={props.onUndo}
              title="Undo (Ctrl+Z)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                <path d="M3 10l4-4" />
                <path d="M3 10l4 4" />
              </svg>
            </button>
            <button
              class="control-btn"
              onClick={props.onRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M21 10H11a5 5 0 0 0-5 5v2" />
                <path d="M21 10l-4-4" />
                <path d="M21 10l-4 4" />
              </svg>
            </button>
          </>
        )}
      </div>

      <div class="controls-group">
        {/* View Mode Toggle */}
        <button
          class="control-btn"
          onClick={props.onToggleViewMode}
          title={props.isViewMode() ? "Show Code (Esc)" : "Fullscreen Visuals (Esc)"}
        >
          {props.isViewMode() ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <polyline points="4 14 4 20 10 20" />
              <polyline points="20 10 20 4 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>

        {/* AI Generate */}
        <button
          class="control-btn ai-btn"
          onClick={props.onOpenAI}
          title="Generate with AI"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </button>

        {/* Settings */}
        <button
          class="control-btn"
          onClick={props.onOpenSettings}
          title="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </div>
    </div>
  );
}

