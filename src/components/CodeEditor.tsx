import { onMount, onCleanup, createEffect } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap, undo, redo } from "@codemirror/commands";

interface CodeEditorProps {
  code: () => string;
  onCodeChange: (code: string) => void;
  onEvaluate?: () => void;
  placeholder?: string;
  label: string;
}

export interface EditorRef {
  undo: () => void;
  redo: () => void;
  getCode: () => string;
  setCode: (code: string) => void;
}

export default function CodeEditor(props: CodeEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;

  // Expose editor methods for external control
  const editorRef: EditorRef = {
    undo: () => {
      if (editorView) {
        undo(editorView);
      }
    },
    redo: () => {
      if (editorView) {
        redo(editorView);
      }
    },
    getCode: () => {
      return editorView?.state.doc.toString() ?? "";
    },
    setCode: (code: string) => {
      if (editorView) {
        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: code,
          },
        });
      }
    },
  };

  onMount(() => {
    if (!containerRef) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        props.onCodeChange(update.state.doc.toString());
      }
    });

    // Ctrl/Cmd+Enter to evaluate
    const evalKeymap = keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          props.onEvaluate?.();
          return true;
        },
      },
    ]);

    const startState = EditorState.create({
      doc: props.code(),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        javascript(),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        evalKeymap,
        updateListener,
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "14px",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          },
          ".cm-content": {
            caretColor: "#fff",
          },
          "&.cm-focused .cm-cursor": {
            borderLeftColor: "#fff",
          },
        }),
      ],
    });

    editorView = new EditorView({
      state: startState,
      parent: containerRef,
    });

    // Attach ref to container for parent access
    (containerRef as HTMLDivElement & { editorRef?: EditorRef }).editorRef = editorRef;
  });

  onCleanup(() => {
    editorView?.destroy();
  });

  // Sync code from props (for AI-generated code)
  createEffect(() => {
    const newCode = props.code();
    if (editorView && editorView.state.doc.toString() !== newCode) {
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: newCode,
        },
      });
    }
  });

  return (
    <div class="code-editor">
      <div class="editor-header">
        <span class="editor-label">{props.label}</span>
        <span class="editor-hint">Ctrl+Enter to run</span>
      </div>
      <div ref={containerRef} class="editor-container" />
    </div>
  );
}

// Helper to get EditorRef from container
export function getEditorRef(container: HTMLDivElement | undefined): EditorRef | undefined {
  return (container as HTMLDivElement & { editorRef?: EditorRef })?.editorRef;
}

