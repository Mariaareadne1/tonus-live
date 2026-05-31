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

// Arp rate table, indexed by state.arpRateIndex. `spc` = events per cycle when
// synced (1 cycle = 1 bar of 4/4); `hz` = notes per second when free-running.
export const ARP_RATES = [
  { label: "1/4", spc: 4, hz: 2 },
  { label: "1/4T", spc: 6, hz: 3 },
  { label: "1/8", spc: 8, hz: 4 },
  { label: "1/8T", spc: 12, hz: 6 },
  { label: "1/16", spc: 16, hz: 8 },
  { label: "1/16T", spc: 24, hz: 12 },
  { label: "1/32", spc: 32, hz: 16 },
  { label: "1/32T", spc: 48, hz: 24 },
];

// The shared effect chain, applied to every pattern-path source (test loop, arp,
// later drums/layers). Includes .analyze("live") so tests and future visualisers
// can read the output — same analyser id the live keyboard uses.
function fxChain() {
  const { sound, fx } = state;
  return (
    `.s("${sound}")` +
    `.gain(${fx.gain})` +
    `.lpf(${fx.lpf})` +
    `.hpf(${fx.hpf})` +
    `.room(${fx.room})` +
    `.delay(${fx.delay})` +
    `.pan(${fx.pan})` +
    `.analyze("live")`
  );
}

// Build the arpeggio pattern string for the given semitones (already resolved
// from held keys + chord mode). The notes play in sequence via .fast(); the
// multiplier is chosen so that, with the global cps = bpm/240:
//   synced -> rate scales with BPM      (fast = spc/len, cps cancels)
//   free   -> rate is the chosen Hz     (fast = hz/(len*cps), BPM-independent)
// See NOTES.md milestone 5 for the derivation and the path-choice rationale.
export function buildArpString(semitones) {
  const len = semitones.length;
  const cps = state.bpm / 240;
  const rate = ARP_RATES[state.arpRateIndex];
  const eventsPerSec = state.arpSync ? rate.spc * cps : rate.hz;
  const fast = Math.round((eventsPerSec / (len * cps)) * 10000) / 10000;
  const noteStr = semitones.map(semitoneToStrudelNote).join(" ");
  return `note("${noteStr}").fast(${fast})` + fxChain();
}

// Build a superdough value object for a single live note (computer keyboard).
// Live notes are triggered directly through superdough (see NOTES.md milestone
// 3), so this returns a control OBJECT with superdough's resolved param names —
// note the lpf->cutoff / hpf->hcutoff mapping (the .lpf/.hpf aliases only exist
// at the pattern level, not in superdough's value object).
//
// `env` is an ADSR override ({ attack, decay, sustain, release }). The keyboard
// uses a fast-attack "strike" for the first note and flat-top triangular grains
// for sustain (see ui/keyboard.js) — the envelope shape that measured smoothest.
export function buildLiveNoteValue(semitone, env) {
  const { sound, fx } = state;
  const value = {
    note: semitoneToStrudelNote(semitone),
    s: sound,
    gain: fx.gain,
    cutoff: fx.lpf, // lpf
    pan: fx.pan,
    attack: env.attack,
    decay: env.decay,
    sustain: env.sustain,
    release: env.release,
    analyze: "live", // route through a named analyser (tests + future scope)
  };
  if (fx.hpf > 0) value.hcutoff = fx.hpf;
  if (fx.room > 0) value.room = fx.room;
  if (fx.delay > 0) value.delay = fx.delay;
  return value;
}

export function buildTestPattern() {
  return `note("${TEST_MELODY}")` + fxChain();
}
