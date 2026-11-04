import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { withCleanup } from "./with-cleanup.mjs";

if (process.platform !== "darwin") throw new Error("macOS artifact verification requires a Mac.");
const signed = !process.argv.includes("--unsigned");
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const dmg = resolve(`release/OmniSynth-${pkg.version}-mac-arm64.dmg`);
const zip = resolve(`release/OmniSynth-${pkg.version}-mac-arm64.zip`);
assert.ok(existsSync(dmg) && existsSync(zip), "Both DMG and ZIP must exist");
run("/usr/bin/hdiutil", ["verify", dmg]);
mkdirSync(".tmp", { recursive: true });
const root = mkdtempSync(resolve(".tmp/artifact-qa-"));
const mount = join(root, "mount");
const unpacked = resolve("release/mac-arm64/OmniSynth.app");
let mountedDisk = false;
let detachedDisk = false;
await withCleanup(async () => {
  mkdirSync(mount);
  const zipDir = join(root, "zip");
  run("/usr/bin/ditto", ["-x", "-k", zip, zipDir]);
  run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  mountedDisk = true;
  const mounted = join(mount, "OmniSynth.app");
  for (const app of [unpacked, mounted, join(zipDir, "OmniSynth.app")]) {
    const plist = (key) => run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(app, "Contents/Info.plist")]).trim();
    assert.equal(plist("CFBundleIdentifier"), "com.omniaura.omnisynth");
    assert.equal(plist("CFBundleExecutable"), "OmniSynth");
    assert.equal(plist("CFBundleURLTypes:0:CFBundleURLSchemes:0"), "omnisynth");
    for (const file of ["Contents/MacOS/OmniSynth", "Contents/Resources/app.asar",
      "Contents/Resources/licensing/LICENSE", "Contents/Resources/licensing/THIRD_PARTY_NOTICES.txt",
      "Contents/Resources/licensing/source/electron/bridge.ts", "Contents/Resources/licensing/source/bun.lock"]) {
      assert.equal(digest(join(app, file)), digest(join(unpacked, file)), "DMG/ZIP payload mismatch");
    }
    const licensing = join(app, "Contents/Resources/licensing");
    assert.equal(digest(join(licensing, "LICENSE")), digest("LICENSE"), "Packaged application license mismatch");
    assert.equal(digest(join(licensing, "source/electron/bridge.ts")), digest("electron/bridge.ts"), "Corresponding source mismatch");
    const inventory = JSON.parse(readFileSync(join(licensing, "source/dependency-inventory.json"), "utf8"));
    assert.ok(inventory.some((p) => p.name === "hydra-synth"), "Hydra source/notices missing");
    assert.ok(inventory.some((p) => p.name === "tone"), "Tone source/notices missing");
    if (signed) {
      run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
      const details = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", app], { encoding: "utf8" });
      assert.equal(details.status, 0);
      assert.match(details.stderr, /TeamIdentifier=HS4W876DT9(?:\n|$)/);
      assert.match(details.stderr, /Authority=Developer ID Application: Omni Aura LLC/);
      assert.match(details.stderr, /flags=.*runtime/);
      run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
      run("/usr/bin/xcrun", ["stapler", "validate", app]);
    }
  }
  execFileSync(process.execPath, ["scripts/package-smoke.mjs", join(mount, "OmniSynth.app/Contents/MacOS/OmniSynth")], { stdio: "inherit" });
}, [
  () => { if (mountedDisk) { run("/usr/bin/hdiutil", ["detach", mount]); mountedDisk = false; detachedDisk = true; } },
  () => { if (!mountedDisk || detachedDisk) rmSync(root, { recursive: true, force: true }); },
]);
const files = [dmg, zip];
writeFileSync("release/SHA256SUMS.txt", files.map((path) => `${digest(path)}  ${path.slice(path.lastIndexOf("/") + 1)}\n`).join(""));
writeFileSync("release/provenance.json", JSON.stringify({ repository: "omniaura/omnisynth", sourceSha: run("git", ["rev-parse", "HEAD"]).trim(), workflowSha: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null, version: pkg.version, architecture: "arm64", signed, notarizationVerified: signed, published: false, updaterEnabled: false }, null, 2));
console.log(`Verified DMG and ZIP; signing/notarization checked=${signed}. Publication and updater remain inactive.`);
