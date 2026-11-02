import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { releaseConfig, packagingEnv } from "./release-config.mjs";

test("signed release fails closed for every absent credential", () => {
  const dir = mkdtempSync(join(tmpdir(), "omnisynth-config-"));
  try {
    const key = join(dir, "not-a-real-key.p8");
    writeFileSync(key, "synthetic fixture");
    const env = { CSC_LINK: "synthetic certificate", APPLE_API_KEY: key, APPLE_API_KEY_ID: "fixture", APPLE_API_ISSUER: "fixture" };
    assert.equal(releaseConfig(env).forceCodeSigning, true);
    assert.equal(releaseConfig(env).mac.notarize, true);
    for (const name of Object.keys(env)) {
      const missing = { ...env };
      delete missing[name];
      assert.throws(() => releaseConfig(missing), /requires|signing/);
    }
    assert.throws(() => releaseConfig({ ...env, APPLE_API_KEY: join(dir, "missing") }), /readable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unsigned is explicit, ignores auto discovery and cannot publish", () => {
  const config = releaseConfig({}, { unsigned: true });
  assert.equal(config.mac.identity, null);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.publish, null);
  assert.equal(packagingEnv({ PATH: "/malicious/bin" }, true).CSC_IDENTITY_AUTO_DISCOVERY, "false");
});

test("OmniSynth's bundle, protocol and artifact identity cannot overwrite Ditto", () => {
  const config = releaseConfig({}, { unsigned: true });
  assert.equal(config.appId, "com.omniaura.omnisynth");
  assert.equal(config.productName, "OmniSynth");
  assert.equal(config.executableName, "OmniSynth");
  assert.deepEqual(config.protocols.flatMap((p) => p.schemes), ["omnisynth"]);
  assert.equal(config.artifactName, "${productName}-${version}-${os}-${arch}.${ext}");
  assert.equal(config.mac.hardenedRuntime, true);
  assert.equal(packagingEnv({ PATH: "/heyditto/bin:/usr/bin" }, false).PATH.split(":")[0], "/usr/bin");
});

test("the packaging subprocess uses Apple's ditto despite an ambient CLI shadow", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "omnisynth-ditto-"));
  try {
    writeFileSync(join(dir, "ditto"), "#!/bin/sh\nexit 99\n", { mode: 0o700 });
    const caller = { ...process.env, PATH: `${dir}:/usr/bin:/bin` };
    assert.equal(execFileSync("/usr/bin/which", ["ditto"], { env: caller, encoding: "utf8" }).trim(), join(dir, "ditto"));
    assert.equal(execFileSync("/usr/bin/which", ["ditto"], { env: packagingEnv(caller, false), encoding: "utf8" }).trim(), "/usr/bin/ditto");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
