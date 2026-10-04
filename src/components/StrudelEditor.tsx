import CodeEditor from "./CodeEditor";

interface StrudelEditorProps {
  code: () => string;
  onCodeChange: (code: string) => void;
  onEvaluate: () => void;
}

export default function StrudelEditor(props: StrudelEditorProps) {
  return (
    <CodeEditor
      code={props.code}
      onCodeChange={props.onCodeChange}
      onEvaluate={props.onEvaluate}
      label="Strudel"
      placeholder="// Write Strudel patterns here
// Example: note('<c a f e>(3,8)').jux(rev).play()"
    />
  );
}

