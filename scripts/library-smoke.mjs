#!/usr/bin/env node
// Library smoke: every patch constructs and triggers; every pattern resolves; every progression voices;
// every template applies. Runs inside the live app over CDP.
import { chromium } from "playwright-core";
const port = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "9333";
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((p) => p.url().includes("index.html")) ?? browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.waitForSelector('[data-testid="app"]', { timeout: 15000 });

const report = await page.evaluate(async () => {
  const T = window.__omnisynth.tools;
  const out = { patches: [], patterns: [], progressions: [], templates: [] };
  await window.__omnisynth.engine.init();
  window.__omnisynth.engine.clear();
  const idsOf = async (kind) => [...(await T("list_library", { kind })).matchAll(/^  ([A-Za-z0-9-]+)[ :]/gm)].map((m) => m[1]).filter((x) => !/^(PATCHES|PATTERNS|PROGRESSIONS|ARRANGEMENTS)$/.test(x));
  const patchIds = await idsOf("patch");
  const patternIds = await idsOf("pattern");
  const progIds = await idsOf("progression");
  const tplIds = await idsOf("arrangement");
  for (const id of patchIds) {
    try {
      const r = await T("use_patch", { id });
      // Build a track with it and trigger a few notes/hits.
      const melodic = !/^(kick|snare|clap|hat|ride|rim|tom|perc|fx)/.test(id);
      const notes = melodic ? JSON.stringify(["C3", "-", "G3", "-", ["C3", "Eb3", "G3"], "-", "-", "-"]) : JSON.stringify([1, 0, 0, 0, 1, 0, 1, 0]);
      const t = await T("add_track", { id: `t-${id}`, name: id, instrument: id, subdivision: "16n", notes });
      out.patches.push({ id, ok: !r.startsWith("Error") && !t.startsWith("Error"), msg: (r + " | " + t).slice(0, 120) });
    } catch (e) {
      out.patches.push({ id, ok: false, msg: String(e.message) });
    }
  }
  await T("play", {});
  await new Promise((r) => setTimeout(r, 2500));
  const level = window.__omnisynth.engine.level();
  await T("stop", {});
  for (const id of patternIds) {
    try {
      const r = JSON.parse(await T("use_pattern", { id, bars: 1 }));
      out.patterns.push({ id, ok: Array.isArray(r.notes) && r.notes.length > 0, n: r.notes.length });
    } catch (e) {
      out.patterns.push({ id, ok: false, msg: String(e.message) });
    }
  }
  for (const id of progIds) {
    try {
      const r = JSON.parse(await T("use_progression", { id, key: "F", voicing: "spread" }));
      out.progressions.push({ id, ok: r.chords.length > 0 && r.chords.every((c) => c.notes.length >= 3), first: r.chords[0].notes.join(" ") });
    } catch (e) {
      out.progressions.push({ id, ok: false, msg: String(e.message) });
    }
  }
  for (const id of tplIds) {
    try {
      const r = await T("apply_template", { id });
      out.templates.push({ id, ok: !r.startsWith("Error"), sections: window.__omnisynth.engine.sections.size });
      window.__omnisynth.engine.sections.clear();
      window.__omnisynth.engine.arrangement = [];
    } catch (e) {
      out.templates.push({ id, ok: false, msg: String(e.message) });
    }
  }
  window.__omnisynth.engine.clear();
  return { ...out, level, counts: { patchIds: patchIds.length, patternIds: patternIds.length, progIds: progIds.length, tplIds: tplIds.length } };
});

const bad = (list) => list.filter((x) => !x.ok);
console.log("counts:", JSON.stringify(report.counts), "| audio level while all patches played:", report.level.toFixed(3));
for (const k of ["patches", "patterns", "progressions", "templates"]) {
  const b = bad(report[k]);
  console.log(`${k}: ${report[k].length - b.length}/${report[k].length} ok`);
  for (const x of b) console.log("  FAIL", x.id, x.msg ?? "");
}
console.log("progression sample:", report.progressions.slice(0, 3).map((p) => `${p.id}: ${p.first}`).join(" | "));
if (errors.length) { console.log("--- page errors ---"); for (const e of errors.slice(0, 15)) console.log(e.slice(0, 200)); }
await browser.close();
process.exit(bad(report.patches).length + bad(report.patterns).length + bad(report.progressions).length + bad(report.templates).length + errors.length ? 1 : 0);
