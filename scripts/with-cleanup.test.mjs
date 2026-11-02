import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCleanup } from "./with-cleanup.mjs";

test("temporary snapshots are removed after success and operation failure", async () => {
  for (const fail of [false, true]) {
    const snapshot = mkdtempSync(join(tmpdir(), "omnisynth-snapshot-"));
    const operationError = new Error("build failed");
    const result = withCleanup(() => { if (fail) throw operationError; return "artifact"; }, [() => rmSync(snapshot, { recursive: true, force: true })]);
    if (fail) await assert.rejects(result, (error) => error === operationError);
    else assert.equal(await result, "artifact");
    assert.equal(existsSync(snapshot), false);
  }
});

test("body failure remains primary when shutdown and leak checks also fail", async () => {
  const primary = new Error("UI assertion failed");
  const close = new Error("app.close rejected");
  const leak = new Error("bridge file remains");
  const steps = [];
  await assert.rejects(withCleanup(() => { throw primary; }, [
    () => { steps.push("close"); throw close; },
    () => { steps.push("leak"); throw leak; },
  ]), (error) => error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === close && error.errors[2] === leak);
  assert.deepEqual(steps, ["close", "leak"]);
});

test("detach failure also fails an otherwise successful verification", async () => {
  const error = new Error("hdiutil detach failed");
  await assert.rejects(withCleanup(() => "verified", [() => { throw error; }]), (actual) => actual === error);
});
