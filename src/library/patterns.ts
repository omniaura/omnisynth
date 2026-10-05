import type { Step, Subdivision } from "../engine/patterns";

/**
 * Rhythm library: canonical one- and two-bar grids per genre and role, from
 * Attack Magazine "Beat Dissected", LANDR drum programming, Studio Brootle,
 * Roland TR-909/303 docs, Toussaint's Euclidean catalogue, and the genre
 * descriptions gathered in docs/KNOWLEDGE.md. Steps are 16n unless noted.
 *
 * Notation in `grid`: "x" hit · "X" accent (vel 1.0) · "." rest · "g" ghost
 * (vel 0.35) · "r" ratchet×2 · "p" probability 0.5 · "o" open (longer).
 */

export interface LibraryPattern {
  id: string;
  role: "kick" | "snare" | "clap" | "hat" | "hat-open" | "perc" | "bass" | "chords" | "lead" | "arp";
  genre: string[];
  bpm: [number, number];
  subdivision: Subdivision;
  /** Beats per bar this grid assumes (default 4). */
  meter?: [number, number];
  grid: string;
  /** Default swing nudge in ms applied to offbeat 16ths (garage/house shuffle). */
  swingMs?: number;
  notes?: string;
  /** For melodic roles: scale-degree pattern, 1-based; 0 = rest, +7 = octave up. */
  degrees?: number[];
}

export function gridToSteps(grid: string, opts: { note?: string; octave?: number; duration?: string; swingMs?: number } = {}): Step[] {
  const chars = grid.replace(/\s+/g, "").split("");
  return chars.map((c, i) => {
    const offbeat = i % 2 === 1;
    const nudge = opts.swingMs && offbeat ? opts.swingMs : undefined;
    const base: Step = opts.note ? { note: opts.note, duration: opts.duration ?? "16n" } : { hit: true, duration: opts.duration ?? "16n" };
    switch (c) {
      case ".":
        return { rest: true };
      case "x":
        return { ...base, velocity: 0.8, ...(nudge ? { nudge } : {}) };
      case "X":
        return { ...base, velocity: 1.0, ...(nudge ? { nudge } : {}) };
      case "g":
        return { ...base, velocity: 0.35, ...(nudge ? { nudge } : {}) };
      case "r":
        return { ...base, velocity: 0.8, ratchet: 2, ...(nudge ? { nudge } : {}) };
      case "p":
        return { ...base, velocity: 0.7, prob: 0.5, ...(nudge ? { nudge } : {}) };
      case "o":
        return { ...base, velocity: 0.75, duration: "8n", ...(nudge ? { nudge } : {}) };
      default:
        return { rest: true };
    }
  });
}

