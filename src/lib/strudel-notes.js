// src/lib/strudel-notes.js
//
// Convert between semitone numbers and Strudel note strings.
// "c4" = middle C (semitone 0 in our internal numbering).
//
// Strudel note format: a letter (c-b), optional accidental (# or b),
// then an octave number. We always emit sharps, never flats.

const NAMES_SHARP = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];

/**
 * Semitone (relative to middle C = 0) → Strudel note string.
 * @param {number} semitone
 * @returns {string} e.g. "c4", "d#5", "g3"
 */
export function semitoneToStrudelNote(semitone) {
  const midi = 60 + semitone;             // 60 = MIDI middle C
  const octave = Math.floor(midi / 12) - 1;
  const pc = ((midi % 12) + 12) % 12;
  return `${NAMES_SHARP[pc]}${octave}`;
}

/**
 * Strudel note string → semitone (relative to middle C).
 * Tolerant of #, b, and missing octave (defaults to 4).
 * @param {string} name
 * @returns {number}
 */
export function strudelNoteToSemitone(name) {
  const m = name.match(/^([a-g])([#b]?)(-?\d+)?$/i);
  if (!m) return 0;
  const baseMap = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let pc = baseMap[m[1].toLowerCase()];
  if (m[2] === "#") pc += 1;
  else if (m[2] === "b") pc -= 1;
  const octave = m[3] === undefined ? 4 : parseInt(m[3], 10);
  const midi = (octave + 1) * 12 + pc;
  return midi - 60;
}

/**
 * Build a Strudel chord token: "[c4,e4,g4]"
 * @param {number[]} semitones
 */
export function chordToken(semitones) {
  return "[" + semitones.map(semitoneToStrudelNote).join(",") + "]";
}
