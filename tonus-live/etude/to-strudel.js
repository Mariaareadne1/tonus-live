/* ============================================================
   étude → Strudel
   Translates a parsed program into Strudel code. One bar becomes
   one Strudel cycle, so bars map onto <…> alternation and each
   bar's rhythm onto an evenly divided [ … ] sequence. Per-note
   modifiers are resolved through the timeline, so the export
   plays the same values étude plays.
   ============================================================ */

import { notesBetween } from "./timeline.js";
import { STRINGS } from "./vocab.js";

export const STRUDEL_SOUNDS = {
  violin: "gm_violin", viola: "gm_viola", cello: "gm_cello", bass: "gm_contrabass",
  piano: "gm_piano", harp: "gm_orchestral_harp", flute: "gm_flute", organ: "gm_church_organ",
};
export const PIZZ_SOUND = "gm_pizzicato_strings";
export const STRUDEL_DRUMS = { kick: "bd", snare: "sd", hat: "hh", openhat: "oh", clap: "cp", rim: "rim", tom: "lt", crash: "cr" };

const SHARP_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
const FLAT_NAMES = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"];
const MAX_GRID = 64;
const MAX_LOOPS = 8;
const EPS = 1e-6;
const HALL_ROOM = 0.4;
const MAX_ROOMSIZE = 10;

/**
 * @param {import("./parser.js").Program} program
 * @returns {string}
 */
