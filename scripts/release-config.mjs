import { existsSync, readFileSync } from "node:fs";

export function releaseConfig(env, { unsigned = false } = {}) {
  const config = JSON.parse(readFileSync(new URL("../electron-builder.json", import.meta.url), "utf8"));
  if (unsigned) {
    config.mac.identity = null;
    config.mac.notarize = false;
    config.forceCodeSigning = false;
    config.dmg = { sign: false };
  } else {
    if (!(env.CSC_LINK || env.CSC_NAME)) throw new Error("Developer ID signing requires CSC_LINK or CSC_NAME.");
    for (const name of ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
      if (!env[name]) throw new Error(`Signed release requires ${name}.`);
    }
    if (!existsSync(env.APPLE_API_KEY)) throw new Error("APPLE_API_KEY must name a readable .p8 file.");
    config.forceCodeSigning = true;
    config.mac.notarize = true;
    if (env.CSC_NAME) config.mac.identity = env.CSC_NAME;
  }
  return config;
}

// electron-builder's zip/notarization helpers spawn `ditto` by name. The
// @heyditto/cli executable must never shadow Apple's archive utility.
export function packagingEnv(env, unsigned) {
  return {
    ...env,
    PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${env.PATH || ""}`,
    CSC_IDENTITY_AUTO_DISCOVERY: unsigned ? "false" : "true",
  };
}
