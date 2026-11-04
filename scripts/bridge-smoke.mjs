#!/usr/bin/env node
/**
 * Smoke-test the OmniSynth bridge from outside the app, the way Ditto Desktop
 * will use it: discovery file → health → auth → tools → tool call → MCP.
 *
 *   node scripts/bridge-smoke.mjs            # expects OmniSynth running
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "OmniSynth", "bridge.json")
    : process.platform === "win32"
      ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "OmniSynth", "bridge.json")
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "omnisynth", "bridge.json");
const info = JSON.parse(readFileSync(file, "utf8"));
const base = `http://127.0.0.1:${info.port}`;
const auth = { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" };
const step = (name, ok, detail = "") => console.log(`${ok ? "ok " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  step(name, ok, detail);
};

const health = await (await fetch(`${base}/health`)).json();
check("health", health.ok === true, `v${health.version} pid ${health.pid}`);

const unauth = await fetch(`${base}/tools`);
check("rejects missing token", unauth.status === 401);

const badOrigin = await fetch(`${base}/tools`, { headers: { ...auth, Origin: "https://evil.example" } });
check("rejects browser origin", badOrigin.status === 403);

const tools = await (await fetch(`${base}/tools`, { headers: auth })).json();
check("lists tools", Array.isArray(tools) && tools.length > 20, `${tools.length} tools`);

const bpm = await (await fetch(`${base}/tools/set_bpm`, { method: "POST", headers: auth, body: JSON.stringify({ bpm: 126 }) })).json();
check("set_bpm", bpm.ok === true, bpm.result);

try {
  const track = await (
    await fetch(`${base}/tools/add_track`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ id: "bridge-kick", name: "Bridge Kick", instrument: "kick", volume: -5, subdivision: "16n", notes: "[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]" }),
    })
  ).json();
  check("add_track", track.ok === true, track.result);

  const bad = await (await fetch(`${base}/tools/add_track`, { method: "POST", headers: auth, body: JSON.stringify({ id: "x", name: "x", instrument: "nope", subdivision: "16n", notes: "[1]" }) })).json();
  check("tool error surfaces", bad.ok === false, String(bad.error).slice(0, 60));

  const state = await (await fetch(`${base}/state`, { headers: auth })).json();
  check("state", state.bpm === 126 && state.tracks.some((t) => t.id === "bridge-kick"), `bpm ${state.bpm}, ${state.tracks.length} tracks`);

  const rpc = async (method, params, id = 1) => (await fetch(`${base}/mcp`, { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) })).json();
  const init = await rpc("initialize", {});
  check("mcp initialize", init.result?.serverInfo?.name === "omnisynth", init.result?.protocolVersion);
  const list = await rpc("tools/list", {}, 2);
  check("mcp tools/list", list.result?.tools?.[0]?.name === "omnisynth_generate", `${list.result?.tools?.length} tools`);
  const call = await rpc("tools/call", { name: "get_state", arguments: {} }, 3);
  check("mcp tools/call", call.result?.isError === false && call.result?.content?.[0]?.text?.includes("bridge-kick"));
  const missing = await rpc("tools/call", { name: "does_not_exist", arguments: {} }, 4);
  check("mcp unknown tool is an error result", missing.result?.isError === true);
} finally {
    try {
      const response = await fetch(`${base}/tools/remove_track`, { method: "POST", headers: auth, body: JSON.stringify({ id: "bridge-kick" }) });
      const cleanup = await response.json();
      check("remove_track", response.ok && cleanup.ok === true, String(cleanup.error ?? response.status));
    } catch (error) {
      check("remove_track", false, String(error));
    }
}

if (process.argv.includes("--generate")) {
  console.log("generate… (this calls the LLM and may take minutes)");
  const gen = await (await fetch(`${base}/generate`, { method: "POST", headers: auth, body: JSON.stringify({ prompt: "A 2-bar 128 BPM minimal techno loop: kick, offbeat hat, one dark stab. Keep it to 3 tracks.", mode: "new", source: "bridge-smoke" }) })).json();
  check("generate", gen.ok === true, String(gen.summary ?? gen.error).slice(0, 120));
}

console.log(failures ? `\n${failures} failure(s)` : "\nall bridge checks passed");
process.exit(failures ? 1 : 0);
