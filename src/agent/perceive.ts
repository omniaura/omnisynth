import type { Attachment, ChatMessage, ChatMessageContent, ProviderId } from "../../shared/ipc";
import { chat, newRequestId } from "./client";

/**
 * Stage 1 — Perceive. A cheap multimodal model turns the artist's prompt plus
 * attached images / audio / text into a structured creative brief. The brief
 * is editable in the UI before it drives the orchestrator.
 */

export interface Brief {
  title: string;
  mood: string[];
  genre: string[];
  references: string[];
  bpm: number;
  key: string;
  scale: string;
  energy_curve: string;
  sound_palette: string[];
  rhythm: string;
  visual_palette: string[];
  visual_motion: string;
  notes: string;
}

export const DEFAULT_PERCEIVE_MODEL: Record<string, string> = {
  openrouter: "google/gemini-3.5-flash-lite",
  ditto: "google/gemini-3.5-flash-lite",
  ollama: "",
};

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    mood: { type: "array", items: { type: "string" } },
    genre: { type: "array", items: { type: "string" } },
    references: { type: "array", items: { type: "string" }, description: "Artists/tracks/scenes this evokes" },
    bpm: { type: "number" },
    key: { type: "string", description: "Root note like F# or Eb" },
    scale: { type: "string", description: "minor, major, dorian, phrygian, lydian, mixolydian, pentatonic, minor-pentatonic, blues, harmonic_minor, whole_tone" },
    energy_curve: { type: "string", description: "How the piece should move: e.g. 'slow build, hard drop at 1:00, eerie break, final drop'" },
    sound_palette: { type: "array", items: { type: "string" }, description: "Concrete synthesis language: 'detuned saw stabs', 'rubbery 303 acid', 'tape-saturated kick'" },
    rhythm: { type: "string", description: "Groove: swing, syncopation, breakbeat/four-on-the-floor/half-time, hat density" },
    visual_palette: { type: "array", items: { type: "string" }, description: "3-5 colors as words or hex pulled from the images" },
    visual_motion: { type: "string", description: "Motion/texture language for visuals" },
    notes: { type: "string", description: "Anything else the producer must honor" },
  },
  required: ["title", "mood", "genre", "references", "bpm", "key", "scale", "energy_curve", "sound_palette", "rhythm", "visual_palette", "visual_motion", "notes"],
  additionalProperties: false,
};

const SYSTEM = `You are the perception stage of OmniSynth, an LLM-native DAW for electronic music (think Aphex Twin, Autechre, Four Tet, Skrillex, Burial — any EDM/IDM lineage).
You receive a prompt and possibly images, audio clips and text. Listen and look carefully:
- From audio: estimate tempo, key, groove, timbres, arrangement, production style.
- From images: extract mood, era, color palette, texture, motion.
- From text/lyrics/notes: constraints, references, story.
Return ONLY a JSON object matching the schema. Be specific and musical — a producer will build the track from this brief using synthesizers, step sequencers and effects. Prefer concrete synthesis language over adjectives.`;

function attachmentParts(attachments: Attachment[]): { parts: ChatMessageContent[]; textNotes: string[] } {
  const parts: ChatMessageContent[] = [];
  const textNotes: string[] = [];
  for (const a of attachments) {
    if (a.kind === "image") parts.push({ type: "image_url", image_url: { url: `data:${a.mime};base64,${a.data}`, detail: "low" } });
    else if (a.kind === "audio") {
      const format = a.mime.includes("wav") ? "wav" : "mp3";
      parts.push({ type: "input_audio", input_audio: { data: a.data, format } });
    } else textNotes.push(`--- ${a.name} ---\n${a.data.slice(0, 6000)}`);
  }
  return { parts, textNotes };
}

export async function perceive(opts: { provider: ProviderId; model: string; prompt: string; attachments: Attachment[]; signal?: { cancelled: boolean; requestId?: string } }): Promise<Brief> {
  const { parts, textNotes } = attachmentParts(opts.attachments);
  const text = [opts.prompt.trim() || "(no prompt — infer everything from the attachments)", ...textNotes].join("\n\n");
  const content: ChatMessageContent[] = [{ type: "text", text }, ...parts];
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content },
  ];
  const requestId = newRequestId();
  if (opts.signal) opts.signal.requestId = requestId;

  let res;
  try {
    res = await chat({ provider: opts.provider, model: opts.model, messages, temperature: 0.4, requestId, response_format: { type: "json_schema", json_schema: { name: "brief", strict: true, schema: BRIEF_SCHEMA } } });
  } catch (err) {
    // Some gateways reject json_schema; retry with plain JSON mode and a schema hint.
    if (!/response_format|json_schema|schema/i.test(String(err))) throw err;
    messages[0].content += `\n\nJSON schema:\n${JSON.stringify(BRIEF_SCHEMA)}`;
    res = await chat({ provider: opts.provider, model: opts.model, messages, temperature: 0.4, requestId, response_format: { type: "json_object" } });
  }
  const raw = typeof res.message.content === "string" ? res.message.content : (res.message.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
  return parseBrief(raw);
}

export function parseBrief(raw: string): Brief {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("perceive: model returned no JSON");
  const obj = JSON.parse(match[0]) as Partial<Brief>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);
  return {
    title: String(obj.title ?? "Untitled"),
    mood: arr(obj.mood),
    genre: arr(obj.genre),
    references: arr(obj.references),
    bpm: Number(obj.bpm) || 128,
    key: String(obj.key ?? "C"),
    scale: String(obj.scale ?? "minor"),
    energy_curve: String(obj.energy_curve ?? ""),
    sound_palette: arr(obj.sound_palette),
    rhythm: String(obj.rhythm ?? ""),
    visual_palette: arr(obj.visual_palette),
    visual_motion: String(obj.visual_motion ?? ""),
    notes: String(obj.notes ?? ""),
  };
}

export function briefToText(b: Brief): string {
  return [
    `Title: ${b.title}`,
    `Mood: ${b.mood.join(", ")}`,
    `Genre: ${b.genre.join(", ")}`,
    b.references.length ? `References: ${b.references.join(", ")}` : "",
    `Tempo: ${b.bpm} BPM · Key: ${b.key} ${b.scale}`,
    `Energy: ${b.energy_curve}`,
    `Rhythm: ${b.rhythm}`,
    `Sound palette: ${b.sound_palette.join("; ")}`,
    `Visual palette: ${b.visual_palette.join(", ")} · Motion: ${b.visual_motion}`,
    b.notes ? `Notes: ${b.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
