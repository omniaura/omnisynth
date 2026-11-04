# OmniSynth × Ditto Desktop

OmniSynth and [Ditto Desktop](https://github.com/ditto-assistant/ditto-desktop)
are two open-source desktop apps that work on their own and get better
together. This page explains what "together" means, how the pieces connect,
and what to expect as a user or as an agent.

## In one paragraph

Ditto Desktop is an agent harness control surface: you chat with Claude Code,
Codex, Cursor, Grok, OpenCode or the Ditto harness, and it gives those agents
tools (browser, devices, pull requests). OmniSynth is an LLM-native DAW. When
both are installed, Ditto Desktop detects OmniSynth and adds `omnisynth_*` tools
to every agent session, so "make me a 7/8 acid break that evolves" in a Ditto
Desktop chat becomes a job inside OmniSynth that you hear immediately. Both apps
share one Ditto sign-in, and the music is produced on your account's Ditto
Router credits.

## The three contracts

### 1. The bridge (OmniSynth → anyone local)

While OmniSynth runs it listens on a loopback port with a per-launch bearer
token and writes a discovery file:

```
macOS    ~/Library/Application Support/OmniSynth/bridge.json
Windows  %APPDATA%\OmniSynth\bridge.json
Linux    $XDG_CONFIG_HOME/omnisynth/bridge.json

{ "port": 55260, "token": "…", "pid": 90571, "version": "0.2.0",
  "appPath": "/Applications/OmniSynth.app/…", "startedAt": "…", "protocol": 1 }
```

The file is removed on quit; a stale one (crash) is detected by `/health`
failing. Nothing is reachable from other machines and browser origins are
refused, so a web page cannot drive the DAW.

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ ok, version, pid, song }` — no auth |
| `GET /tools` | the DAW tool catalog (same schemas the producer agent uses) |
| `POST /tools/:name` | run one DAW tool; `{ ok, result }` or `{ ok:false, error }` |
| `POST /generate` | `{ prompt, attachments:[{path}], mode:"new"\|"iterate", source, wait }` → `{ ok, summary, state }` |
| `GET /state` | compact song state |
| `POST /mcp` | MCP streamable-HTTP (JSON-RPC): `initialize`, `tools/list`, `tools/call`, `ping` |

Over MCP the catalog is prefixed with `omnisynth_generate`, so any MCP client
(not just Ditto Desktop) can mount OmniSynth as a tool server:

```json
{ "mcpServers": { "omnisynth": { "type": "http", "url": "http://127.0.0.1:<port>/mcp",
  "headers": { "Authorization": "Bearer <token>" } } } }
```

`omnisynth://generate?prompt=…&mode=new&source=…` opens the app (single
instance) and starts a job.

Implementation: `electron/bridge.ts` (server, main process) and
`src/lib/bridge.ts` (executor, renderer). Tool execution is forwarded over IPC
because the engine lives in the renderer. `scripts/bridge-smoke.mjs` exercises
it from outside the app.

### 2. The toolkit (Ditto Desktop → OmniSynth)

Ditto Desktop's server reads the discovery file at call time and exposes five
tools on its `t3-code` MCP server, gated by **Settings → Integrations →
OmniSynth → Agent OmniSynth access** (off by default, project-overridable):

| Tool | Does |
| --- | --- |
| `omnisynth_status` | installed? running? what's playing, the DAW catalog, and a just-in-time quick start |
| `omnisynth_generate` | whole-song Perceive→Orchestrate run from a prompt + file paths; tagged `ditto-desktop:<threadId>` |
| `omnisynth_tool` | proxy any DAW tool by name |
| `omnisynth_state` | read the song |
| `omnisynth_launch` | open OmniSynth (optionally with a prompt) when installed but closed |

Codex gets an instruction block only when the toolkit is attached (same rule as
browser/device blocks). Ditto Desktop PR: `feat/omnisynth-toolkit`.

### 3. Shared sign-in and credit (both directions)

OmniSynth's credential order for Ditto Router is: app sign-in → `DITTO_API_KEY`
→ `heyditto` CLI login → **Ditto Desktop's linked account**
(`~/.t3/userdata/secrets/ditto-account.bin`, read-only). Settings shows which
source is active. Conversely, Ditto Desktop jobs run in OmniSynth with
OmniSynth's own configured inference, so whichever app the user signed into
first covers both.

OmniSynth reads the router's credit snapshot (`GET /v1/key`) before each run
and clamps its **budget** (frugal / balanced / lavish → model tier and turn
budget) by the balance: under $1 runs frugal, under $5 never lavish. The
balance and a Top up link are shown in Settings → Ditto.

## User stories

- *"Make something like the track I just dragged into Ditto."* Attach the file
  in Ditto Desktop; the agent calls `omnisynth_generate` with its path.
  OmniSynth perceives tempo/key/energy locally, builds the song, plays it.
- *"Now make the hats evolve every 2 bars and duck the pad under the kick."*
  The agent calls `omnisynth_state`, then `omnisynth_tool` with `set_evolution`
  and `add_modulation`.
- *Working in OmniSynth, Ditto Desktop closed.* Nothing changes; OmniSynth's
  composer is the same producer agent.
- *Working in Ditto Desktop, OmniSynth closed.* `omnisynth_status` says
  "installed, not running"; `omnisynth_launch` opens it.

## Security notes

- Loopback only; random port; 24-byte random token per launch; 0600 discovery
  file; `Origin` header refused.
- Ditto Desktop's toolkit is additionally gated by its MCP credential
  capability (`omnisynth`), which the user grants in Settings.
- OmniSynth never writes into Ditto Desktop's state; it only reads the linked
  account when it has no credential of its own.
