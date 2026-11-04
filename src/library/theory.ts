import { NOTE_NAMES, SCALE_INTERVALS } from "../engine/presets";
import { normalizeNote } from "../engine/patterns";

/**
 * Harmony and songwriting knowledge: chord progressions, voicing rules,
 * arrangement templates by genre, and melodic/bassline recipes. Pure data +
 * pure helpers; the agent reads the knowledge pack and calls `use_progression`
 * / `apply_template`, which resolve these into concrete notes and sections.
 */

export interface Progression {
  id: string;
  name: string;
  /** Roman numerals relative to the key; lower = minor, upper = major, ° dim, + aug. Suffixes: 7, maj7, 9, sus2, sus4, add9. */
  numerals: string[];
  mode: "minor" | "major" | "dorian" | "phrygian" | "aeolian" | "mixolydian";
  mood: string[];
  genres: string[];
  /** Beats per chord (4 = one bar in 4/4; 8 = two bars). */
  beatsPerChord: number;
  reference?: string;
}

export const PROGRESSIONS: Progression[] = [
  { id: "i-VI-III-VII", name: "Epic minor loop", numerals: ["i", "VI", "III", "VII"], mode: "minor", mood: ["mysterious", "anthemic", "driving"], genres: ["edm", "trance", "progressive", "synthwave"], beatsPerChord: 8, reference: "Stereo Love; the Levels loop is the i-III-VII-VI rotation" },
  { id: "i-III-VII-VI", name: "Levels rotation", numerals: ["i", "III", "VII", "VI"], mode: "minor", mood: ["uplifting", "nostalgic"], genres: ["edm", "progressive-house", "future-bass"], beatsPerChord: 8, reference: "Avicii - Levels" },
  { id: "VI-VII-i-VI", name: "Brooding climb", numerals: ["VI", "VII", "i", "VI"], mode: "minor", mood: ["brooding", "dark", "nostalgic"], genres: ["dubstep", "trap", "dark-pop"], beatsPerChord: 8, reference: "Skrillex - Scary Monsters" },
  { id: "i-VI-iv-VII", name: "Guetta minor", numerals: ["i", "VI", "iv", "VII"], mode: "minor", mood: ["big-room", "emotional"], genres: ["edm", "big-room"], beatsPerChord: 8 },
  { id: "i-iv-VII-III", name: "Circle of fifths descent", numerals: ["i", "iv", "VII", "III"], mode: "minor", mood: ["cinematic", "melancholic"], genres: ["melodic-techno", "cinematic", "liquid-dnb"], beatsPerChord: 8 },
  { id: "andalusian", name: "Andalusian cadence", numerals: ["i", "VII", "VI", "V"], mode: "minor", mood: ["dramatic", "tense", "flamenco"], genres: ["techno", "psytrance", "darkwave", "trap"], beatsPerChord: 4, reference: "i-♭VII-♭VI-V; the major V (raised 7th) is the whole point; works as an ostinato over a tonic pedal" },
  { id: "phrygian-descent", name: "Phrygian descent", numerals: ["iv", "III", "II", "i"], mode: "phrygian", mood: ["exotic", "claustrophobic", "dark"], genres: ["techno", "industrial", "dubstep"], beatsPerChord: 4 },
  { id: "i-VII-VI-VII", name: "Pendulum minor", numerals: ["i", "VII", "VI", "VII"], mode: "minor", mood: ["hypnotic", "driving"], genres: ["techno", "trance", "synthwave"], beatsPerChord: 4 },
  { id: "i7-IV-dorian", name: "Dorian lift", numerals: ["i7", "IV", "i7", "IV"], mode: "dorian", mood: ["uplifting-minor", "funky", "jazzy"], genres: ["deep-house", "garage", "liquid-dnb", "lofi"], beatsPerChord: 8, reference: "Major IV from Dorian brightens a minor groove" },
  { id: "ii-V-I-jazz", name: "ii-V-I", numerals: ["ii7", "V7", "Imaj7", "Imaj7"], mode: "major", mood: ["jazzy", "resolved", "warm"], genres: ["lofi", "deep-house", "jazz-house", "liquid-dnb"], beatsPerChord: 4 },
  { id: "I-V-vi-IV", name: "Axis (pop)", numerals: ["I", "V", "vi", "IV"], mode: "major", mood: ["euphoric", "pop", "open"], genres: ["progressive-house", "pop-edm", "future-bass"], beatsPerChord: 8, reference: "Don't You Worry Child" },
  { id: "vi-IV-I-V", name: "Axis (minor start)", numerals: ["vi", "IV", "I", "V"], mode: "major", mood: ["bittersweet", "anthemic"], genres: ["edm", "pop-edm"], beatsPerChord: 8 },
  { id: "i-i-i-i-pedal", name: "One-chord drone", numerals: ["i", "i", "i", "i"], mode: "minor", mood: ["hypnotic", "minimal", "dark"], genres: ["techno", "dub-techno", "acid", "dnb"], beatsPerChord: 4, reference: "Most techno/DnB: one tonal center; movement comes from bass octaves, filters and the 5th/♭7 in leads" },
  { id: "i-v-minor-plagal", name: "Minor plagal sway", numerals: ["i", "iv", "i", "v"], mode: "minor", mood: ["moody", "sway", "deep"], genres: ["deep-house", "dub-techno", "ambient"], beatsPerChord: 8 },
  { id: "i-VI-VII-III-rave", name: "Rave stabs", numerals: ["i", "VI", "VII", "III"], mode: "minor", mood: ["rave", "euphoric", "90s"], genres: ["hardcore", "rave", "breaks", "garage"], beatsPerChord: 4 },
  { id: "sus-float", name: "Suspended float", numerals: ["isus2", "VIadd9", "IIIsus2", "VIIsus4"], mode: "minor", mood: ["floating", "ambient", "modern"], genres: ["melodic-techno", "ambient", "future-garage", "burial"], beatsPerChord: 8, reference: "Suspensions avoid the 3rd so the mode stays ambiguous" },
];

