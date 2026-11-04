import { createRoot, createSignal } from "solid-js";
import type { ChatMessage, Attachment } from "../../shared/ipc";
import type { RunEvent } from "../agent/orchestrate";

export interface ConversationTurn {
  id: string;
  at: number;
  prompt: string;
  attachments: Array<Pick<Attachment, "name" | "kind">>;
  events: RunEvent[];
  messages: ChatMessage[];
  outcome: "running" | "complete" | "cancelled" | "error";
}

let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("omnisynth-conversation", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("turns", { keyPath: "id" }).createIndex("at", "at");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

async function write(turn: ConversationTurn): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("turns", "readwrite");
    tx.objectStore("turns").put(turn);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Conversation could not be saved"));
  });
}

async function recent(before = Infinity, limit = 40): Promise<ConversationTurn[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("turns");
    const request = tx.objectStore("turns").index("at").openCursor(Number.isFinite(before) ? IDBKeyRange.upperBound(before, true) : undefined, "prev");
    const result: ConversationTurn[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) { resolve(result.reverse()); return; }
      result.push(cursor.value as ConversationTurn);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

/** Keep complete tool-call/result batches when constructing a bounded model window. */
export function completeMessages(messages: ChatMessage[]): ChatMessage[] {
  const result = messages.map((message) => ({ ...message }));
  const answered = new Set(result.filter((message) => message.role === "tool").map((message) => message.tool_call_id));
  for (let i = result.length - 1; i >= 0; i--) {
    const calls = result[i].tool_calls ?? [];
    const missing: ChatMessage[] = calls.filter((call) => !answered.has(call.id)).map((call) => ({ role: "tool", tool_call_id: call.id, name: call.function.name, content: "Not executed: the previous turn stopped before this call ran." }));
    if (missing.length) result.splice(i + 1, 0, ...missing);
  }
  return result;
}

export const conversation = createRoot(() => {
  const [turns, setTurns] = createSignal<ConversationTurn[]>([]);
  const [hasOlder, setHasOlder] = createSignal(false);
  const [error, setError] = createSignal("");
  let active: ConversationTurn | undefined;
  let writes = Promise.resolve();
  let loaded: Promise<void> | undefined;

  function persist(): void {
    if (!active) return;
    const snapshot = structuredClone(active);
    writes = writes.catch(() => undefined).then(() => write(snapshot));
    void writes.catch(() => setError("Chat history could not be saved. Keep this window open and export your song."));
    setTurns((all) => all.map((turn) => turn.id === snapshot.id ? snapshot : turn));
  }

  function load(): Promise<void> {
    return loaded ??= recent().then((all) => {
      // An interrupted turn stays visible; it is never resumed automatically.
      setTurns(all.map((turn) => turn.outcome === "running" ? { ...turn, outcome: "cancelled" as const } : turn));
      setHasOlder(all.length === 40);
    }).catch(() => { setError("Chat history could not be opened. Retry by reopening OmniSynth."); });
  }

  async function older(): Promise<void> {
    const first = turns()[0];
    if (!first) return;
    const all = await recent(first.at);
    setTurns((current) => [...all, ...current]);
    setHasOlder(all.length === 40);
  }

  async function begin(prompt: string, attachments: Attachment[]): Promise<void> {
    await load();
    const turn: ConversationTurn = { id: crypto.randomUUID(), at: Math.max(Date.now(), (turns().at(-1)?.at ?? 0) + 1), prompt, attachments: attachments.map(({ name, kind }) => ({ name, kind })), events: [], messages: [{ role: "user", content: prompt }], outcome: "running" };
    // Save the artist's input before any inference or clearing the draft.
    await write(turn);
    active = turn;
    setError("");
    setTurns((all) => [...all, turn]);
  }

  function event(event: RunEvent): void {
    if (!active) return;
    active.events = [...active.events, event];
    persist();
  }

  function messages(messages: ChatMessage[]): void {
    if (!active) return;
    active.messages = completeMessages(messages);
    persist();
  }

  async function finish(outcome: ConversationTurn["outcome"]): Promise<void> {
    if (!active) return;
    active.outcome = outcome;
    persist();
    active = undefined;
    await writes;
  }

  async function context(): Promise<ChatMessage[]> {
    const all = await recent(Infinity, 12);
    const groups = all.filter((turn) => turn.id !== active?.id).map((turn) => {
      const messages = completeMessages(turn.messages.map((message) => ({ ...message, content: message.role === "tool" && typeof message.content === "string" && message.content.length > 4000 ? message.content.slice(0, 4000) + "\n[Long result retained in local history.]" : message.content })));
      if (JSON.stringify(messages).length <= 30000) return messages;
      const response = turn.events.filter((event) => event.type === "done" || event.type === "assistant").map((event) => event.text).join("\n");
      return [{ role: "user", content: turn.prompt.slice(0, 10000) }, { role: "assistant", content: response.slice(-10000) || "This earlier turn's full tool transcript is available with read_conversation_turn: " + turn.id }] as ChatMessage[];
    });
    const kept: ChatMessage[][] = [];
    let size = 0;
    for (const group of groups.reverse()) {
      const length = JSON.stringify(group).length;
      if (size + length > 64000) break;
      kept.unshift(group);
      size += length;
    }
    return kept.flat();
  }

  async function search(query: string): Promise<string> {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return "Provide a few words from the earlier conversation.";
    const database = await db();
    const found = await new Promise<ConversationTurn[]>((resolve, reject) => {
      const request = database.transaction("turns").objectStore("turns").index("at").openCursor(null, "prev");
      const matches: ConversationTurn[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || matches.length >= 8) { resolve(matches); return; }
        const turn = cursor.value as ConversationTurn;
        const text = JSON.stringify([turn.prompt, turn.messages]).toLowerCase();
        if (turn.id !== active?.id && words.every((word) => text.includes(word))) matches.push(turn);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return JSON.stringify(found.map((turn) => ({ id: turn.id, prompt: turn.prompt.slice(0, 4000), response: turn.events.filter((event) => event.type === "assistant" || event.type === "done").map((event) => event.text).join("\n").slice(-4000) })));
  }

  async function read(id: string): Promise<string> {
    const database = await db();
    const turn = await new Promise<ConversationTurn | undefined>((resolve, reject) => {
      const request = database.transaction("turns").objectStore("turns").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return turn ? JSON.stringify({ prompt: turn.prompt, messages: turn.messages }).slice(0, 24000) : "No conversation turn with that id.";
  }

  return { turns, hasOlder, error, load, older, begin, event, messages, finish, context, search, read };
});