export const PATTERN_LIBRARY: LibraryPattern[] = [
  // ── HOUSE (120-128) ──
  { id: "house-kick-4x4", role: "kick", genre: ["house", "techno", "trance", "disco"], bpm: [118, 135], subdivision: "16n", grid: "X...x...X...x..." },
  { id: "house-clap-24", role: "clap", genre: ["house", "techno", "trance"], bpm: [118, 135], subdivision: "16n", grid: "....X.......X..." },
  { id: "house-hat-offbeat-open", role: "hat-open", genre: ["house", "techno", "disco"], bpm: [118, 135], subdivision: "16n", grid: "..o...o...o...o.", notes: "Open hat on the offbeat 8ths; length tucks under the clap" },
  { id: "house-hat-16ths", role: "hat", genre: ["house", "deep-house", "tech-house"], bpm: [118, 130], subdivision: "16n", grid: "xgxgxgXgxgxgxgXg", swingMs: 14, notes: "16ths with accents on 7/15 and light swing" },
  { id: "deep-house-perc-shaker", role: "perc", genre: ["deep-house", "lofi-house"], bpm: [118, 126], subdivision: "16n", grid: ".g.x.g.x.g.x.g.X", swingMs: 18 },
  { id: "tech-house-hat-syncop", role: "hat", genre: ["tech-house"], bpm: [122, 128], subdivision: "16n", grid: "..x..x..x..x.xx.", notes: "Offbeat closed hat with 32nd-ish flicks (use ratchet)" },
  { id: "house-bass-offbeat", role: "bass", genre: ["house", "tech-house", "garage"], bpm: [118, 135], subdivision: "16n", grid: "..x...x...x...x.", degrees: [1, 1, 1, 1], notes: "Root on the offbeat 8ths (classic house bass); kick owns the downbeat" },
  { id: "house-bass-octave-bounce", role: "bass", genre: ["house", "disco", "french"], bpm: [118, 128], subdivision: "16n", grid: "x.x.x.x.x.x.x.x.", degrees: [1, 8, 1, 8, 1, 8, 5, 8], notes: "Root/octave bounce, disco walking feel" },
  { id: "house-chords-stab-offbeat", role: "chords", genre: ["house", "garage"], bpm: [118, 135], subdivision: "16n", grid: "..x...x...x...x.", notes: "M1 piano / Juno stab on the 'and' of every beat" },
  { id: "house-chords-2bar-change", role: "chords", genre: ["deep-house", "progressive", "melodic"], bpm: [118, 128], subdivision: "4n", grid: "x...x...", notes: "Hold one chord per 2 bars (8 beats); change on beat 1" },

  // ── TECHNO (125-140) ──
  { id: "techno-kick-4x4-rumble", role: "kick", genre: ["techno", "warehouse"], bpm: [128, 140], subdivision: "16n", grid: "X...X...X...X..." },
  { id: "techno-clap-sparse", role: "clap", genre: ["techno", "dark-techno"], bpm: [128, 140], subdivision: "16n", grid: "............X...", notes: "Clap only on the 4th kick (darker, sparser)" },
  { id: "techno-hat-16-roll", role: "hat", genre: ["techno", "hard-techno"], bpm: [128, 145], subdivision: "16n", grid: "xgxgXgxgxgxgXgxg", notes: "Rolling 16ths: 50% velocity with accents; add 909 ride on top" },
  { id: "techno-ride-16", role: "perc", genre: ["techno"], bpm: [128, 140], subdivision: "16n", grid: "Xgxgxgxgxgxgxgxg" },
  { id: "techno-perc-3-step", role: "perc", genre: ["techno", "hypnotic"], bpm: [128, 140], subdivision: "16n", grid: "x..x..x..x..x..x", notes: "3-step cycle against 4/4 (polymeter), hypnotic" },
  { id: "techno-perc-5-step", role: "perc", genre: ["techno", "hypnotic", "idm"], bpm: [125, 140], subdivision: "16n", grid: "x....x....x....x", notes: "5-step cycle; pair with 3-step for a 15-step phase" },
  { id: "acid-bass-16", role: "bass", genre: ["acid", "techno", "acid-house"], bpm: [120, 135], subdivision: "16n", grid: "X.x.X.xxX.x.X.x.", degrees: [1, 1, 8, 1, 3, 1, 1, 5, 8], notes: "303: accents on X, slide every 3rd/4th note, octave jumps; velocity 0.6 normal / 1.0 accent" },
  { id: "techno-stab-dub", role: "chords", genre: ["dub-techno", "techno"], bpm: [120, 130], subdivision: "16n", grid: "...x.......x....", notes: "Dub chord every other offbeat, long delay feedback" },

  // ── TRANCE (136-142) ──
  { id: "trance-kick", role: "kick", genre: ["trance", "uplifting"], bpm: [136, 142], subdivision: "16n", grid: "X...X...X...X..." },
  { id: "trance-bass-offbeat-octave", role: "bass", genre: ["trance", "progressive"], bpm: [130, 142], subdivision: "16n", grid: "..x...x...x...x.", degrees: [1, 1, 1, 1], notes: "Offbeat rolling bass; use the 8n-grid version with 16th pickups for drive" },
  { id: "trance-arp-pluck", role: "arp", genre: ["trance", "uplifting"], bpm: [136, 142], subdivision: "16n", grid: "xxxxxxxxxxxxxxxx", degrees: [1, 5, 8, 5, 1, 5, 8, 5, 1, 5, 8, 5, 3, 5, 8, 10], notes: "Root-5-8-5 pluck; gate ~50%; make one note per bar an 8n" },
  { id: "trance-arp-rolling", role: "arp", genre: ["trance", "euphoric"], bpm: [136, 142], subdivision: "16n", grid: "xxxxxxxxxxxxxxxx", degrees: [1, 3, 5, 8, 1, 3, 5, 8, 1, 3, 5, 8, 3, 5, 8, 12], notes: "Ascending 4-note shape, octave jump at bar end; gate 85%+" },

  // ── DRUM & BASS / JUNGLE (170-176) ──
  { id: "dnb-kick-2step", role: "kick", genre: ["dnb", "jungle", "liquid"], bpm: [168, 178], subdivision: "16n", grid: "X.........x.....", notes: "Kick on 1 and the 'and' of 3 (step 11)" },
  { id: "dnb-snare-24", role: "snare", genre: ["dnb", "jungle", "neuro"], bpm: [168, 178], subdivision: "16n", grid: "....X.......X..." },
  { id: "dnb-hat-shuffle", role: "hat", genre: ["dnb", "liquid"], bpm: [168, 178], subdivision: "16n", grid: "x.x.x.xgx.x.x.xg", notes: "8th hats with quiet 16th pickups on steps 8/16 (vel ~0.4)" },
  { id: "dnb-ghost-snare", role: "perc", genre: ["dnb", "jungle"], bpm: [168, 178], subdivision: "16n", grid: ".......g.......g", notes: "Ghost snare after the offbeat hat" },
  { id: "jungle-amen-resequence", role: "snare", genre: ["jungle", "breakcore"], bpm: [160, 175], subdivision: "16n", grid: "....X..g..g.X.g.", notes: "Amen-style: main snares 5/13 with ghosts, program 2 bars with a variation in bar 2" },
  { id: "jungle-kick-roll", role: "kick", genre: ["jungle"], bpm: [160, 175], subdivision: "16n", grid: "X.....x...x.....", notes: "Kick 1, and-of-2, and-of-3" },
  { id: "dnb-reese-long", role: "bass", genre: ["dnb", "neuro", "jungle"], bpm: [168, 178], subdivision: "8n", grid: "x...x.x.", degrees: [1, 0, 0, 0, 1, 0, 5, 0], notes: "Long Reese notes with glide; movement from LFO on cutoff, not from notes" },
  { id: "neuro-bass-stutter", role: "bass", genre: ["neuro", "dnb"], bpm: [170, 176], subdivision: "16n", grid: "x..x.x..x..xx.x.", degrees: [1, 0, 0, 1, 0, 1, 0, 0, 3, 0, 0, 1, 1, 0, 5, 0] },

  // ── DUBSTEP / HALFTIME (140) ──
  { id: "dubstep-kick-half", role: "kick", genre: ["dubstep", "halftime", "riddim"], bpm: [136, 145], subdivision: "16n", grid: "X.........p.....", notes: "Kick on 1, optional ghost on 3.5" },
  { id: "dubstep-snare-3", role: "snare", genre: ["dubstep", "halftime", "trap"], bpm: [136, 145], subdivision: "16n", grid: "........X.......", notes: "Snare on beat 3 only (halftime)" },
  { id: "dubstep-hat-8ths", role: "hat", genre: ["dubstep", "riddim"], bpm: [136, 145], subdivision: "16n", grid: "x.x.x.x.x.x.x.xr", notes: "8th hats at full tempo keep the 140 pulse; ratchet into bar 2" },
  { id: "dubstep-wobble-bass", role: "bass", genre: ["dubstep", "brostep"], bpm: [136, 145], subdivision: "8n", grid: "x.x.x.x.", degrees: [1, 0, 1, 0, 1, 0, 1, 0], notes: "Rhythm comes from the LFO (8n wub / 16n talk) — write the bass rhythm against the drums, not on top" },
  { id: "riddim-bass-triplet", role: "bass", genre: ["riddim", "dubstep"], bpm: [140, 150], subdivision: "8n", grid: "xx.xx.xx", degrees: [1, 1, 0, 1, 1, 0, 1, 1], notes: "Triplet-feel riddim stabs; LFO rate 4n triplet" },

  // ── TRAP / DRILL (130-150, feels half) ──
  { id: "trap-kick", role: "kick", genre: ["trap", "hip-hop"], bpm: [130, 150], subdivision: "16n", grid: "X......x..X....." },
  { id: "trap-snare-3", role: "snare", genre: ["trap", "drill"], bpm: [130, 150], subdivision: "16n", grid: "........X......." },
  { id: "trap-hat-rolls", role: "hat", genre: ["trap", "drill"], bpm: [130, 150], subdivision: "16n", grid: "x.x.x.x.x.rrx.xr", notes: "8ths with 32nd rolls (ratchet) before the snare / at phrase ends; crescendo velocity" },
  { id: "drill-kick-slide", role: "kick", genre: ["drill", "uk-drill"], bpm: [138, 146], subdivision: "16n", grid: "X.........x.....", notes: "808 on 1 and the and-a of 3 (step 11); slide between notes" },
    { id: "trap-808-notes", role: "bass", genre: ["trap", "drill"], bpm: [130, 150], subdivision: "16n", grid: "X......x..X.....", degrees: [1, 0, 0, 0, 0, 0, 0, 5, 0, 0, 1, 0, 0, 0, 0, 0], notes: "808 follows the kick pattern; slide into the 5th" },

  // ── UK GARAGE / 2-STEP (130-135) ──
  { id: "ukg-kick-2step", role: "kick", genre: ["garage", "ukg", "2-step"], bpm: [128, 136], subdivision: "16n", grid: "X.........x.....", notes: "Kick skips beats 2 and 4; snare on 2 and 4" },
  { id: "ukg-snare-24", role: "snare", genre: ["garage", "ukg", "2-step"], bpm: [128, 136], subdivision: "16n", grid: "....X.......X..." },
  { id: "ukg-hat-shuffle", role: "hat", genre: ["garage", "ukg", "2-step"], bpm: [128, 136], subdivision: "16n", grid: "x.xgx.x.x.xgx.xg", swingMs: 22, notes: "Swung 16ths (~60%), ghost pickups; shuffle lives here" },
  { id: "ukg-rim-skip", role: "perc", genre: ["garage", "ukg"], bpm: [128, 136], subdivision: "16n", grid: "...x.....x....x.", swingMs: 22, notes: "Scattered rimshots/woodblocks" },
  { id: "ukg-bass-wobble", role: "bass", genre: ["garage", "bassline", "speed-garage"], bpm: [128, 136], subdivision: "16n", grid: "x..x..x...x.x...", degrees: [1, 0, 0, 1, 0, 0, 8, 0, 0, 0, 1, 0, 5, 0, 0, 0], swingMs: 10 },
  { id: "ukg-organ-stab", role: "chords", genre: ["garage", "ukg"], bpm: [128, 136], subdivision: "16n", grid: "..x....x..x....x", swingMs: 22 },

  // ── BREAKS / BIG BEAT / IDM (90-170) ──
  { id: "breaks-kick-funk", role: "kick", genre: ["breaks", "big-beat", "hip-hop", "boom-bap"], bpm: [85, 135], subdivision: "16n", grid: "X..x..x...x..x.." },
  { id: "breaks-snare-24-ghost", role: "snare", genre: ["breaks", "boom-bap", "big-beat"], bpm: [85, 135], subdivision: "16n", grid: "....X..g....X.g." },
  { id: "idm-kick-displaced", role: "kick", genre: ["idm", "braindance", "aphex"], bpm: [120, 170], subdivision: "16n", grid: "X..x.x....x..X.." , notes: "Displaced kicks; then set_evolution markov/rotate every 2 bars" },
  { id: "idm-perc-32-glitch", role: "perc", genre: ["idm", "glitch", "autechre"], bpm: [120, 170], subdivision: "32n", grid: "x..r.x.p..x.r...x.p..x..r.x...p.", notes: "32n glitch lane with ratchets and probabilities" },
  { id: "idm-snare-drill", role: "snare", genre: ["drill-n-bass", "idm", "squarepusher"], bpm: [160, 190], subdivision: "16n", grid: "....X.rr....Xr.r", notes: "Drill 'n' bass snare rushes via ratchets" },

  // ── FOOTWORK / JUKE (160) ──
  { id: "juke-kick-triplet", role: "kick", genre: ["footwork", "juke"], bpm: [155, 165], subdivision: "16n", grid: "X..X..X.X..X..X.", notes: "Tresillo-ish 3-3-2 kick runs; pitch the kick (tom-808) chromatically" },
  { id: "juke-clap", role: "clap", genre: ["footwork", "juke", "ghetto-house"], bpm: [155, 165], subdivision: "16n", grid: "....X.......X..." },

  // ── EUCLIDEAN / WORLD (any tempo) ──
  { id: "euclid-tresillo-3-8", role: "perc", genre: ["world", "latin", "any"], bpm: [80, 180], subdivision: "8n", grid: "x..x..x.", notes: "E(3,8) tresillo / habanera" },
  { id: "euclid-cinquillo-5-8", role: "perc", genre: ["world", "latin", "any"], bpm: [80, 180], subdivision: "8n", grid: "x.xx.xx.", notes: "E(5,8) cinquillo" },
  { id: "euclid-bembe-7-12", role: "perc", genre: ["world", "african", "any"], bpm: [80, 180], subdivision: "8n", meter: [12, 8], grid: "x.xx.x.x.xx.", notes: "E(7,12) West African bell (12/8)" },
  { id: "euclid-bossa-5-16", role: "perc", genre: ["world", "bossa", "any"], bpm: [80, 180], subdivision: "16n", grid: "x..x..x...x..x..", notes: "E(5,16) bossa nova necklace" },
  { id: "euclid-aksak-4-9", role: "perc", genre: ["world", "turkish", "odd"], bpm: [80, 180], subdivision: "8n", meter: [9, 8], grid: "x.x.x.x..", notes: "E(4,9) Turkish aksak" },
  { id: "odd-7-8-223", role: "kick", genre: ["odd", "prog", "balkan", "idm"], bpm: [100, 170], subdivision: "8n", meter: [7, 8], grid: "X.x.x..", notes: "7/8 grouped 2+2+3 (= E(3,7))" },
  { id: "odd-7-8-322", role: "kick", genre: ["odd", "prog", "idm"], bpm: [100, 170], subdivision: "8n", meter: [7, 8], grid: "X..x.x.", notes: "7/8 grouped 3+2+2" },
  { id: "odd-5-4-32", role: "kick", genre: ["odd", "prog", "jazz"], bpm: [100, 170], subdivision: "16n", meter: [5, 4], grid: "X...........X.......", notes: "5/4 grouped 3+2: anchors on 1 and 4" },
  { id: "odd-11-8", role: "kick", genre: ["odd", "idm", "venetian-snares"], bpm: [120, 180], subdivision: "8n", meter: [11, 8], grid: "X.x.x.X.x.x", notes: "11/8 as 2+2+2+2+3 → 3+3+3+2" },
];

export const PATTERN_BY_ID: Record<string, LibraryPattern> = Object.fromEntries(PATTERN_LIBRARY.map((p) => [p.id, p]));

export function searchPatterns(query: string): LibraryPattern[] {
  const q = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return PATTERN_LIBRARY.filter((p) => q.every((t) => p.id.includes(t) || p.role.includes(t) || p.genre.some((g) => g.includes(t)) || (p.notes ?? "").toLowerCase().includes(t)));
}
