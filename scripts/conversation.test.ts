import { expect, test } from "bun:test";
import { completeMessages } from "../src/lib/conversation";

test("a cancelled batch gets a result for each unexecuted call", () => {
  const messages = completeMessages([{ role: "assistant", content: null, tool_calls: [{ id: "one", type: "function", function: { name: "stop", arguments: "{}" } }, { id: "two", type: "function", function: { name: "strudel_status", arguments: "{}" } }] }, { role: "tool", tool_call_id: "one", content: "Stopped" }]);
  expect(messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id).sort()).toEqual(["one", "two"]);
});

test("an earlier provider response with the same id cannot acknowledge a later pending call", () => {
  const call = { id: "call_0", type: "function" as const, function: { name: "strudel_status", arguments: "{}" } };
  const messages = completeMessages([{ role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: "call_0", content: "Earlier status" }, { role: "assistant", content: null, tool_calls: [call] }]);
  expect(messages.at(-1)?.role).toBe("tool");
  expect(messages.at(-1)?.content).toContain("Not executed");
  expect(messages[1].content).toBe("Earlier status");
});
