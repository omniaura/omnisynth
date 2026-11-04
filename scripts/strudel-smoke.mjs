import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const out = resolve(process.argv[2] || ".tmp/strudel-qa");
mkdirSync(out, { recursive: true });
const profile = join(out, "profile");
const env = Object.fromEntries(["PATH", "DISPLAY", "XAUTHORITY", "TMPDIR", "PULSE_SERVER", "ALSA_CONFIG_PATH", "LP_NUM_THREADS"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, { HOME: join(out, "home"), XDG_CONFIG_HOME: join(out, "home/.config"), SHELL: "/bin/sh", OMNISYNTH_QA_USER_DATA_DIR: profile });
let app;
try {
  app = await electron.launch({ args: ["--no-sandbox", "."], env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (value) => errors.push(value.message));
  await page.getByTestId("app").waitFor();
  const info = JSON.parse(readFileSync(join(profile, "bridge.json"), "utf8"));
  const headers = { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" };
  const base = `http://127.0.0.1:${info.port}`;
  const tool = async (name, args = {}) => {
    const response = await fetch(base + "/tools/" + name, { method: "POST", headers, body: JSON.stringify(args) });
    const value = await response.json();
    if (!value.ok) throw new Error(value.error);
    return value.result;
  };
  const state = async () => (await fetch(base + "/state", { headers })).json();
  await tool("add_track", { id: "tone-retained", name: "Retained Tone", instrument: "synth", subdivision: "16n", notes: '["C3",null,"Eb3",null]', volume: -18 });
  await tool("automate_param", { id: "preserved-automation", path: "tone-retained.volume", from: -18, to: -12, bars: 8 });
  await page.getByTestId("music-engine").selectOption("strudel");
  await page.getByTestId("strudel-panel").waitFor();
  await assert.rejects(tool("evaluate_strudel", { code: "stack(" }));
  await page.getByTestId("strudel-status").filter({ hasText: /error|unexpected|token|expression|syntax/i }).waitFor();
  const code = 'setcpm(30); stack(s("sbd*4").gain(0.4), note("c3 eb3 g3 bb3").s("sine").gain(0.2))';
  const result = JSON.parse(await tool("evaluate_strudel", { code }));
  assert.equal(result.playing, true);
  assert.ok(result.events > 0);
  let active;
  for (let i = 0; i < 100; i++) {
    active = await state();
    if (active.strudel.rms > 0.005) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(active.strudel.rms > 0.005, "Strudel analyser stayed silent");
  assert.equal(active.strudel.audioContext, "running");
  assert.equal(active.playing, false, "Tone transport must stop during Strudel");
  assert.ok(active.tracks.some((track) => track.id === "tone-retained"));
  const frame = page.frames().find((candidate) => candidate.url().includes("/strudel/index.html"));
  assert.ok(frame);
  assert.deepEqual(await frame.evaluate(() => {
    let parentBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    return { parentBlocked, privilegedBridgeAbsent: typeof window.omnisynth === "undefined" };
  }), { parentBlocked: true, privilegedBridgeAbsent: true });
  // Save/load must retain both projects without auto-playing imported code.
  const key = (await tool("save_song", { name: "Strudel coexistence QA" })).match(/Saved as (.*)\./)[1];
  await tool("load_song", { key });
  const restored = await state();
  assert.equal(restored.strudel.code, code);
  assert.equal(restored.strudel.playing, false);
  assert.ok(restored.tracks.some((track) => track.id === "tone-retained"));
  assert.ok(restored.automations.some((automation) => automation.startsWith("preserved-automation:")));
  await page.evaluate(async (code) => {
    const api = window.__omnisynth;
    await Promise.allSettled([api.tools("evaluate_strudel", { code }), api.tools("stop", {})]);
  }, code);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await state()).strudel.playing, false, "A pending evaluation restarted playback after Stop");
  await tool("evaluate_strudel", { code });
  writeFileSync(join(out, "audio-active"), "ready");
  await new Promise((resolve) => setTimeout(resolve, 4000));
  await page.screenshot({ path: join(out, "strudel.png") });
  await tool("stop");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await state()).strudel.playing, false);
  await page.getByTestId("music-engine").selectOption("tone");
  const tone = await state();
  assert.equal(tone.musicEngine, "tone");
  assert.ok(tone.tracks.some((track) => track.id === "tone-retained"));
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "proof.json"), JSON.stringify({ passed: true, active, tonePreserved: true, checks: ["agent evaluation", "syntax error recovery", "measured audio", "cross-origin isolation", "no preload in frame", "Tone transport stopped", "Tone tracks preserved", "project save/load", "engine switch", "stop"], limitations: ["Direct protocol client, no model inference", "Linux virtual device capture, not physical speakers"] }, null, 2));
  console.log("Strudel native audio and coexistence smoke passed.");
} catch (error) {
  if (app) {
    try { await app.firstWindow().then((page) => page.screenshot({ path: join(out, "failure.png") })); } catch {}
  }
  throw error;
} finally {
  if (app) await app.close();
}
