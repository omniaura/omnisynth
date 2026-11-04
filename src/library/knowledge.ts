/**
 * The producer's knowledge pack: a compact, opinionated reference the agent
 * reads at the start of every run (and can re-read via `get_knowledge`).
 * Kept short on purpose — roughly 2.5k tokens — so it fits beside the brief.
 *
 * Distilled from: Secrets of Songwriting (tension-release), Hooktheory
 * (stable/unstable degrees), Riepel (phrase symmetry), Hyperbits/EDMProd
 * (basslines, call-and-response), Myloops (trance arps), Attack Magazine
 * Beat Dissected (grooves), Roland (303 accents/slides), Toussaint
 * (Euclidean rhythms), Mixed In Key (EDM key/progression stats), iZotope /
 * Mastering The Mix (low-end), Serum/Vital guides (patch recipes).
 */

export const KNOWLEDGE = `# OmniSynth producer knowledge (read this; don't reinvent it)

## Workflow
1. Pick an arrangement template (list_library kind=arrangement, then apply_template) for the genre/energy curve — it creates sections with bars, meters and a recipe per section.
2. Pick a progression (use_progression) in the brief's key; it returns voiced chord notes per bar.
3. Drums from the pattern library (use_pattern role=kick/snare/hat…); bass/leads from patterns + patches (use_patch) — then personalise with mutate_pattern / set_evolution.
4. Movement: sidechain (follower on kick → bass/pad volume), 1–3 slow LFOs, automate_param across builds, evolution on ≥2 tracks. Visuals last.
Prefer library material + small edits over hand-writing 64-step arrays.

## Keys and harmony
- EDM is ~90% minor; A/C/F#/G minor most common. One tonal center per track is normal in techno/DnB; chords change every 1–2 bars elsewhere (harmonic rhythm on beat 1).
- Go-to loops: i–VI–III–VII (epic), i–III–VII–VI (Levels), VI–VII–i–VI (brooding), i–iv–VII–III (cinematic), Andalusian i–VII–VI–V (tension; the major V is the point), Dorian i7–IV (bright minor), I–V–vi–IV (pop euphoria), one-chord drone (hypnotic).
- Color: 7ths, add9, sus2/sus4; borrow the major V (harmonic minor), ♭II (Phrygian), major IV (Dorian).
- Voicing: roots + 5ths low, 3rds/extensions an octave up (spread). Rootless or stab voicings for chords when a sub is present; never two elements below ~100 Hz. Bass octave 1–2, chords 3–4, leads 4–5.

## Melody and hooks
- Build from a 2–5 note motif; develop by repetition, sequence (step up/down), inversion, rhythmic displacement, augmentation — not a new idea every bar.
- Phrases: 4 and 8 bars; call (ends on 2 or 5, unresolved) → response (lands on 1 or 3). Rests make hooks.
- Contour: arch or wave; steps for singability, one leap (4th/6th/8ve) at the emotional peak, then step back.
- Stable tones = chord tones; 2/4/6 resolve down, 7 resolves up. Unstable on strong beats = tension; resolve into the next bar.
- Counter-melody: other register, rhythmically offset (active when the lead rests), contrary motion, chord tone on strong beats.
- Arps: root-5-8-5 (classic pluck, gate ~50%), 1-3-5-8 ascending with octave jump every 2 bars (rolling, gate 85%); make one note per bar an 8n so it reads as composed.

## Bass
- Root on the kick; 5th/octave for movement; ≤3 pitches for dark genres (one-note basslines work). Rhythm either locks with the kick or answers it — not both busy.
- House: root on offbeat 8ths (kick owns the downbeat). Disco: root/octave bounce. Trance: offbeat rolling. DnB: long Reese notes with glide, movement from LFO on cutoff. Dubstep: write the wobble rhythm against the drums; LFO 4n=slow, 8n=classic wub, 16n=talking; double the rate in the last 2 bars of a build.
- 303: velocity 0.6 normal / 1.0 accents (accent before a kick = bounce), slide on every 3rd–4th note, octave jumps, resonance high, cutoff low.
- 808 (trap/drill): the kick is the bassline; notes F0–A#1; slide between notes; drill puts the second hit on the and-a of 3 (step 11).

## Drums and groove (16n grid, 1 bar)
- House/techno: kick 1,5,9,13; clap 5,13; open hat 3,7,11,15; closed 16ths at ~50% velocity with accents. Techno darker: clap only on 13; add ride 16ths; 3- and 5-step perc cycles for hypnosis.
- DnB (174): kick 1 and 11; snare 5,13; quiet 16th hat pickups on 8/16; ghost snare after offbeat hats.
- Dubstep/halftime (140): kick 1, snare 9 (beat 3); hats keep the 140 pulse; 2-bar loop with bar-2 variation and fills.
- Trap (130–150): snare 9; hats 8ths with 1/32 rolls (ratchet) before snares, crescendo velocity; no swing.
- UKG 2-step (130–135): kick 1 and 11, snare 5,13, swung 16th hats (~60%, nudge +20 ms on offbeat 16ths), scattered rims.
- Footwork (160): tresillo kick runs, pitched 808 toms, triplet feel.
- Euclid: E(3,8) tresillo, E(5,8) cinquillo, E(7,12) bembé, E(5,16) bossa, E(3,7)=7/8 as 2+2+3, E(4,9) aksak. Odd meters: 7/8 (2+2+3 or 3+2+2), 5/4 (3+2), 11/8 (3+3+3+2) — anchors on the group starts.
- Humanize: velocity ±0.1, nudge ±8 ms on hats; swing only for house/garage/hip-hop, never for trap rolls.

## Arrangement
- Phrases of 8/16/32 bars; changes on 8-bar boundaries. Club ABAB: intro 16–32 (DJ-friendly), build 8–16, drop 16–32, breakdown 16, build, drop 2 longer, outro 16. Bass music: drop at bar 32; drops are 3 statements of the bass idea. Techno: no hard drop, themes recur, continuous evolution. Pop/synthwave: verse/chorus, 4-bar intro.
- Tension tools: filter opening over a build, snare roll (ratchet 2→4), riser cutoff automation, probability erosion, 1 bar of silence before a drop. Release: everything in, sidechain pumping, hook returns.

## Mix (dB, Tone.js volume)
- Kick −4 to −6, snare/clap −6 to −9, hats −12 to −14, sub −7, bass −8, chords −11 to −13, pads −14 to −16, leads −10 to −12, FX −16. Master: compressor (−14 thr, 3:1) → saturation (order 3, wet 0.15) → limiter (−1).
- Low end: one element below 100 Hz; kick 50–60 Hz, bass an octave above or ducked (follower on kick, invert, depth 8–12 dB). High-pass pads/chords at ~120 Hz (filter highpass). Keep bass/kick mono (pan 0); pads/arps wide.
- Movement beats loudness: a static loop at −6 is worse than an evolving one at −9.

## Sound design shortcuts (use_patch ids)
Drums: kick-909, kick-808, kick-rumble, kick-dnb, snare-909, snare-dnb, clap-909, hat-closed-909, hat-open-909, hat-trap, ride-909, rim-808, tom-808, perc-glitch.
Bass: sub-sine, bass-303, bass-303-square, bass-moog, bass-juno-house, bass-reese, bass-wobble, bass-growl-fm, bass-fm-dx, bass-pluck-garage.
Keys/chords: keys-m1-piano, keys-m1-organ, keys-rhodes, chords-juno-stab, chords-trance-supersaw, chords-dark-stab.
Pads: pad-juno-strings, pad-dark-drone, pad-airy, pad-choir-glass. Leads/plucks/bells: lead-hoover, lead-supersaw, lead-acid-sq, lead-pwm-synthwave, pluck-trance, pluck-garage-organ, pluck-karplus, bell-fm-silver, bell-dx-ep. FX: fx-riser-noise, fx-impact-sub.
Fork a library patch with create_patch when you need a variant; keep its mix guidance.`;

export const KNOWLEDGE_TOKENS_ESTIMATE = Math.round(KNOWLEDGE.length / 4);
