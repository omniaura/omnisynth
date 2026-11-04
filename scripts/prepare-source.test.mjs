import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareSource } from "./prepare-source.mjs";

test("source bundle includes transitive production source and notices, excludes local state", () => {
  const root = mkdtempSync(join(tmpdir(), "omnisynth-source-"));
  const write = (path, value) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), value); };
  try {
    write("LICENSE", "Application AGPL fixture");
    write("package.json", JSON.stringify({ dependencies: { synth: "1" }, devDependencies: { builder: "1" } }));
    write("src/main.ts", "original application source");
    write("src/.env.production", "PRIVATE FIXTURE DO NOT PACKAGE");
    write(".env", "PRIVATE FIXTURE DO NOT PACKAGE");
    write("third-party/midi-gen-MIT.txt", "Original MIT fixture");
    write("node_modules/synth/package.json", JSON.stringify({ name: "synth", version: "1", license: "AGPL-3.0-only", dependencies: { oscillator: "2" } }));
    write("node_modules/synth/index.js", "synth source");
    write("node_modules/synth/LICENSE", "upstream AGPL fixture");
    write("node_modules/synth/.npmrc", "PRIVATE FIXTURE DO NOT PACKAGE");
    write("node_modules/oscillator/package.json", JSON.stringify({ name: "oscillator", version: "2", license: "MIT" }));
    write("node_modules/oscillator/index.js", "oscillator source");
    write("node_modules/builder/package.json", JSON.stringify({ name: "builder", version: "1" }));
    const out = join(root, ".tmp", "bundle");
    const inventory = prepareSource(out, root);
    assert.deepEqual(inventory.map((p) => p.name), ["oscillator", "synth"]);
    assert.equal(readFileSync(join(out, "source/dependencies/oscillator@2/index.js"), "utf8"), "oscillator source");
    assert.equal(existsSync(join(out, "source/src/.env.production")), false);
    assert.equal(existsSync(join(out, "source/.env")), false);
    assert.equal(existsSync(join(out, "source/dependencies/synth@1/.npmrc")), false);
    assert.equal(existsSync(join(out, "source/dependencies/builder@1")), false);
    assert.match(readFileSync(join(out, "THIRD_PARTY_NOTICES.txt"), "utf8"), /upstream AGPL fixture/);
    assert.match(readFileSync(join(out, "THIRD_PARTY_NOTICES.txt"), "utf8"), /Original MIT fixture/);
    rmSync(join(root, "node_modules/oscillator"), { recursive: true });
    assert.throws(() => prepareSource(join(root, ".tmp", "incomplete"), root), /Missing production dependency: oscillator/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
