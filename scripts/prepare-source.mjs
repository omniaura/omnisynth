import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Package the actual checkout and installed production closure. Never sweep a
// workspace, home directory, local profile or environment file into an archive.
export function prepareSource(destination, root = process.cwd()) {
  const source = join(destination, "source");
  mkdirSync(source, { recursive: true });
  const entries = ["src", "electron", "shared", "docs", "scripts", "build", "assets", "public", ".github",
    "LICENSE", "README.md", "third-party", "package.json", "bun.lock", "tsconfig.json",
    "tsconfig.node.json", "vite.config.ts", "electron-builder.json"];
  const excluded = new Set([".git", "node_modules", ".tmp", ".env", ".npmrc", ".DS_Store"]);
  const copy = (from, to) => cpSync(from, to, { recursive: true, dereference: true,
    filter: (path) => !excluded.has(path.split("/").at(-1)) && !path.split("/").at(-1).startsWith(".env.") });
  for (const entry of entries) if (existsSync(join(root, entry))) copy(join(root, entry), join(source, entry));
  cpSync(join(root, "LICENSE"), join(destination, "LICENSE"));
  const resolvePackage = (name, from) => {
    if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error("Invalid package name in dependency closure");
    let directory = from;
    while (true) {
      const candidate = join(directory, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
      const parent = dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  };
  const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const optionalDependencies = rootPackage.optionalDependencies ?? {};
  const pending = Object.entries({ ...rootPackage.dependencies, ...optionalDependencies }).map(([name]) => ({
    name, from: root, optional: Object.hasOwn(optionalDependencies, name),
  }));
  const seen = new Set();
  const inventory = [];
  let notices = "OmniSynth third-party notices\nSee source/dependencies for installed production package source and notices.\n\n";
  while (pending.length) {
    const { name, from, optional } = pending.pop();
    const directory = resolvePackage(name, from);
    if (!directory) {
      if (optional) continue;
      throw new Error("Missing production dependency: " + name);
    }
    if (seen.has(directory)) continue;
    seen.add(directory);
    const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const key = encodeURIComponent(pkg.name) + "@" + encodeURIComponent(pkg.version);
    copy(directory, join(source, "dependencies", key));
    inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? null, repository: pkg.repository ?? null });
    notices += "\n=== " + pkg.name + " " + pkg.version + " (" + JSON.stringify(pkg.license ?? "undeclared") + ") ===\n";
    for (const file of readdirSync(directory)) {
      if (/^(license|copying|notice|authors)([._-]|$)/i.test(file)) {
        try { notices += "\n--- " + file + " ---\n" + readFileSync(join(directory, file), "utf8") + "\n"; } catch {}
      }
    }
    for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      pending.push({ name: dependency, from: directory, optional: Boolean(pkg.optionalDependencies?.[dependency]) });
    }
  }
  notices += "\n=== MIDI Gen original MIT notice ===\n" + readFileSync(join(root, "third-party/midi-gen-MIT.txt"), "utf8");
  writeFileSync(join(destination, "THIRD_PARTY_NOTICES.txt"), notices);
  writeFileSync(join(source, "dependency-inventory.json"), JSON.stringify(inventory.sort((a, b) => a.name.localeCompare(b.name)), null, 2));
  console.log("Retained source and notices for " + inventory.length + " installed production packages.");
  return inventory;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  prepareSource(resolve(process.argv[2] ?? ".tmp/source-bundle"));
}