const NUMERAL_DEGREE: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };

interface ParsedNumeral {
  degree: number;
  quality: "major" | "minor" | "dim";
  ext: string;
  flat: boolean;
}

export function parseNumeral(n: string): ParsedNumeral {
  const m = n.match(/^(♭|b)?([ivIV]+)(°|o)?(.*)$/);
  if (!m) throw new Error(`bad numeral "${n}"`);
  const [, flat, roman, dim, ext] = m;
  const degree = NUMERAL_DEGREE[roman.toLowerCase()];
  if (degree === undefined) throw new Error(`bad numeral "${n}"`);
  const quality = dim ? "dim" : roman === roman.toUpperCase() ? "major" : "minor";
  return { degree, quality, ext: ext ?? "", flat: Boolean(flat) };
}

/** Resolve a numeral in a key/mode to note names (root-position voicing), with octave. */
export function chordNotes(key: string, mode: string, numeral: string, octave = 3): string[] {
  const intervals = SCALE_INTERVALS[mode] ?? SCALE_INTERVALS.minor;
  const root = Math.max(0, NOTE_NAMES.indexOf(normalizeNote(key)));
  const p = parseNumeral(numeral);
  let rootSemis = root + intervals[p.degree % intervals.length];
  if (p.flat) rootSemis -= 1;
  const third = p.quality === "major" ? 4 : 3;
  const fifth = p.quality === "dim" ? 6 : 7;
  let semis = [0, third, fifth];
  const e = p.ext.toLowerCase();
  if (e.startsWith("sus2")) semis = [0, 2, 7];
  else if (e.startsWith("sus4")) semis = [0, 5, 7];
  if (e.includes("maj7")) semis.push(11);
  else if (e.includes("7")) semis.push(10);
  if (e.includes("9") || e.includes("add9")) semis.push(14);
  if (e.includes("6")) semis.push(9);
  return semis.map((s) => {
    const n = rootSemis + s;
    return `${NOTE_NAMES[((n % 12) + 12) % 12]}${octave + Math.floor(n / 12)}`;
  });
}

