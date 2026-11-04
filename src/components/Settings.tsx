import { For, Show, createResource, createSignal } from "solid-js";
import type { DittoDeviceCode, DittoStatus, ModelInfo, ProviderId } from "../../shared/ipc";
import { store } from "../stores/app";
import { bridge, isDesktop, listModels } from "../agent/client";
import { refreshProviders } from "../lib/run";

/**
 * Inference settings: Sign in with Ditto (device flow) and endpoint
 * provisioning, OpenRouter key, detected local coding agents / Ollama, and the
 * per-stage model choice (Perceive / Orchestrate).
 */

const STAGE_HELP: Record<"perceive" | "orchestrate", string> = {
  perceive: "Cheap multimodal model that reads your images/audio/text into a brief. Gemini Flash-Lite class works well.",
  orchestrate: "The producer agent that calls DAW tools. Jev (typesafe/jev-router) via OpenRouter is the reference; any tool-calling model works.",
};

function DittoCard() {
  const b = bridge();
  const [status, { refetch }] = createResource<DittoStatus | undefined>(async () => b?.ditto.status());
  const [credits, { refetch: refetchCredits }] = createResource(status, async (s) => {
    const c = s?.loggedIn ? (await b?.ditto.credits()) ?? null : null;
    store.setCredits(c);
    return c;
  });
  const sourceLabel = () => {
    switch (status()?.source) {
      case "cli":
        return " via heyditto CLI";
      case "ditto-desktop":
        return " via Ditto Desktop";
      case "env":
        return " via environment";
      default:
        return "";
    }
  };
  const [code, setCode] = createSignal<DittoDeviceCode | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [err, setErr] = createSignal<string | null>(null);

  async function signIn(): Promise<void> {
    if (!b) return;
    setErr(null);
    setBusy("Waiting for browser approval…");
    try {
      const res = await b.ditto.login((c) => setCode(c));
      if (!res.ok) setErr(res.error ?? "login failed");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setCode(null);
    }
    await refetch();
    await refreshProviders();
  }

  async function createEndpoint(): Promise<void> {
    if (!b) return;
    setErr(null);
    setBusy("Creating your OmniSynth endpoint…");
    try {
      await b.ditto.createEndpoint();
      store.updateSettings({ orchestrateProvider: "ditto", perceiveProvider: "ditto" });
      store.showToast("Ditto Router endpoint ready");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
    await refetch();
    await refreshProviders();
  }

  async function signOut(): Promise<void> {
    setErr(null);
    try {
      await b?.ditto.logout();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    await refetch();
    await refreshProviders();
  }
  }

  return (
    <div class="card" data-testid="ditto-card">
      <div class="card-head">
        <h3>Ditto</h3>
        <Show when={status()?.loggedIn} fallback={<span class="badge">signed out</span>}>
          <span class="badge ok">signed in{sourceLabel()}</span>
        </Show>
      </div>
      <p class="muted">Use your Ditto account's inference. Sign in opens your browser; then one click creates a Ditto Router endpoint that powers OmniSynth.</p>
      <Show when={credits()}>
        {(c) => (
          <div class="credits" data-testid="credits">
            <span class="credits-balance">
              {c().balance === null ? "—" : `${c().currency === "USD" ? "$" : ""}${c().balance!.toFixed(2)}${c().currency === "USD" ? "" : ` ${c().currency}`}`}
            </span>
            <span class="muted tiny">
              {c().billingMode === "byok" ? "your provider keys" : "Ditto credits"}
              {c().label ? ` · ${c().label}` : ""}
            </span>
            <div class="spacer" />
            <Show when={c().topUpUrl}>
              <button class="btn-ghost small" onClick={() => void b?.shell.openExternal(c().topUpUrl!)}>
                Top up
              </button>
            </Show>
            <button class="btn-ghost small" onClick={() => void refetchCredits()} title="Refresh">
              ↻
            </button>
          </div>
        )}
      </Show>
      <div class="row budget-row">
        <span class="muted tiny">Budget per run</span>
        <For each={["frugal", "balanced", "lavish"] as const}>
          {(tier) => (
            <button class={`chip ${store.settings.budget === tier ? "on" : ""}`} onClick={() => store.updateSettings({ budget: tier })} title={tier === "frugal" ? "Cheapest models, short runs" : tier === "balanced" ? "Sonnet-class, full arrangement" : "Opus/Jev, long evolving runs"}>
              {tier}
            </button>
          )}
        </For>
        <span class="muted tiny">balance clamps it down automatically</span>
      </div>
      <Show when={status()?.dittoDesktop.installed}>
        <div class="row">
          <span class="badge tiny ok">Ditto Desktop detected</span>
          <span class="muted tiny">
            {status()?.dittoDesktop.linked ? "its linked Ditto account can power OmniSynth; OmniSynth tools appear in Ditto Desktop chats while this app is open." : "sign in there or here — the session is shared; OmniSynth tools appear in Ditto Desktop chats while this app is open."}
          </span>
        </div>
      </Show>
      <Show when={code()}>
        {(c) => (
          <div class="device-code">
            <span>Enter this code in the browser:</span>
            <strong>{c().user_code}</strong>
            <button class="btn-ghost small" onClick={() => void b?.shell.openExternal(c().verification_url)}>
              Open page
            </button>
          </div>
        )}
      </Show>
      <Show when={busy()}>
        <div class="status-line">
          <span class="spinner" />
          {busy()}
        </div>
      </Show>
      <Show when={err()}>
        <div class="error">{err()}</div>
      </Show>
      <div class="row">
        <Show when={!status()?.loggedIn}>
          <button class="btn-primary" onClick={() => void signIn()} disabled={Boolean(busy())} data-testid="ditto-signin">
            Sign in with Ditto
          </button>
        </Show>
        <Show when={status()?.loggedIn}>
          <Show when={!status()?.hasEndpointKey} fallback={<span class="muted">Endpoint: {status()?.endpoint?.slug} · {status()?.endpoint?.model}</span>}>
            <button class="btn-primary" onClick={() => void createEndpoint()} disabled={Boolean(busy())} data-testid="ditto-create-endpoint">
              Create Ditto Router endpoint
            </button>
          </Show>
          <Show when={status()?.hasEndpointKey}>
            <button class="btn-ghost small" onClick={() => void createEndpoint()} disabled={Boolean(busy())}>
              Re-mint key
            </button>
          </Show>
          <button class="btn-ghost small" onClick={() => void signOut()}>
            Sign out
          </button>
        </Show>
      </div>
      <p class="muted tiny">Jev isn't on Ditto Router yet, so the endpoint defaults to Claude Sonnet in passthrough mode; pick any router model per stage above. Use OpenRouter for Jev.</p>
    </div>
  );
}

function KeyCard(props: { provider: ProviderId; title: string; placeholder: string; help: string }) {
  const [val, setVal] = createSignal("");
  const info = () => store.providers().find((p) => p.id === props.provider);
  async function save(): Promise<void> {
    const b = bridge();
    try {
      const key = val().trim();
      if (b) await b.providers.setKey(props.provider, key);
      else localStorage.setItem(`omnisynth.browserKey.${props.provider}`, key);
    } catch (e) {
      store.showToast(`Saving ${props.title} key failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setVal("");
    await refreshProviders();
    store.showToast(`${props.title} key saved`);
  }
  async function clear(): Promise<void> {
    const b = bridge();
    try {
      if (b) await b.providers.clearKey(props.provider);
      else localStorage.removeItem(`omnisynth.browserKey.${props.provider}`);
    } catch (e) {
      store.showToast(`Clearing ${props.title} key failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    await refreshProviders();
  }
  return (
    <div class="card">
      <div class="card-head">
        <h3>{props.title}</h3>
        <span class={`badge ${info()?.authenticated ? "ok" : ""}`}>{info()?.authenticated ? info()?.source ?? "connected" : "not connected"}</span>
      </div>
      <p class="muted">{props.help}</p>
      <div class="row">
        <input type="password" placeholder={props.placeholder} value={val()} onInput={(e) => setVal(e.currentTarget.value)} data-testid={`${props.provider}-key`} />
        <button class="btn-primary small" onClick={() => void save()} disabled={!val().trim()}>
          Save
        </button>
        <Show when={info()?.authenticated}>
          <button class="btn-ghost small" onClick={() => void clear()}>
            Clear
          </button>
        </Show>
      </div>
    </div>
  );
}

function StagePicker(props: { stage: "perceive" | "orchestrate" }) {
  const providerKey = props.stage === "perceive" ? "perceiveProvider" : "orchestrateProvider";
  const modelKey = props.stage === "perceive" ? "perceiveModel" : "orchestrateModel";
  const providerId = () => store.settings[providerKey];
  const [models] = createResource(providerId, async (id): Promise<ModelInfo[]> => {
    try {
      const list = await listModels(id);
      if (props.stage === "perceive") return list.filter((m) => !m.inputModalities || m.inputModalities.includes("image") || m.inputModalities.includes("audio"));
      return list;
    } catch {
      return [];
    }
  });
  const authenticated = () => store.providers().filter((p) => p.authenticated);

  return (
    <div class="stage">
      <div class="stage-head">
        <h4>{props.stage === "perceive" ? "1 · Perceive" : "2 · Orchestrate"}</h4>
        <Show when={props.stage === "perceive"}>
          <label class="check">
            <input type="checkbox" checked={store.settings.skipPerceive} onChange={(e) => store.updateSettings({ skipPerceive: e.currentTarget.checked })} />
            skip (send prompt straight to the producer)
          </label>
        </Show>
      </div>
      <p class="muted tiny">{STAGE_HELP[props.stage]}</p>
      <div class="row">
        <select value={providerId()} onChange={(e) => store.updateSettings({ [providerKey]: e.currentTarget.value as ProviderId, [modelKey]: "", autoProvider: false })} data-testid={`${props.stage}-provider`}>
          <For each={store.providers()}>
            {(p) => (
              <option value={p.id} disabled={!p.authenticated}>
                {p.label}
                {p.authenticated ? "" : " (not connected)"}
              </option>
            )}
          </For>
        </select>
        <input
          list={`models-${props.stage}`}
          placeholder={authenticated().find((p) => p.id === providerId())?.defaultModel || (providerId() === "ditto" ? "endpoint's model" : props.stage === "orchestrate" ? "typesafe/jev-router" : "google/gemini-3.5-flash-lite")}
          value={store.settings[modelKey]}
          onChange={(e) => store.updateSettings({ [modelKey]: e.currentTarget.value.trim() })}
          data-testid={`${props.stage}-model`}
        />
        <datalist id={`models-${props.stage}`}>
          <For each={models() ?? []}>{(m) => <option value={m.id}>{m.name ?? m.id}</option>}</For>
        </datalist>
      </div>
    </div>
  );
}

export default function Settings() {
  const detected = () => store.providers().filter((p) => ["claude-code", "codex", "opencode", "ollama"].includes(p.id));
  return (
    <Show when={store.settingsOpen()}>
      <div class="modal-overlay" onClick={() => store.setSettingsOpen(false)}>
        <div class="modal" onClick={(e) => e.stopPropagation()} data-testid="settings-modal">
          <div class="modal-head">
            <h2>Inference</h2>
            <button class="btn-icon" onClick={() => store.setSettingsOpen(false)} title="Close" data-testid="settings-close">
              ×
            </button>
          </div>
          <div class="modal-body">
            <section>
              <h3 class="section-title">Pipeline</h3>
              <StagePicker stage="perceive" />
              <StagePicker stage="orchestrate" />
            </section>

            <section>
              <h3 class="section-title">Providers</h3>
              <Show when={isDesktop()} fallback={<p class="muted">Running in a browser: keys are kept in localStorage. Use the desktop app for Ditto sign-in and local agent detection.</p>}>
                <DittoCard />
              </Show>
              <KeyCard provider="openrouter" title="OpenRouter" placeholder="sk-or-…" help="Needed for Jev (typesafe/jev-router) and the full OpenRouter catalog." />
              <div class="card">
                <div class="card-head">
                  <h3>On this computer</h3>
                  <button class="btn-ghost small" onClick={() => void refreshProviders()}>
                    Rescan
                  </button>
                </div>
                <p class="muted">Coding agents and local runtimes whose inference OmniSynth can reuse.</p>
                <ul class="detect-list">
                  <For each={detected()}>
                    {(p) => (
                      <li>
                        <span class={`dot ${p.authenticated ? "ok" : ""}`} />
                        <span class="detect-name">{p.label}</span>
                        <span class="muted tiny">{p.authenticated ? p.source : p.note}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Show>
  );
}
