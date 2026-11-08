import type { BridgeCall, BridgeGenerateArgs } from "../../shared/ipc";
import { bridge as desktopBridge } from "../agent/client";
import { compactState, executeTool, toolDefinitions } from "../agent/tools";
import { engine } from "../engine/engine";
import { store } from "../stores/app";
import { runGenerate } from "./run";
import { toolContext } from "./songs";

const privateHistoryTool = (name: string) => name === "search_conversation_history" || name === "read_conversation_turn";

/**
 * Renderer side of the OmniSynth bridge: executes requests that arrive from
 * other local apps (Ditto Desktop) through the main process, and accepts
 * omnisynth://generate deep links.
 */

async function generate(args: BridgeGenerateArgs): Promise<{ summary: string; state: Record<string, unknown> }> {
  await engine.init();
  if (store.running() !== "idle") throw new Error("OmniSynth is already generating; try again when the current run finishes.");
  if (!args.prompt.trim() && !(args.attachments?.length)) {
    throw new Error("A prompt or attachment is required.");
  }
  if (args.mode === "new") {
    if (engine.tracks.size > 0 && !window.confirm("Start a new song and discard the current one?")) {
      return { summary: "Cancelled.", state: compactState(engine.getState()) };
    }
    engine.clear();
    store.setBrief(null);
  }
  const result = await runGenerate({ prompt: args.prompt, attachments: args.attachments ?? [], source: typeof args.source === "string" ? args.source : undefined });
  if (result.status === "error") throw new Error(result.summary);
  return { summary: result.summary, state: compactState(engine.getState()) };
}

export function installBridgeHandlers(): () => void {
  const b = desktopBridge();
  if (!b) return () => {};
  const offCall = b.bridge.onCall(async (call: BridgeCall) => {
    switch (call.kind) {
      case "tools":
        return toolDefinitions().filter((t) => !privateHistoryTool(t.function.name)).map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters }));
      case "state":
        await engine.init();
        return compactState(engine.getState());
      case "tool": {
        if (privateHistoryTool(call.name ?? "")) throw new Error("Conversation history is private to the local Producer chat.");
        await engine.init();
        const result = await executeTool(call.name ?? "", (call.args as Record<string, unknown>) ?? {}, toolContext);
        if (result.startsWith("Error")) throw new Error(result.replace(/^Error:?\s*/, ""));
        if (store.running() === "idle") {
          store.pushLog({ type: "tool_call", text: `${call.name} (via bridge)`, tool: call.name });
          store.pushLog({ type: "tool_result", text: result.length > 300 ? `${result.slice(0, 300)}…` : result, tool: call.name, ok: true });
        }
        return result;
      }
      case "generate": {
        const args = call.args;
        if (args === null || typeof args !== "object" || !("prompt" in args) || typeof args.prompt !== "string") {
          throw new Error("generate requires a string prompt");
        }
        return generate(args as BridgeGenerateArgs);
      }
      default:
        throw new Error(`unknown bridge call ${(call as { kind: string }).kind}`);
    }
  });
  const offGenerate = b.bridge.onGenerateRequest((args) => {
    store.setComposerOpen(true);
    void generate(args).catch((err) => store.showToast((err as Error).message));
  });
  return () => {
    offCall();
    offGenerate();
  };
}