/** Voicing helpers the agent can ask for. */
export type Voicing = "root" | "spread" | "rootless" | "drop2" | "stab";

export function voice(notes: string[], voicing: Voicing): string[] {
  const toMidi = (n: string) => {
    const m = n.match(/^([A-G][#b]?)(-?\d+)$/);
    if (!m) return 60;
    return (Number(m[2]) + 1) * 12 + NOTE_NAMES.indexOf(normalizeNote(m[1]));
  };
  const toName = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  const midis = notes.map(toMidi);
  switch (voicing) {
    case "spread":
      // root low, 5th in the middle, 3rd/extensions up an octave — leaves room for the bass
      return [midis[0] - 12, midis[2] ?? midis[0] + 7, ...midis.slice(1).filter((_, i) => i !== 1).map((m) => m + 12)].sort((a, b) => a - b).map(toName);
    case "rootless":
      return midis.slice(1).map(toName);
    case "drop2": {
      const sorted = [...midis].sort((a, b) => a - b);
      if (sorted.length < 3) return sorted.map(toName);
      const second = sorted.splice(sorted.length - 2, 1)[0] - 12;
      return [second, ...sorted].sort((a, b) => a - b).map(toName);
    }
    case "stab":
      // close voicing an octave up, no root: classic house/garage stab
      return midis.slice(1).map((m) => m + 12).map(toName);
    default:
      return notes;
  }
}

export interface ArrangementSection {
  id: string;
  name: string;
  bars: number;
  energy: number; // 0..1
  /** What the producer should do in this section. */
  recipe: string;
  timeSignature?: [number, number];
  bpmScale?: number;
}

export interface ArrangementTemplate {
  id: string;
  genres: string[];
  bpm: [number, number];
  sections: ArrangementSection[];
  arrangement: string[];
  notes: string;
}

export const ARRANGEMENTS: ArrangementTemplate[] = [
  {
    id: "club-abab",
    genres: ["house", "techno", "tech-house", "trance"],
    bpm: [120, 140],
    notes: "DJ-friendly: long beat-led intro/outro, ABAB with a shorter first breakdown and a longer second one.",
    sections: [
      { id: "intro", name: "Intro", bars: 16, energy: 0.3, recipe: "Kick + hats + one textural element; no bass hook yet. Filter closed." },
      { id: "build1", name: "Build", bars: 8, energy: 0.55, recipe: "Add bass + percussion; automate filter open; riser last 4 bars; snare roll via ratchets." },
      { id: "drop1", name: "Drop", bars: 16, energy: 0.9, recipe: "Full groove: all drums, bass, chords/stab, lead. Sidechain pumping." },
      { id: "break", name: "Breakdown", bars: 16, energy: 0.35, recipe: "Drop the kick and bass. Pads/chords + melodic hook, reverb wet up, evolve the lead (transpose_scale / lsystem)." },
      { id: "build2", name: "Build 2", bars: 8, energy: 0.65, recipe: "Kick returns at bar 4; density/probability up; 1 bar of silence before the drop." },
      { id: "drop2", name: "Drop 2", bars: 32, energy: 1.0, recipe: "Variation of drop 1: extra percussion, euclid_morph on hats, new counter-melody. Evolution rules active." },
      { id: "outro", name: "Outro", bars: 16, energy: 0.3, recipe: "Strip to drums + one element; filter closing; probability erosion to silence." },
    ],
    arrangement: ["intro", "build1", "drop1", "break", "build2", "drop2", "outro"],
  },
  {
    id: "techno-hypnotic",
    genres: ["techno", "dub-techno", "hypnotic", "acid"],
    bpm: [126, 140],
    notes: "No hard drop: the theme recurs; movement is continuous via evolution and automation. 32-bar phrases.",
    sections: [
      { id: "intro", name: "Intro", bars: 32, energy: 0.3, recipe: "Kick, rumble, hats; one percussive 3-step cycle." },
      { id: "body-a", name: "Body A", bars: 32, energy: 0.7, recipe: "Bass enters; acid line with slides; markov evolution on perc every 4 bars." },
      { id: "shift", name: "Shift", bars: 16, energy: 0.5, recipe: "Kick out for 8 then back; stab/dub chord with long delay; filter walk." },
      { id: "body-b", name: "Body B", bars: 32, energy: 0.85, recipe: "Everything in; param_walk on cutoff; cellular on the 5-step perc; ride 16ths." },
      { id: "outro", name: "Outro", bars: 32, energy: 0.3, recipe: "Remove elements every 8 bars." },
    ],
    arrangement: ["intro", "body-a", "shift", "body-b", "outro"],
  },
  {
    id: "bass-140",
    genres: ["dubstep", "riddim", "halftime", "trap"],
    bpm: [136, 150],
    notes: "Drop at bar 32 (~0:55 @140). Drops are three 8-bar statements of the bass idea, each developing.",
    sections: [
      { id: "intro", name: "Intro", bars: 16, energy: 0.3, recipe: "Atmos pad, sparse hats, vocal-ish bell motif; hint of the bass filtered." },
      { id: "build", name: "Build", bars: 16, energy: 0.6, recipe: "Snare rolls (ratchet 2→4), riser cutoff automation, LFO rate 8n→16n over the last 2 bars, 1 beat silence." },
      { id: "drop", name: "Drop", bars: 24, energy: 1.0, recipe: "Kick 1 / snare 3; wobble bass with 3 statements (8 bars each): wobble, growl variation, half-rate wub. Sidechain everything to the kick." },
      { id: "break", name: "Break", bars: 16, energy: 0.35, recipe: "Pads + bell motif; bass muted; evolve the motif." },
      { id: "build2", name: "Build 2", bars: 8, energy: 0.7, recipe: "Faster rolls, pitch riser." },
      { id: "drop2", name: "Drop 2", bars: 24, energy: 1.0, recipe: "Switch LFO shape / rate, add a counter bass, euclid_morph on perc." },
      { id: "outro", name: "Outro", bars: 8, energy: 0.3, recipe: "Pad and bell fade." },
    ],
    arrangement: ["intro", "build", "drop", "break", "build2", "drop2", "outro"],
  },
  {
    id: "dnb-roller",
    genres: ["dnb", "liquid", "neuro", "jungle"],
    bpm: [170, 176],
    notes: "Intro 32, drop 32+ in two halves (A/B bass), break 16, second drop longer.",
    sections: [
      { id: "intro", name: "Intro", bars: 32, energy: 0.35, recipe: "Pads/keys, chopped break hats; 2-step hinted with filtered kick at bar 17; snare rolls at 29-32." },
      { id: "drop", name: "Drop", bars: 32, energy: 0.95, recipe: "2-step kick/snare, shuffle hats, Reese on long notes with LFO; 16-bar A bass then 16-bar B variation." },
      { id: "break", name: "Break", bars: 16, energy: 0.35, recipe: "Melodic pad + bell; drums out; markov on hats returns at bar 13." },
      { id: "drop2", name: "Drop 2", bars: 48, energy: 1.0, recipe: "Both bass ideas + neuro stutter; euclid_morph on the ghost snare; Amen-style resequence every 8." },
      { id: "outro", name: "Outro", bars: 16, energy: 0.3, recipe: "Pads and hats only." },
    ],
    arrangement: ["intro", "drop", "break", "drop2", "outro"],
  },
  {
    id: "garage-2step",
    genres: ["garage", "ukg", "2-step", "future-garage"],
    bpm: [128, 136],
    notes: "Shorter sections; the shuffle is the hook. Vocal-chop/organ stab call-and-response.",
    sections: [
      { id: "intro", name: "Intro", bars: 8, energy: 0.3, recipe: "Pad + shuffled hats + rim skips." },
      { id: "verse", name: "Verse", bars: 16, energy: 0.6, recipe: "2-step kick/snare, wobbly bass, organ stab on offbeats." },
      { id: "chorus", name: "Chorus", bars: 16, energy: 0.9, recipe: "Add bell/chop lead answering the stab; sub octave on bass." },
      { id: "break", name: "Break", bars: 8, energy: 0.35, recipe: "Pad + chop; snare only." },
      { id: "chorus2", name: "Chorus 2", bars: 16, energy: 1.0, recipe: "Rotate hats, stutter rims, probability on bass." },
      { id: "outro", name: "Outro", bars: 8, energy: 0.3, recipe: "Pad fades." },
    ],
    arrangement: ["intro", "verse", "chorus", "break", "chorus2", "outro"],
  },
  {
    id: "idm-mutating",
    genres: ["idm", "braindance", "glitch", "aphex", "autechre"],
    bpm: [90, 170],
    notes: "Sections differ in meter; the material mutates rather than repeats. Odd meters are welcome.",
    sections: [
      { id: "a", name: "A (7/8)", bars: 16, energy: 0.5, recipe: "Displaced kick in 7/8, 32n glitch lane with probabilities, bell motif via lsystem.", timeSignature: [7, 8] },
      { id: "b", name: "B (4/4)", bars: 16, energy: 0.75, recipe: "Straighten to 4/4; acid or FM bass; genetic evolution toward density 0.5 / syncopation 0.6." },
      { id: "c", name: "C (5/4)", bars: 8, energy: 0.6, recipe: "5/4 3+2; pads; markov order 3 on the bell, temperature 1.3.", timeSignature: [5, 4] },
      { id: "d", name: "D (4/4 drop)", bars: 24, energy: 1.0, recipe: "Drill 'n' bass snare rushes (ratchet), reese, cellular rule 110 on perc; reset every 16." },
      { id: "coda", name: "Coda", bars: 8, energy: 0.3, recipe: "Bell + reverb tail; probability erosion.", timeSignature: [7, 8] },
    ],
    arrangement: ["a", "b", "c", "d", "a", "coda"],
  },
  {
    id: "synthwave-pop",
    genres: ["synthwave", "retrowave", "pop-edm", "future-bass"],
    bpm: [85, 120],
    notes: "Pop-like: verse/chorus with short intro/outro; chords change every 2 bars.",
    sections: [
      { id: "intro", name: "Intro", bars: 4, energy: 0.35, recipe: "Pad + arp." },
      { id: "verse", name: "Verse", bars: 16, energy: 0.55, recipe: "Drums (gated snare), FM bass, PWM lead motif (call), rests." },
      { id: "pre", name: "Pre", bars: 8, energy: 0.7, recipe: "Build: tom fills, rising arp, filter." },
      { id: "chorus", name: "Chorus", bars: 16, energy: 0.95, recipe: "Supersaw chords, lead answer phrase an octave up, big reverb." },
      { id: "verse2", name: "Verse 2", bars: 16, energy: 0.6, recipe: "Verse with counter-melody." },
      { id: "chorus2", name: "Chorus 2", bars: 16, energy: 1.0, recipe: "Chorus with bell doubling." },
      { id: "outro", name: "Outro", bars: 8, energy: 0.3, recipe: "Pad + arp." },
    ],
    arrangement: ["intro", "verse", "pre", "chorus", "verse2", "pre", "chorus2", "outro"],
  },
];

export const ARRANGEMENT_BY_ID: Record<string, ArrangementTemplate> = Object.fromEntries(ARRANGEMENTS.map((a) => [a.id, a]));
export const PROGRESSION_BY_ID: Record<string, Progression> = Object.fromEntries(PROGRESSIONS.map((p) => [p.id, p]));

export function searchProgressions(query: string): Progression[] {
  const q = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return PROGRESSIONS.filter((p) => q.every((t) => p.id.toLowerCase().includes(t) || p.mood.some((m) => m.includes(t)) || p.genres.some((g) => g.includes(t)) || p.name.toLowerCase().includes(t)));
}

export function searchArrangements(query: string): ArrangementTemplate[] {
  const q = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return ARRANGEMENTS.filter((a) => q.every((t) => a.id.includes(t) || a.genres.some((g) => g.includes(t))));
}
