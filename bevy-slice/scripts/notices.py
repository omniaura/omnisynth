#!/usr/bin/env python3
"""Collect declared licenses and notices for this crate's resolved host closure."""
import json
from pathlib import Path
import subprocess

host = next(line.split(": ", 1)[1] for line in subprocess.check_output(["rustc", "-vV"], text=True).splitlines() if line.startswith("host: "))
metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", host], text=True))
nodes = {node["id"]: node for node in metadata["resolve"]["nodes"]}
reachable = set()
pending = [metadata["resolve"]["root"]]
while pending:
    package = pending.pop()
    if package in reachable:
        continue
    reachable.add(package)
    pending.extend(dep["pkg"] for dep in nodes[package]["deps"])
packages = sorted((p for p in metadata["packages"] if p["id"] in reachable), key=lambda p: (p["name"], p["version"]))
assert not any("hydra" in p["name"] or "strudel" in p["name"] for p in packages)
output = Path("target/distribution")
output.mkdir(parents=True, exist_ok=True)
inventory = [{"name": p["name"], "version": p["version"], "license": p["license"], "repository": p["repository"]} for p in packages]
(output / "dependency-licenses.json").write_text(json.dumps({"target": host, "packages": inventory}, indent=2))
with (output / "THIRD_PARTY.txt").open("w") as report:
    report.write("OmniSynth Bevy Slice: resolved dependency notices\nDeclared licenses are inventory, not a substitute for reviewing license terms.\n")
    for package in packages:
        root = Path(package["manifest_path"]).parent
        report.write(f'\n\n=== {package["name"]} {package["version"]}: {package["license"]} ===\n')
        files = [p for p in root.iterdir() if p.is_file() and p.name.upper().startswith(("LICENSE", "COPYING", "NOTICE"))]
        if package["license_file"]:
            files.append(root / package["license_file"])
        for path in sorted(set(files)):
            report.write(f"\n--- {path.name} ---\n")
            report.write(path.read_text(errors="replace"))
    for path in sorted(Path("third-party").iterdir()):
        report.write(f"\n\n=== Explicit bundled notice: {path.name} ===\n")
        report.write(path.read_text())
print(f"Collected notices for {len(packages)} resolved packages on {host}; no Hydra/Strudel packages.")
