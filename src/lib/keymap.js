// src/lib/keymap.js
//
// Maps browser KeyboardEvent codes (as strings) to semitones relative
// to middle C. Ported from the previous version of tonus, where this
// part worked correctly.
//
// Layout:
//   Lower octave: Z S X D C V G B H N J M  → semitones 0..11 (C..B)
//   Upper octave: Q 2 W 3 E R 5 T 6 Y 7 U  → semitones 12..23 (C..B one up)
//
// Lower-octave keys double as chord-zone keys when chord mode is on.

// e.which / e.keyCode values for the keys above:
export const KEY_SEMITONE_BASE = {
  // lower octave
  "90":  0,  // Z
  "83":  1,  // S
  "88":  2,  // X
  "68":  3,  // D
  "67":  4,  // C
  "86":  5,  // V
  "71":  6,  // G
  "66":  7,  // B
  "72":  8,  // H
  "78":  9,  // N
  "74": 10,  // J
  "77": 11,  // M

  // upper octave
  "81": 12,  // Q
  "50": 13,  // 2
  "87": 14,  // W
  "51": 15,  // 3
  "69": 16,  // E
  "82": 17,  // R
  "53": 18,  // 5
  "84": 19,  // T
  "54": 20,  // 6
  "89": 21,  // Y
  "55": 22,  // 7
  "85": 23,  // U
};

// The 12 lower-octave key codes in scale-degree order.
// Used to map "which lower-octave key was pressed" → "which chord degree."
export const LOWER_OCTAVE_CODES = [
  "90", "83", "88", "68", "67", "86",  // Z S X D C V
  "71", "66", "72", "78", "74", "77",  // G B H N J M
];

// Reverse map: key code → degree (0..11), or undefined if not a lower-octave key.
export const LOWER_OCTAVE_DEGREE = Object.fromEntries(
  LOWER_OCTAVE_CODES.map((code, i) => [code, i])
);

/**
 * @param {string} keyCode    e.g. "90" for Z
 * @param {number} octaveShift signed, in semitones (12 = up an octave)
 * @returns {number | null}    semitone offset from C4, or null if unmapped
 */
export function keyToSemitone(keyCode, octaveShift = 0) {
  const base = KEY_SEMITONE_BASE[keyCode];
  if (base === undefined) return null;
  return base + octaveShift;
}

// Display info for an on-screen keyboard.
// Each entry: { code, label, note, black }
export const KEY_DISPLAY = [
  { code: "90", label: "Z", note: "C",   black: false },
  { code: "83", label: "S", note: "C♯",  black: true  },
  { code: "88", label: "X", note: "D",   black: false },
  { code: "68", label: "D", note: "D♯",  black: true  },
  { code: "67", label: "C", note: "E",   black: false },
  { code: "86", label: "V", note: "F",   black: false },
  { code: "71", label: "G", note: "F♯",  black: true  },
  { code: "66", label: "B", note: "G",   black: false },
  { code: "72", label: "H", note: "G♯",  black: true  },
  { code: "78", label: "N", note: "A",   black: false },
  { code: "74", label: "J", note: "A♯",  black: true  },
  { code: "77", label: "M", note: "B",   black: false },
  { code: "81", label: "Q", note: "C",   black: false },
  { code: "50", label: "2", note: "C♯",  black: true  },
  { code: "87", label: "W", note: "D",   black: false },
  { code: "51", label: "3", note: "D♯",  black: true  },
  { code: "69", label: "E", note: "E",   black: false },
  { code: "82", label: "R", note: "F",   black: false },
  { code: "53", label: "5", note: "F♯",  black: true  },
  { code: "84", label: "T", note: "G",   black: false },
  { code: "54", label: "6", note: "G♯",  black: true  },
  { code: "89", label: "Y", note: "A",   black: false },
  { code: "55", label: "7", note: "A♯",  black: true  },
  { code: "85", label: "U", note: "B",   black: false },
];
