import { engine, type SongFile } from "../engine/engine";
import { store } from "../stores/app";
import { bridge } from "../agent/client";
import type { ToolContext } from "../agent/tools";
import { strudel } from "../engine/strudel";

type ProjectFile = SongFile & { strudel?: { code: string; selected: boolean } };
function exportProject(name: string): ProjectFile {
  return { ...engine.exportSong(name, store.visuals()), strudel: { code: strudel.code(), selected: strudel.selected() === "strudel" } };
}
async function importProject(file: ProjectFile): Promise<void> {
  await strudel.stop();
  await engine.importSong(file);
  if (file.strudel && typeof file.strudel.code === "string") strudel.setCode(file.strudel.code);
  await strudel.select(file.strudel?.selected ? "strudel" : "tone");
}

/** Song persistence: a local library in localStorage plus file export/import through the shell. */

const INDEX_KEY = "omnisynth.songs";

export interface SavedSong {
  key: string;
  name: string;
  bpm: number;
  tracks: number;
  timestamp: number;
}

function index(): string[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function saveSong(name: string): string {
  const baseKey = `omnisynth.song.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const file = exportProject(name);
  let key = baseKey;
  for (let suffix = 1; ; suffix++) {
    const existing = localStorage.getItem(key);
    if (existing === null) break;
    try {
      if ((JSON.parse(existing) as SongFile).name === name) break;
    } catch {
      // Keep malformed entries rather than replacing them.
    }
    key = `${baseKey}-${suffix}`;
  }
  localStorage.setItem(key, JSON.stringify(file));
  const keys = index();
  if (!keys.includes(key)) localStorage.setItem(INDEX_KEY, JSON.stringify([...keys, key]));
  store.setSongName(name);
  return key;
}

export function listSongs(): SavedSong[] {
  return index()
    .map((key) => {
      try {
        const data = JSON.parse(localStorage.getItem(key) ?? "") as SongFile;
        return { key, name: data.name ?? key, bpm: data.bpm, tracks: data.tracks?.length ?? 0, timestamp: data.timestamp };
      } catch {
        return null;
      }
    })
    .filter((s): s is SavedSong => s !== null)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function loadSong(key: string): Promise<string> {
  const raw = localStorage.getItem(key);
  if (!raw) throw new Error(`song "${key}" not found`);
  const file = JSON.parse(raw) as ProjectFile;
  await importProject(file);
  if (file.visuals) store.setVisuals(file.visuals);
  store.setSongName(file.name ?? "Untitled");
  return `Loaded "${file.name}" (${file.tracks.length} tracks, ${file.bpm} BPM).`;
}

export function deleteSong(key: string): void {
  localStorage.removeItem(key);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index().filter((k) => k !== key)));
}

export async function exportSongFile(): Promise<void> {
  const file = exportProject(store.songName());
  const json = JSON.stringify(file, null, 2);
  const b = bridge();
  if (b) {
    const path = await b.files.saveJson(`${store.songName() || "song"}.omnisynth.json`, json);
    if (path) store.showToast(`Exported to ${path}`);
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `${store.songName() || "song"}.omnisynth.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function importSongFile(): Promise<void> {
  const b = bridge();
  if (!b) return;
  const json = await b.files.openJson();
  if (!json) return;
  const file = JSON.parse(json) as ProjectFile;
  await importProject(file);
  if (file.visuals) store.setVisuals(file.visuals);
  store.setSongName(file.name ?? "Imported");
  store.showToast(`Imported "${file.name ?? "song"}"`);
}

export const toolContext: ToolContext = {
  setVisuals: (code) => store.setVisuals(code),
  getVisuals: () => store.visuals(),
  setView: (view) => store.setView(view),
  saveSong,
  listSongs: () => listSongs().map((s) => ({ name: s.name, key: s.key, bpm: s.bpm, tracks: s.tracks })),
  loadSong,
};
