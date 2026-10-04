#!/usr/bin/env node
/**
 * QA driver: attaches to a running OmniSynth (launched with OMNISYNTH_QA_PORT)
 * over the Chrome DevTools Protocol and runs a named scenario, printing
 * console errors and saving screenshots to /tmp/omnisynth-qa/.
 *
 *   OMNISYNTH_QA_PORT=9333 electron .            # or the packaged app binary
 *   node scripts/qa.mjs smoke|generate|edit|all [--port 9333]
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) ?? "smoke";
const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : process.env.OMNISYNTH_QA_PORT || "9333";
const outDir = "/tmp/omnisynth-qa";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((p) => p.url().includes("index.html")) ?? browser.contexts()[0].pages()[0];
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

const t = (id) => page.getByTestId(id);
const shot = async (name) => {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  console.log(`screenshot ${path}`);
};
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__omnisynth?.engine.getState() ?? null)));

async function smoke() {
  await page.waitForSelector('[data-testid="app"]', { timeout: 15000 });
  console.log("title:", await page.title());
  await shot("01-launch");
  const providers = await page.evaluate(() => window.omnisynth?.providers.detect());
  console.log("providers:", JSON.stringify(providers?.map((p) => ({ id: p.id, ok: p.authenticated, src: p.source, note: p.note })), null, 1));
  await t("settings").click();
  await page.waitForSelector('[data-testid="settings-modal"]');
  await shot("02-settings");
  await t("settings-close").click();
  // Add an empty track and draw a few steps.
  await t("add-track").click();
  await page.waitForSelector('[data-testid="track-track-1"]');
  const steps = page.locator('[data-testid="track-track-1"] .step');
  for (const i of [0, 4, 8, 12]) await steps.nth(i).click();
  await t("play").click();
  await page.waitForTimeout(1500);
  const playing = await page.evaluate(() => document.querySelector('[data-testid="play"]')?.classList.contains("playing"));
  console.log("playing:", playing);
  await shot("03-track-playing");
  await t("play").click();
}

async function generate() {
  await page.waitForSelector('[data-testid="app"]', { timeout: 15000 });
  const prompt = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : "Dark, driving 134 BPM acid techno with a rubbery 303 line, tight kick, offbeat hats, a short intro into a drop and an eerie break. Visuals: strobing magenta on black.";
  await t("prompt").fill(prompt);
  await t("generate").click();
  const started = Date.now();
  // Wait until the run finishes (Generate button returns) or 6 minutes pass.
  while (Date.now() - started < 360000) {
    await page.waitForTimeout(2000);
    const busy = await page.locator('[data-testid="cancel"]').count();
    const log = await page.locator('[data-testid="log"] .log-entry').allInnerTexts();
    const last = log[log.length - 1];
    if (last) process.stdout.write(`\r${String(log.length).padStart(3)} ${last.slice(0, 110).padEnd(110)}`);
    if (!busy) break;
  }
  console.log();
  const log = await page.locator('[data-testid="log"] .log-entry').allInnerTexts();
  console.log("--- run log ---");
  for (const l of log) console.log(l);
  const tracks = await page.locator('[data-testid^="track-"]').count();
  const section = await page.locator('[data-testid="current-section"]').textContent().catch(() => null);
  console.log("tracks:", tracks, "section:", section);
  const st = await state();
  console.log("brief:", JSON.stringify(await page.evaluate(() => window.__omnisynth?.store.brief())));
  console.log("state:", JSON.stringify({ bpm: st?.bpm, key: st?.key, scale: st?.scale, tracks: st?.tracks.map((t) => `${t.id}:${t.instrument}:${t.stepCount}`), arrangement: st?.arrangement }));
  await shot("04-generated");
}

async function edit() {
  await page.waitForSelector('[data-testid="app"]', { timeout: 15000 });
  const first = page.locator('[data-testid^="track-"]').first();
  const id = await first.getAttribute("data-testid");
  console.log("editing", id);
  await first.locator(".chip", { hasText: "M" }).click();
  await page.waitForTimeout(300);
  await first.locator(".chip", { hasText: "M" }).click();
  await first.locator(".fader").fill("-20");
  await first.locator(".step").nth(2).click();
  await t("bpm").fill("140");
  await t("bpm").press("Enter");
  await page.waitForTimeout(500);
  await shot("05-edited");
}

async function attach() {
  // Attach files through the bridge (the native dialog can't be automated) then generate.
  await page.waitForSelector('[data-testid="app"]', { timeout: 15000 });
  const paths = args.includes("--files") ? args[args.indexOf("--files") + 1].split(",") : ["/tmp/omnisynth-qa/assets/mood.png", "/tmp/omnisynth-qa/assets/ref.wav", "/tmp/omnisynth-qa/assets/notes.md"];
  const added = await page.evaluate(async (p) => {
    const atts = await window.omnisynth.files.readPaths(p);
    window.__omnisynth.store.setAttachments(atts);
    return atts.map((a) => `${a.kind}:${a.name}:${a.size}`);
  }, paths);
  console.log("attached:", added);
  await page.waitForSelector(".attachment");
  await shot("07-attachments");
  await generate();
}

async function engineScenario() {
  // Drive the tool executor directly (no LLM): FX chains, params, mods, automation, evolution, odd meter, visualizer.
  await page.waitForSelector('[data-testid="app"]', { timeout: 15000 });
  await page.evaluate(() => window.__omnisynth.engine.clear());
  const calls = [
    ["set_bpm", { bpm: 132 }],
    ["set_key", { key: "F", scale: "minor" }],
    ["create_patch", { id: "acid", type: "MonoSynth", oscillator_type: "sawtooth", filter_frequency: 300, filter_q: 6, filter_envelope_octaves: 4, portamento: 0.04, effects: JSON.stringify([{ type: "distortion", distortion: 0.25, wet: 0.4 }, { type: "delay", delayTime: "8n.", feedback: 0.3, wet: 0.2 }]) }],
    ["add_track", { id: "kick", name: "Kick", instrument: "kick", volume: -5, subdivision: "16n", notes: JSON.stringify([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) }],
    ["add_track", { id: "hats", name: "Hats", instrument: "hihat", volume: -12, subdivision: "16n", notes: JSON.stringify([0, 0, { hit: true, velocity: 0.7 }, 0, 0, 0, { hit: true, velocity: 0.9, ratchet: 2 }, 0, 0, 0, { hit: true, prob: 0.6 }, 0, 0, 0, { hit: true, cond: "2:2" }, 0]) }],
    ["add_track", { id: "bass", name: "Acid", instrument: "acid", volume: -8, subdivision: "16n", notes: JSON.stringify(["F1", "-", "F1", "Ab1", "-", "F1", "-", "C2", "F1", "-", "Eb2", "-", "F1", "-", "Ab1", "-"]), fx: JSON.stringify([{ type: "filter", frequency: 700, Q: 3 }]) }],
    ["add_track", { id: "pad", name: "Pad", instrument: "dark-pad", volume: -14, subdivision: "4n", notes: JSON.stringify([{ note: ["F3", "Ab3", "C4"], duration: "1m" }, "-", "-", "-"]) }],
    ["set_master_fx", { fx: JSON.stringify([{ type: "compressor", threshold: -14, ratio: 3 }, { type: "saturation", order: 3, wet: 0.15 }, { type: "limiter", threshold: -1 }]) }],
    ["list_params", { track_id: "bass" }],
    ["add_modulation", { id: "wobble", source: JSON.stringify({ type: "lfo", rate: "2m", shape: "sine" }), target: "bass.fx.2.frequency", offset: 900, depth: 700 }],
    ["add_modulation", { id: "duck", source: JSON.stringify({ type: "follower", track: "kick", invert: true }), target: "pad.volume", offset: -22, depth: 8 }],
    ["add_modulation", { id: "hat-pan", source: JSON.stringify({ type: "random", rate: "8n", smooth: 0.5 }), target: "hats.pan", offset: -0.6, depth: 1.2 }],
    ["automate_param", { path: "master.fx.1.wet", from: 0.05, to: 0.5, bars: 4 }],
    ["set_evolution", { track_id: "hats", rules: JSON.stringify([{ id: "drift", every: 1, ops: [{ type: "markov", order: 2, temperature: 1.3 }, { type: "stutter", probability: 0.2 }], min_density: 0.2, max_density: 0.6 }]) }],
    ["set_evolution", { track_id: "bass", rules: JSON.stringify([{ id: "ca", every: 2, ops: [{ type: "cellular", rule: 110 }, { type: "transpose_scale", random: true }, { type: "param_walk", path: "bass.synth.filterEnvelope.baseFrequency", step: 80, min: 200, max: 1200 }], min_density: 0.3, max_density: 0.7 }]) }],
    ["create_section", { id: "a", name: "A", bars: 2 }],
    ["create_section", { id: "seven", name: "Seven", bars: 2, beats: 7, unit: 8, bpm: 140 }],
    ["set_arrangement", { sections: JSON.stringify(["a", "seven"]) }],
    ["evolve_now", { track_id: "hats" }],
    ["play", {}],
  ];
  for (const [n, a] of calls) {
    const res = await page.evaluate(async ([name, args]) => { try { return await window.__omnisynth.tools(name, args); } catch (e) { return `THROW: ${e.message}`; } }, [n, a]);
    console.log(`${n}: ${String(res).split("\n").slice(0, 3).join(" | ").slice(0, 220)}`);
  }
  await page.waitForTimeout(9000);
  const st = await page.evaluate(() => {
    const s = window.__omnisynth.engine.getState();
    return { bar: s.totalBars, section: s.currentSection, ts: window.__omnisynth.engine.activeTimeSignature(), mods: s.modulations.length, autos: s.automations.length, hats: s.tracks.find((t) => t.id === "hats")?.rules[0]?.fired, bass: s.tracks.find((t) => t.id === "bass")?.rules[0]?.fired, playing: s.isPlaying, cutoff: window.__omnisynth.engine.getParam("bass.synth.filterEnvelope.baseFrequency") };
  });
  console.log("after 9s:", JSON.stringify(st));
  await shot("08-engine");
  await page.keyboard.press("f");
  await page.waitForSelector('[data-testid="exit-visualizer"]');
  await page.waitForTimeout(800);
  await shot("09-visualizer");
  console.log("visualizer:", await page.getAttribute('[data-testid="app"]', "data-view"));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="transport"]');
  await page.evaluate(() => window.__omnisynth.engine.stop());
}

const scenarios = { smoke, generate, edit, attach, engine: engineScenario, all: async () => { await smoke(); await generate(); await edit(); } };
try {
  await scenarios[scenario]();
} finally {
  if (errors.length) {
    console.log("--- console errors/warnings ---");
    for (const e of errors.slice(0, 40)) console.log(e);
  } else console.log("no console errors");
  await browser.close();
}
