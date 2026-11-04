import { For, Show, createEffect, onCleanup, onMount } from "solid-js";
import { conversation } from "../lib/conversation";

export default function Conversation() {
  let scroller: HTMLDivElement | undefined;
  let follow = true;
  let restoring = false;
  let frame = 0;
  onMount(() => void conversation.load());
  onCleanup(() => cancelAnimationFrame(frame));
  createEffect(() => {
    const turns = conversation.turns();
    void turns.at(-1)?.events.length;
    if (!follow || restoring) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (follow && !restoring && scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  async function older(): Promise<void> {
    if (!scroller || restoring) return;
    const anchor = scroller.querySelector<HTMLElement>("[data-turn]");
    const top = anchor?.getBoundingClientRect().top ?? 0;
    restoring = true;
    try {
      await conversation.older();
      frame = requestAnimationFrame(() => {
        if (scroller && anchor?.isConnected) scroller.scrollTop += anchor.getBoundingClientRect().top - top;
        follow = false;
        restoring = false;
      });
    } catch {
      restoring = false;
    }
  }

  return <>
    <Show when={conversation.error()}><p class="chat-save-error" role="alert">{conversation.error()}</p></Show>
    <div class="conversation" ref={scroller} role="log" aria-label="Producer conversation" aria-live="polite" data-testid="conversation" onScroll={() => {
      if (!restoring && scroller) follow = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 48;
    }}>
      <Show when={conversation.hasOlder()}><button class="btn-ghost small" onClick={() => void older()}>Earlier messages</button></Show>
      <Show when={conversation.turns().length === 0}><p class="chat-empty">Build a piece together. Ask for a sound, refine it, or talk through an idea. This conversation stays on this Mac.</p></Show>
      <For each={conversation.turns()}>{(turn) => <section class="chat-turn" data-turn={turn.id} data-testid="chat-turn">
        <div class="chat-message artist"><strong>You</strong><p>{turn.prompt || "Attached reference"}</p><Show when={turn.attachments.length}><p class="chat-attachments">{turn.attachments.map((attachment) => attachment.name).join(" · ")}</p></Show></div>
        <For each={turn.events.filter((event) => event.type === "assistant" || event.type === "done" || event.type === "error")}>
          {(event) => <div class={`chat-message producer ${event.type === "error" ? "failed" : ""}`}><strong>{event.type === "error" ? "Couldn’t finish" : "Producer"}</strong><p>{event.text}</p></div>}
        </For>
        <Show when={turn.events.some((event) => event.type === "tool_call")}><details class="chat-activity"><summary>Tool activity · {turn.events.filter((event) => event.type === "tool_call").length} calls</summary><For each={turn.events.filter((event) => event.type === "tool_call" || event.type === "tool_result")}>
          {(event) => <pre class={event.ok === false ? "failed" : ""}>{event.text}</pre>}
        </For></details></Show>
        <Show when={turn.outcome === "cancelled"}><p class="chat-interrupted">Stopped. Send another message to continue.</p></Show>
      </section>}</For>
    </div>
  </>;
}
