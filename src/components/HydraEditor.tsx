import CodeEditor from "./CodeEditor";

interface HydraEditorProps {
  code: () => string;
  onCodeChange: (code: string) => void;
  onEvaluate: () => void;
}

export default function HydraEditor(props: HydraEditorProps) {
  return (
    <CodeEditor
      code={props.code}
      onCodeChange={props.onCodeChange}
      onEvaluate={props.onEvaluate}
      label="Hydra"
      placeholder="// Write Hydra shaders here
// Example: osc(10, 0.1).color(1, 0, 0.5).out()"
    />
  );
}

