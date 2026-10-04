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
    await first.locator(".fader").evaluate((el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, "-20");
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

const scenarios = { smoke, generate, edit, attach, all: async () => { await smoke(); await generate(); await edit(); } };
try {
  await scenarios[scenario]();
} finally {
  if (errors.length) {
    console.log("--- console errors/warnings ---");
    for (const e of errors.slice(0, 40)) console.log(e);
  } else console.log("no console errors");
  await browser.close();
}
