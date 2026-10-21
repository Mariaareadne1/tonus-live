/* ============================================================
   étude ↔ tonus bridge
   Turns what the tonus machine records (key presses, the drum
   grid, slider settings) into étude code, and names slider
   values in étude words. Pure functions, loaded by script.js.
   ============================================================ */

import { DYNAMICS, TONES, BOWINGS, HALLS, NOTE_VALUES, SEATS } from "./vocab.js";

export { replUrl, strudelUrl } from "./to-strudel.js";

const STEPS_PER_BEAT = 4;          // record on a sixteenth-note grid
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;
const BAR_DIVISIONS = [1, 2, 4, 8, 16];
const BARS_PER_LINE = 4;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const ETUDE_INSTRUMENTS = ["violin", "viola", "cello", "bass", "piano", "harp", "flute", "organ"];

// tonus .sound() choices → the closest étude instrument
const SOUND_TO_INSTRUMENT = {
  sawtooth: "violin", square: "organ", triangle: "flute", sine: "flute",
  gm_acoustic_grand_piano: "piano", gm_acoustic_guitar_nylon: "harp", gm_electric_guitar_muted: "harp",
  gm_acoustic_bass: "bass", gm_synth_bass_1: "bass", gm_violin: "violin", gm_flute: "flute",
  gm_voice_oohs: "flute", gm_synth_strings_1: "viola", gm_lead_1_square: "organ",
  gm_lead_2_sawtooth: "violin", gm_xylophone: "harp",
};

// étude instrument → a tonus .sound() for strudel mode
export const INSTRUMENT_TO_SOUND = {
  violin: "gm_violin", viola: "gm_synth_strings_1", cello: "gm_violin", bass: "gm_acoustic_bass",
  piano: "gm_acoustic_grand_piano", harp: "gm_acoustic_guitar_nylon", flute: "gm_flute", organ: "gm_lead_1_square",
};

// tonus drum codes → étude drum names
export const DRUM_CODE_TO_ETUDE = { bd: "kick", sd: "snare", hh: "hat", oh: "openhat", cp: "clap", rim: "rim", cr: "crash", lt: "tom" };

// tonus room amount (0–1) → hall, checked in order
const ROOM_TO_HALL = [[0.05, null], [0.25, "room"], [0.45, "studio"], [0.65, "chapel"], [0.85, "concert"], [Infinity, "cathedral"]];

/* ---------- naming slider values ---------- */

export function instrumentFor(sound) {
  return ETUDE_INSTRUMENTS.includes(sound) ? sound : (SOUND_TO_INSTRUMENT[sound] ?? "piano");
}

/** Closest named entry in a { name: number } table. */
export function nearest(table, value, { log = false } = {}) {
  let best = null;
  let bestDist = Infinity;
  Object.entries(table).forEach(([name, v]) => {
    const d = log ? Math.abs(Math.log(Math.max(v, 1e-6) / Math.max(value, 1e-6))) : Math.abs(v - value);
    if (d < bestDist) [best, bestDist] = [name, d];
  });
  return { name: best, distance: bestDist };
}

export const dynamicName = (gain) => nearest(DYNAMICS, gain).name;
export const toneName = (hz) => nearest(TONES, hz, { log: true }).name;
export const seatName = (pan01) => nearest(SEATS, pan01 * 2 - 1).name;
export const noteValueName = (seconds, bpm) => nearest(NOTE_VALUES, (seconds * bpm) / 60, { log: true }).name;
export function hallName(room) {
  return ROOM_TO_HALL.find(([limit]) => room < limit)[1];
}
export function bowingName({ attack, decay, sustain, release }) {
  let best = null;
  let bestDist = Infinity;
  Object.entries(BOWINGS).forEach(([name, b]) => {
    const d = Math.abs(b.attack - attack) + Math.abs(b.decay - decay) / 2 + Math.abs(b.sustain - sustain) + Math.abs(b.release - release) / 2;
    if (d < bestDist) [best, bestDist] = [name, d];
  });
  return { name: best, distance: bestDist };
}

/* ---------- modifier lines from a slider snapshot ---------- */

/**
 * @param {{ gain: number, lpf: number, attack: number, decay: number, sustain: number,
 *           release: number, room: number, delay: number, delaytime: number, pan: number }} fx
 * @param {number} bpm
 * @returns {string[]}
 */
export function fxToEtude(fx, bpm) {
  const lines = [];
  const dyn = nearest(DYNAMICS, fx.gain);
  lines.push(`dynamics ${dyn.distance < 0.05 ? dyn.name : round(fx.gain, 2)}`);

  const tone = nearest(TONES, fx.lpf, { log: true });
  lines.push(`tone ${tone.distance < Math.log(1.2) ? tone.name : Math.round(fx.lpf)}`);

  const stroke = bowingName(fx);
  lines.push(stroke.distance < 0.15
    ? `bowing ${stroke.name}`
    : `bowing attack ${round(fx.attack, 3)} decay ${round(fx.decay, 3)} sustain ${round(fx.sustain, 2)} release ${round(fx.release, 3)}`);

  const hall = hallName(fx.room);
  if (hall) lines.push(`hall ${hall}`);
  if (fx.delay > 0) lines.push(`echo ${round(fx.delay, 2)} ${noteValueName(fx.delaytime, bpm)}`);
  if (Math.abs(fx.pan - 0.5) > 0.02) {
    const seat = nearest(SEATS, fx.pan * 2 - 1);
    lines.push(`seat ${seat.distance < 0.05 ? seat.name : round(fx.pan * 2 - 1, 2)}`);
  }
  return lines;
}