export function toStrudel(program) {
  const cpm = program.tempo / program.beatsPerBar;
  const lines = [
    "// translated from étude · one bar = one cycle",
    `setcpm(${round(cpm, 3)})`,
    "",
  ];
  program.parts.forEach((part) => {
    lines.push(`// ${part.instrument}${part.label ? " " + part.label : ""}`);
    lines.push(partToStrudel(program, part));
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}

function partToStrudel(program, part) {
  const names = program.keyFifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const isDrums = part.instrument === "drums";
  const noteToken = (event) => {
    const words = isDrums
      ? event.drums.map((d) => STRUDEL_DRUMS[d])
      : event.pitches.map((m) => names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1));
    return words.length === 1 ? words[0] : `[${words.join(",")}]`;
  };

  const head = `$: ${isDrums ? "s" : "note"}("${layout(part, 1, (occ) => noteToken(occ.event))}")`;
  const chain = isDrums ? [] : [soundCall(part)];
  chain.push(...controlCalls(program, part));
  if (part.speed > 1) chain.push(`.fast(${round(part.speed, 3)})`);
  if (part.speed < 1) chain.push(`.slow(${round(1 / part.speed, 3)})`);
  if (part.tacet) chain.push(".hush()");
  return [head, ...chain.filter(Boolean).map((c) => "  " + c)].join("\n");
}

/* ---------- rhythm layout ---------- */

/* Mini-notation for `loops` passes through the part. `token(occ)` turns
   one note occurrence into text (a note name, or a control value). */
function layout(part, loops, token, occurrences = null) {
  const occs = occurrences ?? loopOccurrences(part, loops);
  const barBeats = part.loopBeats / part.loopBars;
  const crossesBar = occs.some((o) => endOf(o) > barStart(o, barBeats) + barBeats + EPS);
  if (crossesBar) return weightedLayout(part, loops, occs, token);

  const totalBars = part.loopBars * loops;
  const bars = Array.from({ length: totalBars }, (_, b) => {
    const inBar = occs.filter((o) => Math.floor(o.localBeat / barBeats + EPS) === b);
    return barLayout(inBar, b * barBeats, barBeats, token, totalBars === 1);
  });
  return bars.length === 1 ? bars[0] : `<${bars.join(" ")}>`;
}

function barLayout(occs, start, beats, token, bare) {
  if (occs.length === 0) return "~";
  const points = occs.flatMap((o) => [o.localBeat - start, Math.min(endOf(o) - start, beats)]);
  const steps = gridSize(points, beats);
  const cells = Array(steps).fill("~");
  occs.forEach((o) => {
    const s = Math.round(((o.localBeat - start) / beats) * steps);
    const e = Math.round(((Math.min(endOf(o) - start, beats)) / beats) * steps);
    cells[s] = token(o);
    for (let i = s + 1; i < e; i++) cells[i] = "_";
  });
  return cells.length === 1 || bare ? cells.join(" ") : `[${cells.join(" ")}]`;
}

/* Ties across bar lines: one long weighted sequence, slowed to fit. */
function weightedLayout(part, loops, occs, token) {
  const total = part.loopBeats * loops;
  const segments = [];
  let cursor = 0;
  occs.forEach((o) => {
    if (o.localBeat > cursor + EPS) segments.push(["~", o.localBeat - cursor]);
    segments.push([token(o), o.event.dur]);
    cursor = o.localBeat + o.event.dur;
  });
  if (cursor < total - EPS) segments.push(["~", total - cursor]);
  const scale = gridSize(segments.map(([, w]) => w), 1);
  const body = segments.map(([t, w]) => {
    const k = Math.round(w * scale);
    return k === 1 ? t : `${t}@${k}`;
  }).join(" ");
  const bars = part.loopBars * loops;
  return bars === 1 ? body : `[${body}]/${bars}`;
}

function gridSize(points, span) {
  for (let n = 1; n <= MAX_GRID; n++) {
    if (points.every((p) => Math.abs((p / span) * n - Math.round((p / span) * n)) < 1e-4)) return n;
  }
  return MAX_GRID;
}

function loopOccurrences(part, loops) {
  // Local (part-time) beats, before any speed change.
  const program = { parts: [{ ...part, tacet: false, speed: 1 }], beatsPerBar: part.loopBeats / part.loopBars };
  return notesBetween(program, 0, part.loopBeats * loops).map((o) => ({ ...o, localBeat: o.beat }));
}

const endOf = (o) => o.localBeat + o.event.dur;
const barStart = (o, barBeats) => Math.floor(o.localBeat / barBeats + EPS) * barBeats;

/* ---------- sound and controls ---------- */

function soundCall(part) {
  const base = STRUDEL_SOUNDS[part.instrument];
  if (!part.mods.bowing || !STRINGS.includes(part.instrument)) return `.s("${base}")`;
  const loops = loopsNeeded(part);
  const occs = loopOccurrences(part, loops);
  const plucked = occs.map((o) => Boolean(o.params.bowing?.pluck));
  if (plucked.every(Boolean)) return `.s("${PIZZ_SOUND}")`;
  if (!plucked.some(Boolean)) return `.s("${base}")`;
  return `.s("${layout(part, loops, (o) => (o.params.bowing?.pluck ? PIZZ_SOUND : base), occs)}")`;
}

function controlCalls(program, part) {
  const { mods } = part;
  const loops = loopsNeeded(part);
  const occs = loopOccurrences(part, loops);
  const control = (name, pick, digits = 2) => controlCall(part, loops, occs, name, pick, digits);
  const calls = [];

  if (mods.dynamics) calls.push(curveCall(part, "velocity", mods.dynamics, 2) ?? control("velocity", (p) => p.dynamic));
  if (mods.tone) calls.push(curveCall(part, "lpf", mods.tone, 0) ?? control("lpf", (p) => p.tone, 0));
  if (mods.seat) calls.push(curveCall(part, "pan", mods.seat, 2, (v) => (v + 1) / 2) ?? control("pan", (p) => (p.seat + 1) / 2));
  if (mods.vibrato) {
    calls.push(control("vib", (p) => p.vibrato.rate, 1));
    calls.push(control("vibmod", (p) => p.vibrato.depth / 100, 2));
  }
  if (mods.bowing) {
    calls.push(control("attack", (p) => p.bowing.attack, 3));
    calls.push(control("decay", (p) => p.bowing.decay, 3));
    calls.push(control("sustain", (p) => p.bowing.sustain, 2));
    calls.push(control("release", (p) => p.bowing.release, 3));
    calls.push(control("clip", (p) => p.bowing.length ?? 1, 2));
  }
  if (mods.echo && mods.echo.amount > 0) {
    const seconds = (mods.echo.beats * 60) / program.tempo;
    calls.push(`.delay(${round(mods.echo.amount, 2)}).delaytime(${round(seconds, 3)}).delayfeedback(${round(mods.echo.feedback, 2)})`);
  }
  if (mods.hall) calls.push(`.room(${HALL_ROOM}).roomsize(${round(Math.min(mods.hall, MAX_ROOMSIZE), 1)})`);
  return calls;
}

/* A single value, or a mini-notation pattern lined up with the notes. */
function controlCall(part, loops, occs, name, pick, digits) {
  const values = occs.map((o) => round(pick(o.params), digits));
  if (values.every((v) => v === values[0])) return `.${name}(${values[0]})`;
  const byOcc = new Map(occs.map((o, i) => [o, values[i]]));
  return `.${name}("${layout(part, loops, (o) => String(byOcc.get(o)), occs)}")`;
}

/* Two- and three-point hairpins become Strudel signals: saw for a ramp,
   tri for there-and-back. Signals are sampled at each note, as étude is. */
function curveCall(part, name, pattern, digits, map = (v) => v) {
  if (pattern.kind !== "curve" || !pattern.ramps.every(Boolean)) return null;
  const v = pattern.values.map((x) => round(map(x), digits));
  const span = pattern.spanBars ?? part.loopBars;
  const range = pattern.log ? "rangex" : "range";
  const slow = span === 1 ? "" : `.slow(${round(span, 3)})`;
  if (v.length === 2) return `.${name}(saw.${range}(${v[0]}, ${v[1]})${slow})`;
  if (v.length === 3 && v[0] === v[2]) return `.${name}(tri.${range}(${v[0]}, ${v[1]})${slow})`;
  return null;
}

/* How many passes through the part before every per-note and per-bar
   list lines up with the notes again. */
function loopsNeeded(part) {
  const counts = Object.values(part.mods).filter((m) => m && m.kind).map((m) => {
    if (m.kind === "note") return m.values.length / gcd(part.noteCount || 1, m.values.length);
    if (m.kind === "bar") return m.values.length / gcd(part.loopBars, m.values.length);
    if (m.kind === "curve" && m.spanBars && Number.isInteger(m.spanBars)) {
      return lcm(part.loopBars, m.spanBars) / part.loopBars;
    }
    return 1;
  });
  return Math.min(MAX_LOOPS, counts.reduce(lcm, 1));
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a, b) {
  return (a * b) / gcd(a, b);
}
function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/* ---------- share links ---------- */

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** A strudel.cc link that opens with this code in the editor. */
export function strudelUrl(code) {
  return `https://strudel.cc/#${encodeURIComponent(toBase64(code))}`;
}

/** A link to the étude REPL with this code loaded. */
export function replUrl(code, base = "repl.html") {
  return `${base}#code=${encodeURIComponent(toBase64(code))}`;
}
