// src/ui/keyboard.js
//
// Computer keyboard -> live note playback.
//
// Why this design (measured in milestone 3, see NOTES.md): re-evaluating a
// Strudel pattern on each keypress has 0.5-2s onset latency (cycle-quantized) —
// unplayable. Firing superdough directly is ~150ms — playable. But superdough
// gives no note-off handle, so to make a key SUSTAIN while held and STOP on
// release, each held key re-triggers a note on an interval; key-up clears that
// key's interval. This is what "each key independently scheduled" means.
//
// Smoothing the sustain (measured sweep, see NOTES.md): a held note is sustained
// by overlapping TRIANGULAR grains — each grain ramps up over one interval and
// down over the next, so two grains crossfade with constant summed gain (~11%
// residual ripple vs ~87% for naive short re-triggers). The FIRST note instead
// uses a fast-attack "strike" so the onset stays percussive/responsive.
//
// Live notes read state.fx at every trigger, so dragging effect sliders changes
// the sound of held notes in near-real-time.
//
// Chord mode (milestone 4): when state.chordMode is on, lower-octave keys play
// scale-degree chords (via harmony.js) instead of single notes; a chord is just
// several voices triggered together on the same retrigger path. Upper-octave
// keys stay melodic (single notes) regardless.

import { state } from "../state.js";
import { keyToSemitone, LOWER_OCTAVE_DEGREE } from "../lib/keymap.js";
import { chordSemitones } from "../lib/harmony.js";
import { buildLiveNoteValue } from "../lib/pattern-builder.js";
import * as bridge from "../strudel-bridge.js";

const RETRIGGER_MS = 120;
// Triangular sustain grain: attack == release == interval, flat top, tiny hold.
// duration is the time to grain peak; release then fades it as the next grain
// rises. (sustain:1, decay:0 => no per-grain amplitude spike.)
const SUSTAIN_GRAIN = { dur: 0.13, attack: 0.12, decay: 0, sustain: 1, release: 0.12 };
// Percussive first hit: snappy attack so the keypress feels immediate.
const STRIKE = { dur: 0.18, attack: 0.005, decay: 0, sustain: 1, release: 0.12 };

const timers = new Map(); // keyCode -> setInterval id
let rebuildArp = () => {}; // injected in initKeyboard; rebuilds the arp pattern

// Note-event hook (milestone 7). The recorder registers a callback here so it
// sees every musical press/release with the already-resolved notes (chords and
// octave shift included) — independent of how the note is sounded (live vs arp).
// press: { type:"press", code, notes:number[] }; release: { type:"release", code }.
let noteEventHook = null;
export function setNoteEventHook(fn) {
  noteEventHook = fn;
}

// Union of all currently-held keys' notes (ascending), for the arpeggiator.
export function heldNoteSemitones() {
  const set = new Set();
  for (const code of state.heldKeys) {
    for (const s of notesForKey(code)) set.add(s);
  }
  return [...set].sort((a, b) => a - b);
}

// Resolve which semitones a key plays right now (chord mode + bass + octave).
// Returns [] for unmapped keys. Exported so tests can assert chord correctness.
export function notesForKey(keyCode) {
  let semis;
  const degree = LOWER_OCTAVE_DEGREE[keyCode];
  if (state.chordMode && degree !== undefined) {
    const chord = chordSemitones(degree, state.tonalRoot, state.complexity);
    if (!chord) return [];
    semis = chord.notes.slice();
    if (state.bassOn) semis.unshift(chord.chordRoot - 12); // root one octave down
  } else {
    const base = keyToSemitone(keyCode, 0);
    if (base == null) return [];
    semis = [base];
  }
  return semis.map((s) => s + state.octaveShift);
}

function triggerKey(keyCode, env) {
  for (const semitone of notesForKey(keyCode)) {
    bridge.triggerNote(buildLiveNoteValue(semitone, env), env.dur).catch(() => {});
  }
}

// Stop the retrigger loops for any held CHORD-ZONE keys (lower-octave keys while
// chord mode is on). Called when the chord preset (root/complexity) changes so
// the old chord stops instead of clashing with the next one. superdough has no
// note-off, so already-scheduled grains still fade over ~one grain (~0.25s) —
// this is the fastest honest cut (see NOTES.md ceiling). It does NOT retune held
// notes live. Melody / upper-octave keys are left ringing untouched.
export function stopChordZoneVoices() {
  if (!state.chordMode) return;
  for (const code of [...state.heldKeys]) {
    if (LOWER_OCTAVE_DEGREE[code] === undefined) continue; // not a chord-zone key
    const id = timers.get(code);
    if (id != null) {
      clearInterval(id);
      timers.delete(code);
    }
    state.heldKeys.delete(code);
  }
}

// `onArpRebuild` rebuilds the combined pattern (main's rebuildAndPlay). When arp
// mode is on, held keys feed the pattern path instead of firing superdough.
export function initKeyboard(onArpRebuild) {
  rebuildArp = onArpRebuild ?? (() => {});

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const code = String(e.keyCode);
    if (keyToSemitone(code) == null) return; // not a mapped musical key
    if (state.heldKeys.has(code)) return; // already held
    state.heldKeys.add(code);
    const notes = notesForKey(code);
    if (noteEventHook && notes.length) noteEventHook({ type: "press", code, notes });
    if (state.arpOn) {
      rebuildArp(); // pattern path: rebuild arp from the new held set
    } else {
      triggerKey(code, STRIKE); // live path: immediate percussive onset
      timers.set(code, setInterval(() => triggerKey(code, SUSTAIN_GRAIN), RETRIGGER_MS));
    }
  });

  window.addEventListener("keyup", (e) => {
    const code = String(e.keyCode);
    if (!state.heldKeys.has(code)) return;
    state.heldKeys.delete(code);
    const id = timers.get(code); // clear any live-path timer (none in arp mode)
    if (id != null) {
      clearInterval(id);
      timers.delete(code);
    }
    if (noteEventHook) noteEventHook({ type: "release", code });
    if (state.arpOn) rebuildArp(); // fewer notes, or stop when none left
  });

  // Safety: if focus leaves the window mid-hold, release everything so notes
  // don't get stuck re-triggering forever.
  window.addEventListener("blur", () => {
    // Release recorder-tracked keys too, so a held note doesn't capture forever.
    if (noteEventHook) {
      for (const code of state.heldKeys) noteEventHook({ type: "release", code });
    }
    for (const id of timers.values()) clearInterval(id);
    timers.clear();
    state.heldKeys.clear();
    if (state.arpOn) rebuildArp();
  });
}
