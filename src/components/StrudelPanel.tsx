import { strudel, DEFAULT_STRUDEL } from "../engine/strudel";
import { store } from "../stores/app";
import CodeEditor from "./CodeEditor";

export default function StrudelPanel() {
  const run = () => void strudel.evaluate().catch((error) => store.showToast(error.message));
  return <section class="panel strudel-panel" data-testid="strudel-panel">
    <div class="panel-head">
      <h2>Strudel</h2>
      <span class="muted">Live code · upstream Strudel 1.3 · Tone tracks are preserved</span>
      <span class="spacer" />
      <button onClick={() => strudel.setCode(DEFAULT_STRUDEL)}>Synth demo</button>
      <button class="btn-primary small" onClick={run} data-testid="strudel-evaluate">Evaluate & play ⌘↵</button>
        <button onClick={() => void strudel.stop().catch((error) => store.showToast(error.message))} data-testid="strudel-stop">Stop</button>
    </div>
    <div class="strudel-editor"><CodeEditor label="Strudel code" code={strudel.code} onCodeChange={(value) => {
      try { strudel.setCode(value); }
      catch (error) { store.showToast((error as Error).message); }
    }} onEvaluate={run} /></div>
    <div class="strudel-status" role="status" data-testid="strudel-status">
      {strudel.status().error || `${strudel.status().playing ? "Playing" : "Stopped"} · ${strudel.status().events} events/cycle · RMS ${strudel.status().rms.toFixed(3)} · audio ${strudel.status().audioContext}`}
    </div>
    <p class="muted tiny">Synth demo works without samples. Load public HTTPS sample banks with samples(). Drafts are saved locally; Generate shares project context with your chosen producer. Switching engines stops playback.</p>
  </section>;
}
