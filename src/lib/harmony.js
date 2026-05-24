// src/lib/harmony.js
//
// Pure chord-theory functions. No audio, no DOM, no Strudel.
// Verified from the previous version of tonus — this logic worked
// correctly. The bugs were elsewhere (audio scheduling).
//
// All "semitones" are signed integers relative to middle C (C4 = 0).
//
//   C4 =  0    F4 =  5    A4 =  9    C5 = 12
//   C#4 = 1    F#4 = 6    A#4 = 10   D5 = 14
//   D4 =  2    G4 =  7    B4 = 11
//   D#4 = 3    G#4 = 8

export const ROOT_NAMES = [
  "C", "C♯", "D", "D♯", "E", "F",
  "F♯", "G", "G♯", "A", "A♯", "B",
];

// 12 diatonic-flavored chords, one per chromatic step from the tonal root.
// Each has an offset (semitones from root) and a list of intervals.
// Intervals are 1, 3, 5, 7, 9 — slice based on complexity (3 = triad,
// 4 = 7th, 5 = 9th).
const CHORD_TABLE = [
  { offset:  0, intervals: [0, 4, 7, 11, 14], label: "I"    },
  { offset:  1, intervals: [0, 4, 7, 10, 14], label: "♭II"  },
  { offset:  2, intervals: [0, 3, 7, 10, 14], label: "ii"   },
  { offset:  3, intervals: [0, 4, 7, 10, 14], label: "♭III" },
  { offset:  4, intervals: [0, 3, 7, 10, 14], label: "iii"  },
  { offset:  5, intervals: [0, 4, 7, 11, 14], label: "IV"   },
  { offset:  6, intervals: [0, 4, 7, 10, 14], label: "V/V"  },
  { offset:  7, intervals: [0, 4, 7, 10, 14], label: "V"    },
  { offset:  8, intervals: [0, 4, 7, 10, 14], label: "♭VI"  },
  { offset:  9, intervals: [0, 3, 7, 10, 14], label: "vi"   },
  { offset: 10, intervals: [0, 4, 7, 10, 14], label: "♭VII" },
  { offset: 11, intervals: [0, 3, 6, 10, 13], label: "vii°" },
];

/**
 * Build the semitone array for a chord.
 *
 * @param {number} degree     0..11 — which chord (which lower-octave key)
 * @param {number} root       0..11 — tonal root pitch class
 * @param {number} complexity 0|1|2 — triad / 7th / 9th
 * @returns {{notes: number[], label: string, chordRoot: number} | null}
 */
export function chordSemitones(degree, root, complexity) {
  const entry = CHORD_TABLE[degree];
  if (!entry) return null;
  const n = 3 + Math.max(0, Math.min(2, complexity));
  const notes = [];
  for (let i = 0; i < n; i++) {
    notes.push(root + entry.offset + entry.intervals[i]);
  }
  return {
    notes,
    label: entry.label,
    chordRoot: root + entry.offset,
  };
}