/* ---------- score from recorded events ---------- */

/**
 * @param {{ kind: string, notes: number[], tRel: number, dur?: number, rateHz?: number }[]} events
 *        notes are semitones from C4
 * @param {{ bpm: number, instrument: string, label?: string, fx?: object }} opts
 * @returns {string} an étude part (header, bars and modifiers)
 */
export function recordingToEtude(events, { bpm, instrument, label = "", fx = null }) {
  const stepSec = 60 / bpm / STEPS_PER_BEAT;
  const hits = events.flatMap((e) => expandEvent(e)).map((h) => ({
    notes: h.notes,
    start: Math.max(0, Math.round(h.t / stepSec)),
    len: Math.max(1, Math.round(h.dur / stepSec)),
  }));
  const lastStep = hits.reduce((m, h) => Math.max(m, h.start + h.len), 1);
  const totalSteps = Math.ceil(lastStep / STEPS_PER_BAR) * STEPS_PER_BAR;

  const cells = Array.from({ length: totalSteps }, () => ({ onset: null, held: false }));
  hits.forEach((h) => {
    const cell = cells[h.start];
    cell.onset = [...new Set([...(cell.onset ?? []), ...h.notes])];
  });
  hits.forEach((h) => {
    for (let s = h.start + 1; s < Math.min(totalSteps, h.start + h.len); s++) {
      if (cells[s].onset) break;
      cells[s].held = true;
    }
  });

  const name = (semi) => NOTE_NAMES[((semi % 12) + 12) % 12] + (Math.floor((60 + semi) / 12) - 1);
  const token = (cell) => (cell.onset ? cell.onset.slice().sort((a, b) => a - b).map(name).join("+") : cell.held ? "-" : "r");
  const header = `${instrument}${label ? " " + label : ""}:`;
  return [scoreLines(header, cells, token), ...(fx ? fxToEtude(fx, bpm).map((l) => "  " + l) : [])].join("\n");
}

/* Arpeggios become one hit per arp step. */
function expandEvent(e) {
  const dur = e.dur ?? 0.25;
  if (e.kind !== "arp") return [{ notes: e.notes, t: e.tRel, dur }];
  const step = 1 / (e.rateHz || 8);
  const count = Math.max(1, Math.round(dur / step));
  return Array.from({ length: count }, (_, i) => ({ notes: [e.notes[i % e.notes.length]], t: e.tRel + i * step, dur: step }));
}

/**
 * @param {number[][]} grid  grid[drum][step] = 0|1, 16 steps
 * @param {string[]} codes   tonus drum code per row
 * @param {string} [label]
 */
export function drumsToEtude(grid, codes, label = "") {
  const cells = Array.from({ length: STEPS_PER_BAR }, (_, s) => {
    const hit = codes.filter((_, d) => grid[d][s]).map((c) => DRUM_CODE_TO_ETUDE[c]).filter(Boolean);
    return { onset: hit.length ? hit : null, held: false };
  });
  return scoreLines(`drums${label ? " " + label : ""}:`, cells, (c) => (c.onset ? c.onset.join("+") : "r"), { percussive: true });
}

/* Split cells into bars, write each bar at its coarsest even division,
   use % for repeated bars, and wrap every few bars onto a new line. */
function scoreLines(header, cells, token, { percussive = false } = {}) {
  const bars = [];
  for (let b = 0; b < cells.length; b += STEPS_PER_BAR) bars.push(barText(cells.slice(b, b + STEPS_PER_BAR), token, percussive));
  const written = bars.map((bar, i) => (i > 0 && bar === bars[i - 1] ? "%" : bar));
  const lines = [];
  for (let i = 0; i < written.length; i += BARS_PER_LINE) {
    const chunk = `| ${written.slice(i, i + BARS_PER_LINE).join(" | ")} |`;
    lines.push(i === 0 ? `${header} ${chunk}` : `${" ".repeat(header.length)} ${chunk}`);
  }
  return lines.join("\n");
}

function barText(cells, token, percussive) {
  const division = BAR_DIVISIONS.find((d) => {
    const size = STEPS_PER_BAR / d;
    return cells.every((c, i) => i % size === 0 || (!c.onset && continues(c, cells[i - (i % size)], percussive)));
  }) ?? STEPS_PER_BAR;
  const size = STEPS_PER_BAR / division;
  return cells.filter((_, i) => i % size === 0).map(token).join(" ");
}

/* A cell can be dropped when it continues whatever its slot started with:
   a hold after a sounding note, or silence after silence. Drum hits
   don't hold, so silence after a hit is fine too. */
function continues(cell, slotStart, percussive) {
  if (cell.held) return Boolean(slotStart.onset) || slotStart.held;
  return percussive || (!slotStart.onset && !slotStart.held);
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export { highlight } from "./highlight.js";
export { DYNAMICS, TONES, BOWINGS, HALLS, NOTE_VALUES, SEATS } from "./vocab.js";
