import type { ChatMessage, ChatToolCall, ProviderId } from "../../shared/ipc";
import { engine } from "../engine/engine";
import { cancelChat, chat, newRequestId } from "./client";
import { briefToText, type Brief } from "./perceive";
import { compactState, executeTool, toolDefinitions, type ToolContext } from "./tools";

/**
 * Stage 2 — Orchestrate. A tool-calling agent loop that turns the brief into
 * tracks, patches, sections, arrangement and visuals through the DAW tools.
 */

export const DEFAULT_ORCHESTRATE_MODEL: Record<string, string> = {
  openrouter: "typesafe/jev-router",
  // Until Jev is on Ditto Router, Sonnet is the strongest tool-caller reachable there.
  ditto: "anthropic/claude-sonnet-5.5",
  "claude-code": "anthropic/claude-sonnet-5.5",
  ollama: "",
};

export interface RunEvent {
  type: "status" | "tool_call" | "tool_result" | "assistant" | "error" | "done";
  text: string;
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
}

export interface RunHandle {
  cancelled: boolean;
  requestId?: string;
  cancel(): void;
}

const SYSTEM = `You are OmniSynth's producer agent: an expert electronic musician and sound designer operating a DAW through tools.
You build real, playable music: step-sequenced tracks on Tone.js synthesizers, custom patches, sections and an arrangement, plus a Hydra visual.

Craft rules:
- Work from the brief. Honor its tempo/key, and translate its sound palette into concrete patches (create_patch) before using them.
- Build layer by layer: drums first (kick, snare/clap, hats as separate tracks), then bass, then chords/pads, then leads/texture. Call add_track once per layer.
- Patterns: 16 steps of 16n = 1 bar in 4/4. Drums use {"hit":true}; melodic tracks use note names in the song key. Bass octaves 1-2, chords 3-4, leads 4-5. Vary velocities 0.55-1.0 for groove; leave rests.
- Avoid mud: one sub/bass element, pads at -12 dB or lower, hats -10 to -14 dB, kick around -4 to -6 dB.
- Use generate_pattern / mutate_pattern for evolving material instead of hand-writing every long pattern.
- Structure: create at least intro, build/drop (or A/B), and a break when the brief's energy curve asks for it; set_section_pattern for variation; set_arrangement to order them.
- Visuals: one set_visuals call using the brief's visual palette and motion, reactive to a.fft.
- Never remove tracks the artist did not ask to remove when iterating on an existing song.
- Keep going until the song is complete, then call done with a short summary for the artist. Do not reply with prose before done.`;

function buildMessages(brief: Brief | null, prompt: string): ChatMessage[] {
  const state = compactState(engine.getState());
  const briefText = brief ? `CREATIVE BRIEF\n${briefToText(brief)}` : "";
  const user = [prompt.trim() ? `ARTIST PROMPT\n${prompt.trim()}` : "", briefText, `CURRENT SONG STATE\n${JSON.stringify(state)}`].filter(Boolean).join("\n\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

function parseArgs(call: ChatToolCall): Record<string, unknown> {
  try {
    return call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  } catch {
    return { __parse_error: call.function.arguments };
  }
}

export function createRunHandle(): RunHandle {
  const handle: RunHandle = {
    cancelled: false,
    requestId: undefined,
    cancel() {
      handle.cancelled = true;
      if (handle.requestId) void cancelChat(handle.requestId);
    },
  };
  return handle;
}

export async function orchestrate(opts: {
  provider: ProviderId;
  model: string;
  prompt: string;
  brief: Brief | null;
  ctx: ToolContext;
  onEvent: (e: RunEvent) => void;
  handle: RunHandle;
  maxTurns?: number;
}): Promise<string> {
  const { onEvent, handle } = opts;
  const messages = buildMessages(opts.brief, opts.prompt);
  const tools = toolDefinitions();
  const maxTurns = opts.maxTurns ?? 40;
  let noToolTurns = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (handle.cancelled) throw new Error("cancelled");
    onEvent({ type: "status", text: turn === 0 ? "Thinking…" : `Working… (${turn})` });
    const requestId = newRequestId();
    handle.requestId = requestId;
    // Patch ids created mid-run must appear in the instrument enum for the next call.
    const res = await chat({
      provider: opts.provider,
      model: opts.model,
      messages,
      tools: toolDefinitions(),
      tool_choice: "auto",
      requestId,
    }).catch((err: unknown) => {
      if (handle.cancelled) throw new Error("cancelled");
      throw err;
    });
    void tools;
    const msg = res.message;
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      const text = typeof msg.content === "string" ? msg.content : "";
      noToolTurns++;
      if (text.trim()) onEvent({ type: "assistant", text });
      // Nudge models that stop early; give up after two consecutive prose-only turns.
      if (noToolTurns >= 2 || engine.tracks.size === 0 && turn > 3) return text || "Done.";
      messages.push({ role: "user", content: "Continue building with tools. When finished call done." });
      continue;
    }
    noToolTurns = 0;

      let turnFailed = false;
      let doneResult: string | undefined;
      for (const call of calls) {
        if (handle.cancelled) throw new Error("cancelled");
        const name = call.function.name;
        const args = parseArgs(call);
        onEvent({ type: "tool_call", text: describeCall(name, args), tool: name, args });
        let result: string;
        let ok = true;
        try {
          result = "__parse_error" in args ? `Error: arguments were not valid JSON: ${String(args.__parse_error).slice(0, 200)}` : await executeTool(name, args, opts.ctx);
          ok = !result.startsWith("Error");
        } catch (err) {
          result = `Error: ${(err as Error).message}`;
          ok = false;
        }
        onEvent({ type: "tool_result", text: result.length > 400 ? `${result.slice(0, 400)}…` : result, tool: name, ok });
        messages.push({ role: "tool", tool_call_id: call.id, name, content: result });
        if (!ok) turnFailed = true;
        if (name === "done" && ok) doneResult = result;
      }
      if (doneResult !== undefined && !turnFailed) {
        onEvent({ type: "done", text: doneResult });
        return doneResult;
      }
  }
  return "Reached the turn limit; the song may be incomplete.";
}

export function describeCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "add_track":
      return `add_track ${args.id} · ${args.instrument}`;
    case "update_track":
      return `update_track ${args.id}${args.instrument ? ` → ${args.instrument}` : ""}`;
    case "create_patch":
      return `create_patch ${args.id} (${args.type})`;
    case "set_bpm":
      return `set_bpm ${args.bpm}`;
    case "set_key":
      return `set_key ${args.key} ${args.scale}`;
    case "create_section":
      return `create_section ${args.id} · ${args.bars} bars`;
    case "set_section_pattern":
      return `set_section_pattern ${args.section_id}/${args.track_id}`;
    case "set_arrangement":
      return `set_arrangement ${typeof args.sections === "string" ? args.sections : JSON.stringify(args.sections)}`;
    case "mutate_pattern":
      return `mutate_pattern ${args.track_id} · ${args.mutation}`;
    case "generate_pattern":
      return `generate_pattern ${args.type}`;
    case "set_visuals":
      return `set_visuals${args.note ? ` · ${args.note}` : ""}`;
    default:
      return name;
  }
}
