// src/lib/pattern-builder.js
//
// Pure function: state -> Strudel pattern string. No DOM, no audio, no imports
// from the bridge. This is the one place that knows Strudel's surface syntax.
//
// Milestone 2 builds a single looping "test" pattern so you can audition the
// sound picker and effect sliders. Later milestones add live keys, chords,
// drums, and layers (which is why this is its own module already).

import { state } from "../state.js";
import { semitoneToStrudelNote } from "./strudel-notes.js";

// A wide-range arpeggio so filter sweeps and panning are easy to hear.
const TEST_MELODY = "c2 g2 c3 e3 g3 c4 g3 e3";

// Build a superdough value object for a single live note (computer keyboard).
// Live notes are triggered directly through superdough (see NOTES.md milestone
// 3), so this returns a control OBJECT with superdough's resolved param names —
// note the lpf->cutoff / hpf->hcutoff mapping (the .lpf/.hpf aliases only exist
// at the pattern level, not in superdough's value object).
export function buildLiveNoteValue(semitone) {
  const { sound, fx } = state;
  const value = {
    note: semitoneToStrudelNote(semitone),
    s: sound,
    gain: fx.gain,
    cutoff: fx.lpf, // lpf
    pan: fx.pan,
    attack: 0.01,
    release: 0.12,
    analyze: "live", // route through a named analyser (tests + future scope)
  };
  if (fx.hpf > 0) value.hcutoff = fx.hpf;
  if (fx.room > 0) value.room = fx.room;
  if (fx.delay > 0) value.delay = fx.delay;
  return value;
}

export function buildTestPattern() {
  const { sound, fx } = state;
  return (
    `note("${TEST_MELODY}")` +
    `.s("${sound}")` +
    `.gain(${fx.gain})` +
    `.lpf(${fx.lpf})` +
    `.hpf(${fx.hpf})` +
    `.room(${fx.room})` +
    `.delay(${fx.delay})` +
    `.pan(${fx.pan})`
  );
}
