/* ============================================================
   étude — vocabulary
   Every word the language understands, in one place. The parser
   reads from these tables, the engine turns them into sound, and
   the highlighter colours them.
   ============================================================ */

export const INSTRUMENTS = ["violin", "viola", "cello", "bass", "piano", "harp", "flute", "organ", "drums"];

export const STRINGS = ["violin", "viola", "cello", "bass"];

export const DRUM_SOUNDS = ["kick", "snare", "hat", "openhat", "clap", "rim", "tom", "crash"];

// Loudness, 0–1. Default for every part is mf.
export const DYNAMICS = { ppp: 0.08, pp: 0.15, p: 0.25, mp: 0.38, mf: 0.52, f: 0.68, ff: 0.84, fff: 1 };
export const DEFAULT_DYNAMIC = DYNAMICS.mf;

// Where the bow meets the string → low-pass cutoff in Hz.
export const TONES = { flautando: 450, tasto: 900, dolce: 1500, normale: 2600, ponticello: 7500 };
export const DEFAULT_TONE = 4000;

// rate in Hz, depth in cents, delay before the vibrato blooms (s).
export const VIBRATOS = {
  none:   { rate: 0,   depth: 0 },
  slow:   { rate: 4.5, depth: 14 },
  normal: { rate: 5.5, depth: 18 },
  fast:   { rate: 7.2, depth: 16 },
  wide:   { rate: 5,   depth: 45 },
};
export const STRING_VIBRATO = "normal";

// Bow strokes → envelope. `length` is how much of the written note
// the bow actually sounds (staccato leaves space after the note).
export const BOWINGS = {
  legato:   { attack: 0.09,  decay: 0.2,  sustain: 0.9,  release: 0.35, length: 1 },
  detache:  { attack: 0.03,  decay: 0.1,  sustain: 0.8,  release: 0.12, length: 0.92 },
  martele:  { attack: 0.004, decay: 0.12, sustain: 0.45, release: 0.08, length: 0.85 },
  staccato: { attack: 0.01,  decay: 0.08, sustain: 0.6,  release: 0.06, length: 0.45 },
  spiccato: { attack: 0.003, decay: 0.06, sustain: 0.2,  release: 0.05, length: 0.25 },
  pizz:     { attack: 0.002, decay: 0.3,  sustain: 0,    release: 0.3,  length: 1, pluck: true },
};
export const DEFAULT_BOWING = "detache";
export const ENVELOPE_LABELS = ["attack", "decay", "sustain", "release"];

// Reverb tail length in seconds.
export const HALLS = { dry: 0, room: 0.6, studio: 1.2, chapel: 2.4, concert: 3.4, cathedral: 6 };

// Note values in beats (a quarter note is one beat).
export const NOTE_VALUES = {
  whole: 4, half: 2, "dotted-half": 3, quarter: 1, "dotted-quarter": 1.5,
  eighth: 0.5, "dotted-eighth": 0.75, triplet: 1 / 3, sixteenth: 0.25,
};
export const DEFAULT_ECHO_TIME = "eighth";
export const DEFAULT_ECHO_FEEDBACK = 0.45;

// Orchestra seating, -1 (far left) to 1 (far right).
export const SEATS = { left: -0.8, "center-left": -0.4, center: 0, "center-right": 0.4, right: 0.8 };

export const SPEEDS = { half: 0.5, double: 2 };

export const TEMPO_MARKS = {
  grave: 40, largo: 50, lento: 56, adagio: 70, andante: 88, moderato: 108,
  allegretto: 116, allegro: 132, vivace: 150, presto: 176,
};
export const DEFAULT_TEMPO = 100;

export const GLOBALS = ["tempo", "time", "key"];
// words for variables, loops and conditionals
export const PROGRAM_WORDS = ["let", "repeat", "as", "if", "then", "else", "up", "down", "is", "not", "even", "odd", "first", "last", "r", "rest", "x"];

export const MODIFIERS = ["dynamics", "tone", "vibrato", "bowing", "echo", "hall", "seat", "speed", "tacet"];

// Every named value, for the highlighter.
export const VALUE_WORDS = new Set([
  ...Object.keys(DYNAMICS), ...Object.keys(TONES), ...Object.keys(VIBRATOS), ...Object.keys(BOWINGS),
  ...Object.keys(HALLS), ...Object.keys(NOTE_VALUES), ...Object.keys(SEATS), ...Object.keys(SPEEDS),
  ...Object.keys(TEMPO_MARKS), ...ENVELOPE_LABELS, "major", "minor", "over", "bars",
]);
