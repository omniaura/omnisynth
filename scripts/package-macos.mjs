import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { releaseConfig, packagingEnv } from "./release-config.mjs";
import { withCleanup } from "./with-cleanup.mjs";

if (process.platform !== "darwin") throw new Error("macOS packaging must run on a Mac.");
const unsigned = process.argv.includes("--unsigned");
const config = releaseConfig(process.env, { unsigned });
// Check the environment inherited by builder, after overriding ambient CLI
// shadowing. Rejecting the caller's PATH would defeat this compatibility fix.
Object.assign(process.env, packagingEnv(process.env, unsigned));
if (execFileSync("/usr/bin/which", ["ditto"], { encoding: "utf8" }).trim() !== "/usr/bin/ditto") {
  throw new Error("Apple's /usr/bin/ditto must be the archive utility.");
}
// Package only the compiled app, with no workspace dependencies or credentials.
// Vite bundles both main/preload dependencies; Electron is provided by builder.
mkdirSync(".tmp", { recursive: true });
const snapshot = mkdtempSync(resolve(".tmp/omnisynth-package-"));
await withCleanup(async () => {
for (const dir of ["dist", "dist-electron"]) cpSync(dir, join(snapshot, dir), { recursive: true });
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const metadata = Object.fromEntries(["name", "productName", "version", "description", "type", "main", "license"].map((key) => [key, pkg[key]]));
writeFileSync(join(snapshot, "package.json"), JSON.stringify({ ...metadata, private: true, dependencies: {} }, null, 2));
config.directories = { app: snapshot, output: resolve("release"), buildResources: resolve("build") };
config.mac.icon = resolve(config.mac.icon);
config.mac.entitlements = resolve(config.mac.entitlements);
config.mac.entitlementsInherit = resolve(config.mac.entitlementsInherit);
const { build, Platform, Arch } = await import("electron-builder");
const targets = process.argv.includes("--dir") ? ["dir"] : ["dmg", "zip"];
console.log(`OmniSynth release: signing=${!unsigned} notarization=${!unsigned}`);
await build({ config, targets: Platform.MAC.createTarget(targets, Arch.arm64), publish: "never" });
}, [() => rmSync(snapshot, { recursive: true, force: true })]);
