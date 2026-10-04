import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Ditto Desktop (ditto-assistant/ditto-desktop) stores the Ditto account it
 * is linked to as `<home>/userdata/secrets/ditto-account.bin`, a 0600 JSON
 * file written by its server secret store. When the user has signed in there
 * but not here, OmniSynth reuses that session so "Sign in with Ditto" is
 * shared across both apps. Read-only: OmniSynth never writes into Ditto
 * Desktop's state.
 */

export interface DittoDesktopAccount {
  apiKey: string;
  apiBaseUrl: string;
  linkedAt?: string;
  home: string;
}

export interface DittoDesktopInstall {
  /** Base data directory (T3CODE_HOME / DITTO_HOME or ~/.t3). */
  home: string;
  /** Installed app bundle / executable, if found. */
  appPath?: string;
  account?: DittoDesktopAccount;
}

function candidateHomes(): string[] {
  const out = new Set<string>();
  for (const v of [process.env.DITTO_DESKTOP_HOME, process.env.T3CODE_HOME]) if (v) out.add(v);
  out.add(join(homedir(), ".t3"));
  out.add(join(homedir(), ".ditto"));
  return [...out];
}

function candidateApps(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["/Applications/Ditto.app", "/Applications/Ditto Desktop.app", join(homedir(), "Applications", "Ditto.app"), "/Applications/T3 Code.app"];
    case "win32": {
      const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
      return [join(local, "Programs", "Ditto", "Ditto.exe"), join(local, "Programs", "T3 Code", "T3 Code.exe")];
    }
    default:
      return ["/usr/bin/ditto-desktop", "/opt/Ditto/ditto", join(homedir(), ".local", "bin", "ditto-desktop")];
  }
}

export function detectDittoDesktop(): DittoDesktopInstall | null {
  const appPath = candidateApps().find((p) => existsSync(p));
  let found: DittoDesktopInstall | null = null;
  for (const home of candidateHomes()) {
    const userdata = join(home, "userdata");
    if (!existsSync(userdata)) continue;
    if (!found) found = { home, appPath };
    const secret = join(userdata, "secrets", "ditto-account.bin");
    if (existsSync(secret)) {
      try {
        const parsed = JSON.parse(readFileSync(secret, "utf8")) as { apiKey?: string; apiBaseUrl?: string; linkedAt?: string };
        if (parsed.apiKey && parsed.apiBaseUrl) found.account = { apiKey: parsed.apiKey, apiBaseUrl: parsed.apiBaseUrl, linkedAt: parsed.linkedAt, home };
      } catch {
        /* unreadable: treat as not linked */
      }
    }
    if (found.account) break;
  }
  if (!found && appPath) found = { home: candidateHomes()[0], appPath };
  return found;
}
