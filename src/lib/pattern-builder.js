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

// Drum sounds offered per row. These are the actual folder names in the
// dirt-samples bank loaded at init (see strudel-bridge.loadDrumSamples /
// NOTES.md milestone 6) — that bank has no "oh"/"rim", so open hat is "ho" and
// rimshot is "rm".
export const DRUM_SOUNDS = [
  "bd", "sd", "hh", "ho", "cp", "rm", "cr", "lt", "mt", "ht", "sn", "perc",
];

// Drums don't share the melodic fxChain (which forces .s(synthWaveform)); they
// carry their own sample sound via s("bd ...") and a fixed gain. They still feed
// the "live" analyser so audio tests and visualisers see them.
const DRUM_GAIN = 0.9;

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

// --- recording / layers (milestone 7) -------------------------------------
//
// Compile a QUANTIZED recording into a looping Strudel layer string. `events` is
// a list of { notes:number[], startBeat, endBeat, arp:boolean, arpSpb:number }
// whose beat bounds were already snapped to the grid by the recorder, plus the
// arp mode and arp rate (steps/beat) active when each note was held. `drumCode`
// (optional) is a frozen drum-grid pattern snapshotted at finalize.
//
// Each event becomes mini-notation weighted by its duration in beats (`@n`), gaps
// become rests (`~`), and the loop is stretched with `.slow()` so one weight-unit
// == one beat (1 cycle == 1 bar == 4 beats under cps=bpm/240). The output FORM
// matches what was actually playing, per segment:
//   - arp OFF -> block chord:   [c4,e4,g4]@2          (comma = simultaneous)
//   - arp ON  -> arp sequence:  [c4 e4 g4 c4]@2       (space = sequenced)
// The arp form sequences the chord notes at the RECORDED rate (arpSpb steps/beat),
// so it plays back at the speed it was performed regardless of the current slider
// (see arpSequenceToken). Drums, if captured, are stacked alongside the notes so
// both loop in sync. Returns null for an empty take with no drums.
export function compileLayer(events, drumCode = null) {
  const notePart = events && events.length ? buildNotePart(events) : null;
  const parts = [];
  if (notePart) parts.push(notePart);
  if (drumCode) parts.push(drumCode);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `stack(${parts.join(", ")})`;
}

function buildNotePart(events) {
  // rebase so the earliest press is beat 0 (drop leading silence)
  const minStart = Math.min(...events.map((e) => e.startBeat));

  // merge events that start on the same beat into one chord (a simultaneous
  // press shares one mode/rate, since arp is a global toggle at any instant)
  const byStart = new Map();
  for (const e of events) {
    const start = e.startBeat - minStart;
    const end = e.endBeat - minStart;
    const cur = byStart.get(start);
    if (cur) {
      cur.notes = [...new Set([...cur.notes, ...e.notes])];
      cur.end = Math.max(cur.end, end);
    } else {
      byStart.set(start, {
        notes: [...new Set(e.notes)],
        start,
        end,
        arp: !!e.arp,
        arpSpb: e.arpSpb || 0,
      });
    }
  }
  const groups = [...byStart.values()].sort((a, b) => a.start - b.start);

  // lay groups onto a monotonic timeline, inserting rests for gaps. Keeping the
  // cursor monotonic makes the layer monophonic-in-time: overlapping presses are
  // sequenced (a deliberate simplification — acceptance input is sequential).
  const tokens = [];
  let cursor = 0;
  for (const g of groups) {
    const start = Math.max(g.start, cursor);
    if (start > cursor) tokens.push(weighted("~", start - cursor));
    const dur = Math.max(1, g.end - start);
    const tok = g.arp ? arpSequenceToken(g.notes, dur, g.arpSpb) : noteToken(g.notes);
    tokens.push(weighted(tok, dur));
    cursor = start + dur;
  }
  const loopLen = cursor; // total beats in the loop

  let code = `note("${tokens.join(" ")}")`;
  const slow = loopLen / 4; // 4 beats == 1 cycle; stretch to span loopLen beats
  if (slow !== 1) code += `.slow(${fmtNum(slow)})`;
  return code + fxChain();
}

// An arp segment: the chord's notes (ascending) sequenced and repeated to fill the
// segment at the RECORDED rate. `spb` = arp steps per beat at record time (synced:
// spc/4; free: hz*60/bpm). total = round(dur*spb) steps cycling the chord; a
// space-separated `[..]` group is a sub-sequence (vs the comma-chord), and the
// surrounding `@dur` weight makes it span the right beats — so it plays back at the
// recorded arp speed. This is why a 1/8 arp no longer falls to half-speed.
function arpSequenceToken(notes, durBeats, spb) {
  const asc = notes.slice().sort((a, b) => a - b);
  const total = Math.max(1, Math.round(durBeats * (spb || 1)));
  const steps = [];
  for (let k = 0; k < total; k++) steps.push(semitoneToStrudelNote(asc[k % asc.length]));
  return steps.length === 1 ? steps[0] : "[" + steps.join(" ") + "]";
}

// The metronome as a Strudel PATTERN (milestone 7 sync fix): four square-wave
// clicks per cycle == one per beat, accented on the downbeat (c6 vs c5). Being a
// pattern, it rides Strudel's master clock — the same clock finalized layers play
// on — so clicks and layers never drift. Bypasses fxChain (fixed click sound).
export function buildMetronomeString() {
  return (
    `note("c6 c5 c5 c5")` +
    `.s("square").gain(0.3).attack(0.001).decay(0.04).sustain(0).release(0.02)` +
    `.analyze("live")`
  );
}

// "tok@n" when n>1, else just "tok" (n==1 needs no weight). n is a beat count.
function weighted(tok, beats) {
  return beats > 1 ? `${tok}@${beats}` : tok;
}

// One note -> "c4"; a chord -> "[c4,e4,g4]" (ascending so it reads predictably).
function noteToken(semitones) {
  const sorted = semitones.slice().sort((a, b) => a - b);
  if (sorted.length === 1) return semitoneToStrudelNote(sorted[0]);
  return "[" + sorted.map(semitoneToStrudelNote).join(",") + "]";
}

// Clean number formatting for export: integers stay bare, fractions are trimmed.
function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

// Build the drum-grid pattern: one mini-notation sequence per active row, all
// stacked into one source. A row's `steps` array maps 1:1 to events in a cycle
// (1 cycle = 1 bar), so N steps = N subdivisions of the bar — at cps = bpm/240,
// 16 steps are 16th notes, 8 steps are 8th notes. Inactive steps become rests
// ("~"). Empty rows are dropped; an all-empty grid returns null (nothing to play).
export function buildDrumString() {
  const rows = state.drums.rows.filter((r) => r.steps.some(Boolean));
  if (rows.length === 0) return null;
  const parts = rows.map((r) => {
    const seq = r.steps.map((on) => (on ? r.sound : "~")).join(" ");
    return `s("${seq}").gain(${DRUM_GAIN}).analyze("live")`;
  });
  return parts.length === 1 ? parts[0] : `stack(${parts.join(", ")})`;
}
