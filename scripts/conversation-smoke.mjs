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
      if (prompt.startsWith("Cancel")) await new Promise((resolve) => setTimeout(resolve, 600));
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
  const info = JSON.parse(readFileSync(join(profile, "bridge.json"), "utf8"));
  const base = `http://127.0.0.1:${info.port}`;
  const headers = { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" };
  const tool = async (name, args = {}) => {
    const value = await fetch(base + "/tools/" + name, { method: "POST", headers, body: JSON.stringify(args) }).then((response) => response.json());
    assert.equal(value.ok, true, value.error);
    return value.result;
  };
  const generate = async (prompt) => {
    const value = await fetch(base + "/generate", { method: "POST", headers, body: JSON.stringify({ prompt, mode: "iterate" }), signal: AbortSignal.timeout(30000) }).then((response) => response.json());
    assert.equal(value.ok, true, value.error);
    return value;
  };
  await tool("add_track", { id: "retained", name: "Retained Tone", instrument: "synth", subdivision: "16n", notes: '["C3",null]', volume: -18 });
  await generate("Build Cedar in C minor, no reverb.");
  await generate("Make it slower at 95 BPM; keep our earlier constraints.");
  const requests = await app.evaluate(() => globalThis.qaRequests);
  const followup = requests.find((request) => request.messages.at(-1)?.content === "Make it slower at 95 BPM; keep our earlier constraints.");
  assert.ok(followup.messages.some((message) => message.role === "user" && message.content === "Build Cedar in C minor, no reverb."), "Follow-up lost the previous artist turn");
  assert.ok(followup.messages.some((message) => message.role === "tool" && message.name === "evaluate_strudel"), "Previous tool transcript was not carried forward");
  const beforeQuestion = JSON.parse(await tool("strudel_status"));
  await generate("Explain our earlier constraints without changing playback.");
  assert.equal(JSON.parse(await tool("strudel_status")).code, beforeQuestion.code);
  await generate("Recover from a syntax error and run the repaired pattern.");
  assert.equal(JSON.parse(await tool("strudel_status")).error, null);
  const cancelled = generate("Cancel this queued edit.");
  await page.getByTestId("cancel").waitFor();
  await page.getByTestId("cancel").click();
  await cancelled;
  assert.equal(await page.getByTestId("chat-turn").count(), 5);
  await page.getByText("Stopped. Send another message to continue.").waitFor();
  await tool("stop");
  const state = await fetch(base + "/state", { headers }).then((response) => response.json());
  assert.ok(state.tracks.some((track) => track.id === "retained"));
  await page.getByTestId("prompt").fill("Unsent draft survives reload");
  await page.reload();
  await page.getByTestId("chat-turn").nth(4).waitFor();
  assert.equal(await page.getByTestId("chat-turn").count(), 5);
  assert.equal(await page.getByTestId("prompt").inputValue(), "Unsent draft survives reload");
  await page.getByText("Build Cedar in C minor, no reverb.", { exact: true }).waitFor();
  await page.getByTestId("composer").screenshot({ path: join(out, "conversation.png") });
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "proof.json"), JSON.stringify({ passed: true, checks: ["multi-turn context", "tool transcript replay", "question without mutation", "syntax recovery", "cancel", "reload history", "reload draft", "Tone preservation"], limitations: ["Deterministic model fixture; actual model prompt QA is separate"] }, null, 2));
  console.log("Conversation native smoke passed.");
} catch (error) {
  try { await (await app.firstWindow()).screenshot({ path: join(out, "failure.png") }); } catch {}
  throw error;
} finally { if (app) await app.close(); }
