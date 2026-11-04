import { app, safeStorage } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Small encrypted key/value store for API keys and the Ditto session.
 * Values are encrypted with the OS keychain via safeStorage when available and
 * written to userData/secrets.json; the renderer never sees raw keys.
 */
type SecretMap = Record<string, string>;

function filePath(): string {
  return join(app.getPath("userData"), "secrets.json");
}

function load(): SecretMap {
  let raw: Record<string, string>;
  try {
    raw = JSON.parse(readFileSync(filePath(), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
  const out: SecretMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v.startsWith("enc:")) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("safeStorage unavailable: stored secrets cannot be decrypted");
      }
      out[k] = safeStorage.decryptString(Buffer.from(v.slice(4), "base64"));
    } else if (v.startsWith("raw:")) {
      out[k] = v.slice(4);
    }
  }
  return out;
}

function save(map: SecretMap): void {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    raw[k] = safeStorage.isEncryptionAvailable()
      ? `enc:${safeStorage.encryptString(v).toString("base64")}`
      : `raw:${v}`;
  }
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(filePath(), JSON.stringify(raw, null, 2), { mode: 0o600 });
}

export function getSecret(key: string): string | undefined {
  return load()[key];
}

export function setSecret(key: string, value: string): void {
  const map = load();
  map[key] = value;
  save(map);
}

export function deleteSecret(key: string): void {
  const map = load();
  delete map[key];
  save(map);
}
