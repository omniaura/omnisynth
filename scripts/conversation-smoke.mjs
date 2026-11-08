import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const out = resolve(process.argv[2] || ".tmp/conversation-qa");
mkdirSync(out, { recursive: true });
const profile = join(out, "profile");
const env = Object.fromEntries(["PATH", "DISPLAY", "XAUTHORITY", "TMPDIR", "PULSE_SERVER", "ALSA_CONFIG_PATH", "LP_NUM_THREADS"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, { HOME: join(out, "home"), XDG_CONFIG_HOME: join(out, "home/.config"), SHELL: "/bin/sh", OMNISYNTH_QA_USER_DATA_DIR: profile });
let app;
try {
  app = await electron.launch({ args: ["--no-sandbox", "."], env, timeout: 60000 });
  await app.evaluate(({ ipcMain }) => {
    globalThis.qaRequests = [];
    ipcMain.removeHandler("inference:chat");
    ipcMain.handle("inference:chat", async (_event, request) => {
      globalThis.qaRequests.push(request);
      const lastUser = request.messages.findLastIndex((message) => message.role === "user");
      const prompt = request.messages[lastUser].content;
      const current = request.messages.slice(lastUser + 1);
      const last = current.at(-1);
      const tool = (name, args) => ({ message: { role: "assistant", content: null, tool_calls: [{ id: "qa-" + globalThis.qaRequests.length, type: "function", function: { name, arguments: JSON.stringify(args) } }] } });
      if (prompt.startsWith("Explain")) return { message: { role: "assistant", content: "Cedar stays in C minor with no reverb; the follow-up slowed it to 95 BPM." } };
      if (prompt.startsWith("Cancel")) { await new Promise((resolve) => setTimeout(resolve, 600)); throw new Error("The operation was aborted."); }
      if (prompt.startsWith("External") && (!last || last.role !== "tool")) return tool("read_conversation_turn", { id: "private-id" });
      if (last?.name === "read_conversation_turn") return tool("done", { summary: "External job cannot read private conversation." });
      if (!last || last.role !== "tool") return tool("evaluate_strudel", { code: prompt.startsWith("Recover") ? "stack(" : `setcpm(${prompt.startsWith("Make") ? 95 : 110}/4); stack(s("sbd*4").gain(0.3), note("c3 eb3 g3 bb3").s("sine").gain(0.1))` });
      if (last.name === "evaluate_strudel" && last.content.startsWith("Error")) return tool("evaluate_strudel", { code: 'setcpm(95/4); note("c3 eb3 g3").s("sine").gain(0.1)' });
      if (last.name === "evaluate_strudel") return tool("strudel_status", {});
      return tool("done", { summary: "Cedar is playing in C minor, without reverb." });
    });
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByTestId("app").waitFor();
  await page.evaluate(() => window.__omnisynth.store.updateSettings({ skipPerceive: true }));
  await page.getByTestId("music-engine").selectOption("strudel");
  await page.getByTestId("prompt").fill("Unsent draft survives reload");
  const info = JSON.parse(readFileSync(join(profile, "bridge.json"), "utf8"));
  const base = `http://127.0.0.1:${info.port}`;
  const headers = { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" };
  const tool = async (name, args = {}) => {
    const value = await fetch(base + "/tools/" + name, { method: "POST", headers, body: JSON.stringify(args) }).then((response) => response.json());
    assert.equal(value.ok, true, value.error);
    return value.result;
  };
  const bridgeGenerate = async (prompt) => {
    const value = await fetch(base + "/generate", { method: "POST", headers, body: JSON.stringify({ prompt, mode: "iterate" }), signal: AbortSignal.timeout(30000) }).then((response) => response.json());
    assert.equal(value.ok, true, value.error);
    return value;
  };
  const generate = async (prompt) => {
    await page.getByTestId("prompt").fill(prompt);
    await page.getByTestId("generate").click();
    await page.waitForFunction(() => window.__omnisynth.store.running() === "idle");
  };
  await tool("add_track", { id: "retained", name: "Retained Tone", instrument: "synth", subdivision: "16n", notes: '["C3",null]', volume: -18 });
  await generate("Build Cedar in C minor, no reverb.");
  await generate("Make it slower at 95 BPM; keep our earlier constraints.");
  const requests = await app.evaluate(() => globalThis.qaRequests);
  const followup = requests.find((request) => request.messages.at(-1)?.content === "Make it slower at 95 BPM; keep our earlier constraints.");
  assert.ok(followup.messages.some((message) => message.role === "user" && message.content === "Build Cedar in C minor, no reverb."), "Follow-up lost the previous artist turn");
  assert.ok(followup.messages.some((message) => message.role === "tool" && message.name === "evaluate_strudel"), "Previous tool transcript was not carried forward");
  const beforeQuestion = JSON.parse(await tool("strudel_status"));
  await page.evaluate(() => window.__omnisynth.store.updateSettings({ skipPerceive: false }));
  const beforeQuestionRequests = await app.evaluate(() => globalThis.qaRequests.length);
  await generate("Explain our earlier constraints without changing playback.");
  await page.getByText("Cedar stays in C minor with no reverb; the follow-up slowed it to 95 BPM.", { exact: true }).first().waitFor();
  assert.equal(await app.evaluate(() => globalThis.qaRequests.length), beforeQuestionRequests + 1, "A completed question answer was requested again");
  assert.equal(JSON.parse(await tool("strudel_status")).code, beforeQuestion.code);
  await page.evaluate(() => window.__omnisynth.store.updateSettings({ skipPerceive: true }));
  await tool("select_music_engine", { engine: "tone" });
  await generate("Explain our earlier constraints without starting Tone playback.");
  assert.equal(JSON.parse(await tool("get_audio_status")).tone.playing, false);
  await tool("select_music_engine", { engine: "strudel" });
  await generate("Recover from a syntax error and run the repaired pattern.");
  assert.equal(JSON.parse(await tool("strudel_status")).error, null);
  const priorCode = JSON.parse(await tool("strudel_status")).code;
  const rawEvaluate = (code) => fetch(base + "/tools/evaluate_strudel", { method: "POST", headers, body: JSON.stringify({ code }) }).then((response) => response.json());
  const slowCode = 'await new Promise(resolve => setTimeout(resolve, 350)); note("c3").s("sine").gain(0.08)';
  const slowStart = Date.now();
  const slowResult = await rawEvaluate(slowCode);
  assert.equal(slowResult.ok, true, JSON.stringify(slowResult));
  assert.ok(Date.now() - slowStart >= 300, "Slow evaluation control did not delay");
  const olderEvaluation = rawEvaluate(slowCode);
  await page.waitForTimeout(50);
  const newerEvaluation = rawEvaluate('note("f3").s("sine").gain(0.08)');
  const [olderResult, newerResult] = await Promise.all([olderEvaluation, newerEvaluation]);
  assert.equal(olderResult.ok, false, "The earlier evaluation should be superseded");
  assert.equal(newerResult.ok, true, newerResult.error);
  await page.waitForTimeout(150);
  assert.equal(JSON.parse(await tool("strudel_status")).playing, true, "A stale evaluation stopped the newer pattern");
  const stoppedEvaluation = rawEvaluate('await new Promise(resolve => setTimeout(resolve, 3000)); note("c3").s("sine").gain(0.08)');
  await page.waitForTimeout(150);
  const stopStart = Date.now();
  await tool("stop");
  assert.ok(Date.now() - stopStart < 1500, "Stop waited behind a pending evaluation");
  const stoppedResult = await stoppedEvaluation;
  assert.equal(stoppedResult.ok, false);
  assert.match(stoppedResult.error, /[Ss]uperseded/, "Stop reset the frame instead of interrupting playback");
  await page.waitForTimeout(150);
  assert.equal(JSON.parse(await tool("strudel_status")).playing, false, "An evaluation restarted playback after Stop");
  await tool("evaluate_strudel", { code: priorCode });
  const cancelled = generate("Cancel this queued edit.");
  await page.getByTestId("cancel").waitFor();
  await page.getByTestId("cancel").click();
  await cancelled;
  assert.equal(await page.getByTestId("chat-turn").count(), 6);
  await page.getByText("Stopped. Send another message to continue.").waitFor();
  await page.getByTestId("prompt").fill("Unsent draft survives reload");
  await bridgeGenerate("External song job must not read private conversation.");
  const external = (await app.evaluate(() => globalThis.qaRequests)).find((request) => request.messages.at(-1)?.content === "External song job must not read private conversation.");
  assert.ok(!external.messages.some((message) => message.role === "user" && message.content === "Build Cedar in C minor, no reverb."));
  assert.ok(!external.tools.some((tool) => tool.function.name === "read_conversation_turn" || tool.function.name === "search_conversation_history"));
  const catalog = await fetch(base + "/tools", { headers }).then((response) => response.json());
  assert.ok(!catalog.some((tool) => ["read_conversation_turn", "search_conversation_history"].includes(tool.name)));
  for (const name of ["read_conversation_turn", "search_conversation_history"]) {
    const denied = await fetch(base + "/tools/" + name, { method: "POST", headers, body: JSON.stringify({ query: "Cedar", id: "private-id" }) }).then((response) => response.json());
    assert.equal(denied.ok, false);
  }
  await tool("stop");
  const state = await fetch(base + "/state", { headers }).then((response) => response.json());
  assert.ok(state.tracks.some((track) => track.id === "retained"));
  assert.equal(await page.getByTestId("prompt").inputValue(), "Unsent draft survives reload", "A bridge job overwrote an unsent artist draft");
  await page.reload();
  await page.getByTestId("chat-turn").nth(6).waitFor();
  assert.equal(await page.getByTestId("chat-turn").count(), 7);
  assert.equal(await page.getByTestId("music-engine").inputValue(), "strudel");
  assert.equal(await page.getByTestId("prompt").inputValue(), "Unsent draft survives reload");
  await page.getByText("Build Cedar in C minor, no reverb.", { exact: true }).waitFor();
  await page.getByTestId("composer").screenshot({ path: join(out, "conversation.png") });
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("omnisynth-conversation", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction("turns", "readwrite");
      for (let i = 0; i < 55; i++) tx.objectStore("turns").put({ id: "archive-" + i, at: 1000 + i, prompt: "Archived melody number " + i, attachments: [], events: [{ type: "assistant", text: "Kept earlier melody " + i }], messages: [{ role: "user", content: "Archived melody number " + i }, { role: "assistant", content: "Kept earlier melody " + i }], outcome: "complete" });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  const localTool = (name, args) => page.evaluate(({ name, args }) => window.__omnisynth.tools(name, args), { name, args });
  const found = JSON.parse(await localTool("search_conversation_history", { query: "Archived melody number 17" }));
  assert.equal(found.matches[0].id, "archive-17");
  assert.match(await localTool("read_conversation_turn", { id: found.matches[0].id }), /Kept earlier melody 17/);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-turn"]').length === 40);
  const earlier = page.getByRole("button", { name: "Earlier messages" });
  await earlier.scrollIntoViewIfNeeded();
  const anchor = page.getByTestId("chat-turn").first();
  const anchorID = await anchor.getAttribute("data-turn");
  const top = (await anchor.boundingBox()).y;
  await earlier.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-turn"]').length === 62);
  await page.waitForFunction(({ anchorID, top }) => Math.abs(document.querySelector(`[data-turn="${anchorID}"]`).getBoundingClientRect().top - top) < 2, { anchorID, top });
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("omnisynth-conversation", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction("turns", "readwrite");
      for (let i = 0; i < 200; i++) tx.objectStore("turns").put({ id: "old-" + i, at: i, prompt: i === 0 ? "Oldest original melody" : "Earlier turn " + i, attachments: [], events: [], messages: [], outcome: "complete" });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  const firstSearch = JSON.parse(await localTool("search_conversation_history", { query: "Oldest original melody" }));
  assert.equal(firstSearch.matches.length, 0);
  assert.equal(typeof firstSearch.nextBefore, "number");
  const nextSearch = JSON.parse(await localTool("search_conversation_history", { query: "Oldest original melody", before: firstSearch.nextBefore }));
  assert.equal(nextSearch.matches[0].id, "old-0");
  assert.equal(nextSearch.nextBefore, null);
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "proof.json"), JSON.stringify({ passed: true, checks: ["multi-turn context", "tool transcript replay", "question without mutation or auto-play", "syntax recovery", "AbortError cancel", "reload history", "reload draft and engine", "bridge draft preservation", "bridge history privacy", "62-turn archive", "older history search", "older message scroll anchor", "Tone preservation"], limitations: ["Deterministic model fixture; actual model prompt QA is separate"] }, null, 2));
  console.log("Conversation native smoke passed.");
} catch (error) {
  try { await (await app.firstWindow()).screenshot({ path: join(out, "failure.png") }); } catch {}
  throw error;
} finally { if (app) await app.close(); }
