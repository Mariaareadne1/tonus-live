// src/lib/pattern-builder.js
//
// Pure function: state -> Strudel pattern string. No DOM, no audio, no imports
// from the bridge. This is the one place that knows Strudel's surface syntax.
//
// Milestone 2 builds a single looping "test" pattern so you can audition the
// sound picker and effect sliders. Later milestones add live keys, chords,
// drums, and layers (which is why this is its own module already).

import { state } from "../state.js";

// A wide-range arpeggio so filter sweeps and panning are easy to hear.
const TEST_MELODY = "c2 g2 c3 e3 g3 c4 g3 e3";

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
