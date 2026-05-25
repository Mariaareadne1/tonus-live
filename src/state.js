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
