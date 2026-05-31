// src/state.js
//
// Single source of truth. A plain object — no reactivity, no library.
// UI modules read from it, write to it, then call the shared rebuildAndPlay()
// (see main.js) which turns this state into a Strudel pattern and plays it.
//
// Grows one milestone at a time. Milestone 2 adds: playback flag, sound, and
// the six effect controls. Milestone 3 adds live-keyboard input. Milestone 4
// adds chord mode.

export const state = {
  // playback of the test loop
  playing: false,

  // live computer-keyboard input
  heldKeys: new Set(), // keyCodes (as strings) currently held down
  octaveShift: 0, // semitones added to every live note (12 = up an octave)

  // chord mode (lower-octave keys play scale-degree chords)
  chordMode: false,
  tonalRoot: 0, // 0 = C, 1 = C#, ... 11 = B
  complexity: 0, // 0 = triad, 1 = 7th, 2 = 9th
  bassOn: false, // add the chord root one octave down

  // arpeggiator (held notes play in sequence via the pattern path)
  arpOn: false,
  arpSync: true, // true: rate snaps to musical subdivisions of the BPM
  arpRateIndex: 2, // index into the rate table (2 = 1/8 when synced)

  // drum sequencer (milestone 6) — N steps per bar, 8 rows, one sound per row.
  // Each row's `steps` array maps 1:1 to events in a cycle (1 cycle = 1 bar), so
  // toggling 16<->8 changes the subdivision (16th vs 8th notes). Played via the
  // pattern path, stacked alongside the arp/test loop in rebuildAndPlay().
  drums: {
    on: false,
    steps: 16,
    rows: [
      { sound: "bd", steps: Array(16).fill(false) },
      { sound: "sd", steps: Array(16).fill(false) },
      { sound: "hh", steps: Array(16).fill(false) },
      { sound: "ho", steps: Array(16).fill(false) },
      { sound: "cp", steps: Array(16).fill(false) },
      { sound: "rm", steps: Array(16).fill(false) },
      { sound: "cr", steps: Array(16).fill(false) },
      { sound: "lt", steps: Array(16).fill(false) },
    ],
  },

  // transport
  bpm: 120,

  // tone
  sound: "sawtooth",

  // effects — every value here is consumed by pattern-builder.js
  fx: {
    gain: 0.7,
    lpf: 8000, // cutoff in Hz (alias of .cutoff); ~open at this value
    hpf: 0, // high-pass cutoff in Hz; 0 = off
    room: 0, // reverb amount 0..1
    delay: 0, // delay send 0..1
    pan: 0.5, // 0 = left, 1 = right, 0.5 = center
  },
};
