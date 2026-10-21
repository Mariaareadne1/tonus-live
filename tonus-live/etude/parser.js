/* ============================================================
   étude — parser
   Turns a written score into timed events plus per-part
   modifiers. Pure: no DOM, no audio, so it runs under node too.

   A score reads like sheet music:
     tempo Andante              ← globals: tempo, time, key
     violin: | A4 B4 C#5 D5 |   ← a part, with its bars
             | E5 - - - |       ← more bars on the next line
       dynamics p < f           ← modifiers for the part above
   ============================================================ */

import { EtudeError } from "./errors.js";
import { expandScore } from "./expand.js";
import { foldArithmetic } from "./expr.js";
import {
  INSTRUMENTS, DRUM_SOUNDS, DYNAMICS, TONES, VIBRATOS, BOWINGS, DEFAULT_BOWING,
  ENVELOPE_LABELS, HALLS, NOTE_VALUES, DEFAULT_ECHO_TIME, DEFAULT_ECHO_FEEDBACK,
  SEATS, SPEEDS, TEMPO_MARKS, DEFAULT_TEMPO, GLOBALS, MODIFIERS, VALUE_WORDS, PROGRAM_WORDS,
} from "./vocab.js";

/**
 * @typedef {{ beat: number, dur: number, pitches: number[], drums: string[],
 *             range: [number, number], index: number, bar: number }} ScoreEvent
 * @typedef {{ kind: "const"|"note"|"bar"|"curve", values: any[], ramps?: boolean[],
 *             spanBars?: number|null, log?: boolean }} ValuePattern
 * @typedef {{ instrument: string, label: string, line: number, events: ScoreEvent[],
 *             loopBeats: number, loopBars: number, noteCount: number,
 *             mods: Record<string, any>, tacet: boolean, speed: number }} Part
 * @typedef {{ tempo: number, beatsPerBar: number, key: string|null, keyFifths: number, parts: Part[] }} Program
 */

export { EtudeError };

const HEADER_RE = /^\s*([A-Za-z]+)(?:\s+([\w-]+))?\s*:/;
const NOTE_RE = /^([A-Ga-g])(##|#|bb|b|n)?(-?\d)?$/;
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL = { "##": 2, "#": 1, n: 0, b: -1, bb: -2 };
const SHARP_ORDER = "FCGDAEB";
const FLAT_ORDER = "BEADGCF";
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MINOR_FIFTHS = { A: 0, E: 1, B: 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7 };
const CURVABLE = ["dynamics", "tone", "seat"];
const SCORE_STARTERS = ["repeat", "if"];
const LET_RE = /^(\s*let\s+)([A-Za-z_][\w-]*)\s*=\s*/;
const MAX_LET_DEPTH = 16;

/* ---------- public ---------- */

/**
 * @param {string} source
 * @returns {Program}
 */
export function parse(source) {
  const state = {
    tempo: DEFAULT_TEMPO, beatsPerBar: 4, keyName: null, keyFifths: 0, keyMap: {}, drafts: [],
    lets: new Map(),   // name → { kind: "phrase"|"value", segments, line }
    context: null,     // what bar-line lines continue: "part", "let" (a phrase) or "value"
  };

  let offset = 0;
  source.split("\n").forEach((rawLine, i) => {
    readLine(state, stripComment(rawLine), offset, i + 1);
    offset += rawLine.length + 1;
  });

  if (state.drafts.length === 0) {
    throw new EtudeError("Nothing to play yet. Start a part, for example:  violin: | A4 B4 C#5 D5 |", 1);
  }

  return {
    tempo: state.tempo,
    beatsPerBar: state.beatsPerBar,
    key: state.keyName,
    keyFifths: state.keyFifths,
    parts: state.drafts.map((draft) => buildPart(draft, state, letTokens(state))),
  };
}

/**
 * Value of a modifier pattern for one note.
 * @param {ValuePattern} pattern
 * @param {{ noteIndex?: number, barIndex?: number, beat?: number, spanBeats?: number, beatsPerBar?: number }} ctx
 */
export function valueAt(pattern, ctx) {
  const { kind, values } = pattern;
  if (kind === "const") return values[0];
  if (kind === "note") return values[mod(ctx.noteIndex ?? 0, values.length)];
  if (kind === "bar") return values[mod(ctx.barIndex ?? 0, values.length)];
  return curveAt(pattern, ctx);
}

/* ---------- line dispatch ---------- */

function stripComment(line) {
  const at = line.indexOf("//");
  return at === -1 ? line : line.slice(0, at);
}

function readLine(state, line, offset, lineNo) {
  if (line.trim() === "") return;
  const trimmed = line.trimStart();
  const first = trimmed.split(/\s+/)[0];

  if (first.toLowerCase() === "let") {
    readLet(state, line, offset, lineNo);
    return;
  }
  if (trimmed.startsWith("|")) {
    addScoreLine(state, line, offset, lineNo, state.context === "let");
    return;
  }
  if (SCORE_STARTERS.includes(first) || state.lets.get(first)?.kind === "phrase") {
    addScoreLine(state, line, offset, lineNo, false);
    return;
  }

  const header = line.match(HEADER_RE);
  if (header) {
    startPart(state, header, offset, lineNo);
    state.context = "part";
    return;
  }

  const [word, ...args] = trimmed.trim().split(/\s+/);
  const keyword = word.toLowerCase();
  if (GLOBALS.includes(keyword)) {
    readGlobal(state, keyword, args, lineNo);
    return;
  }
  if (!MODIFIERS.includes(keyword)) {
    throw new EtudeError(`I don't know "${word}".${suggest(word, [...MODIFIERS, ...GLOBALS, ...state.lets.keys()])}`, lineNo);
  }
  if (state.context !== "part") {
    throw new EtudeError(`"${keyword}" goes under a part. Move it below the part it belongs to, after any let lines.`, lineNo);
  }
  const draft = currentPart(state, lineNo, `"${keyword}"`);
  draft.mods[keyword] = { args, line: lineNo };
}

/* A line of bars: continues the phrase being defined, or the current part. */
function addScoreLine(state, line, offset, lineNo, intoLet) {
  const seg = { text: line, offset, line: lineNo };
  if (intoLet) {
    state.pendingLet.segments.push(seg);
    return;
  }
  if (state.context !== "part") {
    throw new EtudeError("Bars need a part to belong to. Start one first, like  violin: | A4 |", lineNo);
  }
  currentPart(state, lineNo, "Bar lines").segments.push(seg);
}

/* let name = | bars … |   (a phrase)   or   let name = words   (a value) */
function readLet(state, line, offset, lineNo) {
  const m = line.match(LET_RE);
  if (!m) throw new EtudeError("Write a variable like  let opening = | D5 E5 F5 G5 |  or  let soft = pp", lineNo);
  const name = m[2];
  checkName(name, lineNo);
  const valueText = line.slice(m[0].length);
  if (valueText.trim() === "") throw new EtudeError(`"${name}" needs a value after the =.`, lineNo);
  const firstWord = valueText.trim().split(/\s+/)[0];
  const isPhrase = /^\s*(\||repeat\b|if\b)/.test(valueText) || state.lets.get(firstWord)?.kind === "phrase";
  const entry = { kind: isPhrase ? "phrase" : "value", segments: [{ text: valueText, offset: offset + m[0].length, line: lineNo }], line: lineNo };
  state.lets.set(name, entry);
  state.pendingLet = entry;
  state.context = isPhrase ? "let" : "value";
}

function checkName(name, lineNo) {
  const lower = name.toLowerCase();
  if (INSTRUMENTS.includes(lower)) throw new EtudeError(`"${name}" is an instrument, so it can't be a variable name.`, lineNo);
  if (NOTE_RE.test(name)) throw new EtudeError(`"${name}" looks like a note, so it can't be a variable name. Try a word like "opening".`, lineNo);
  if (/^[x*]\d+$/.test(lower) || DRUM_SOUNDS.includes(lower) || GLOBALS.includes(lower) || MODIFIERS.includes(lower)
      || VALUE_WORDS.has(lower) || PROGRAM_WORDS.includes(lower)) {
    throw new EtudeError(`"${name}" already means something in étude. Pick another name.`, lineNo);
  }
}

/* Every let as tokens, for expanding scores. */
function letTokens(state) {
  return new Map([...state.lets].map(([name, v]) => [name, { kind: v.kind, line: v.line, tokens: v.segments.flatMap(tokenizeSegment) }]));
}

/* Substitute value variables in modifier/tempo words, then do any arithmetic. */
function resolveWords(state, words, line, depth = 0) {
  if (depth > MAX_LET_DEPTH) throw new EtudeError("A variable seems to refer to itself, so it would never end.", line);
  const pieces = words.flatMap((w) => w.split(/([<>|*/+()])/)).filter((w) => w !== "");
  const out = pieces.flatMap((p) => {
    const v = state.lets.get(p);
    if (!v) return [p];
    if (v.kind === "phrase") throw new EtudeError(`"${p}" is a phrase of notes, so it can't be used as a value here.`, line);
    return resolveWords(state, v.segments.map((seg) => seg.text).join(" ").trim().split(/\s+/), line, depth + 1);
  });
  return depth === 0 ? foldArithmetic(out, line) : out;
}

function startPart(state, header, offset, lineNo) {
  const instrument = header[1].toLowerCase();
  if (!INSTRUMENTS.includes(instrument)) {
    throw new EtudeError(
      `"${header[1]}" isn't an instrument I know.${suggest(header[1], INSTRUMENTS)} Try one of: ${INSTRUMENTS.join(", ")}.`,
      lineNo,
    );
  }
  const scoreStart = header[0].length;
  state.drafts.push({
    instrument,
    label: header[2] ?? "",
    line: lineNo,
    segments: [{ text: header.input.slice(scoreStart), offset: offset + scoreStart, line: lineNo }],
    mods: {},
  });
}

function currentPart(state, lineNo, what) {
  const draft = state.drafts[state.drafts.length - 1];
  if (!draft) {
    throw new EtudeError(`${what} need a part to belong to. Start one first, like  violin: | A4 |`, lineNo);
  }
  return draft;
}

function readGlobal(state, keyword, args, lineNo) {
  const arg = args.join(" ");
  if (keyword === "tempo") {
    state.tempo = readTempo(resolveWords(state, args, lineNo).join(" "), lineNo);
    return;
  }
  if (keyword === "time") {
    const m = arg.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m || +m[1] < 1 || +m[1] > 16) {
      throw new EtudeError(`Write the time signature like  time 3/4  (got "${arg}").`, lineNo);
    }
    state.beatsPerBar = +m[1];
    return;
  }
  const { name, map, fifths } = readKey(arg, lineNo);
  state.keyName = name;
  state.keyFifths = fifths;
  state.keyMap = map;
}

function readTempo(arg, lineNo) {
  const mark = TEMPO_MARKS[arg.toLowerCase()];
  if (mark) return mark;
  const bpm = Number(arg);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
    throw new EtudeError(
      `Tempo is beats per minute (20–300) or a marking like ${Object.keys(TEMPO_MARKS).slice(3, 8).join(", ")}.`,
      lineNo,
    );
  }
  return bpm;
}

function readKey(arg, lineNo) {
  const m = arg.replace(/♯/g, "#").replace(/♭/g, "b").match(/^([A-Ga-g])(#|b)?\s*(major|minor)?$/i);
  const tonic = m ? m[1].toUpperCase() + (m[2] ?? "") : "";
  const mode = (m?.[3] ?? "major").toLowerCase();
  const fifths = (mode === "minor" ? MINOR_FIFTHS : MAJOR_FIFTHS)[tonic];
  if (fifths === undefined) {
    throw new EtudeError(`Write the key like  key D major  or  key G minor  (got "${arg}").`, lineNo);
  }
  const letters = fifths > 0 ? SHARP_ORDER.slice(0, fifths) : FLAT_ORDER.slice(0, -fifths);
  const map = Object.fromEntries([...letters].map((l) => [l, fifths > 0 ? 1 : -1]));
  return { name: `${tonic} ${mode}`, map, fifths };
}

/* ---------- parts ---------- */

function buildPart(draft, state, lets) {
  const bars = readBars(draft, lets);
  const events = layoutBars(bars, draft, state);
  if (events.length === 0 && bars.length === 0) {
    throw new EtudeError(`The ${draft.instrument} has no notes yet — add a bar like  | A4 B4 C#5 D5 |`, draft.line);
  }
  const part = {
    instrument: draft.instrument,
    label: draft.label,
    line: draft.line,
    events,
    loopBars: bars.length,
    loopBeats: bars.length * state.beatsPerBar,
    noteCount: events.length,
    mods: {},
    tacet: false,
    speed: 1,
  };
  return Object.entries(draft.mods).reduce(
    (acc, [name, mod]) => applyModifier(acc, name, resolveWords(state, mod.args, mod.line), mod.line),
    part,
  );
}

/* Tokenise and expand every score segment, then split into bars. Repeats,
   endings and simile bars copy token lists, so copies keep their source ranges. */
function readBars(draft, lets) {
  const bars = [];
  let current = [];
  let repeatFrom = 0;
  let endingAt = null;
  let simile = false;

  const closeBar = () => {
    if (current.length > 0) bars.push(current);
    current = [];
    simile = false;
  };

  const ctx = { lets, loops: {}, depth: 0 };
  const tokens = draft.segments.flatMap((seg) => expandScore(tokenizeSegment(seg), ctx));
  tokens.forEach((tok, i) => {
    if (tok.text === "|") return closeBar();
    if (/^\|\d\.$/.test(tok.text)) {
      closeBar();
      if (tok.text === "|1.") endingAt = bars.length;
      return;
    }
    if (/^:\|\d\.$/.test(tok.text) || (tok.text === ":|" && endingAt !== null)) {
      closeBar();
      if (endingAt === null) throw new EtudeError(`"${tok.text}" needs a first ending (|1.) before it.`, tok.line);
      bars.push(...bars.slice(repeatFrom, endingAt));
      endingAt = null;
      repeatFrom = bars.length;
      return;
    }
    if (tok.text === "|:") {
      closeBar();
      repeatFrom = bars.length;
      return;
    }
    if (tok.text === ":|") {
      closeBar();
      const next = tokens[i + 1];
      const times = next && /^x\d+$/.test(next.text) ? Number(next.text.slice(1)) : 2;
      const passage = bars.slice(repeatFrom);
      for (let n = 1; n < times; n++) bars.push(...passage);
      repeatFrom = bars.length;
      return;
    }
    if (/^x\d+$/.test(tok.text)) {
      if (tokens[i - 1]?.text !== ":|") {
        throw new EtudeError(`"${tok.text}" goes right after a repeat sign, like  |: A4 B4 :| x3`, tok.line);
      }
      return;
    }
    if (tok.text === "%") {
      if (current.length > 0 || bars.length === 0) {
        throw new EtudeError("% (simile) fills a whole bar on its own and repeats the bar before it.", tok.line);
      }
      current = [...bars[bars.length - 1]];
      simile = true;
      return;
    }
    if (simile) throw new EtudeError("% (simile) fills a whole bar on its own and repeats the bar before it.", tok.line);
    current.push(tok);
  });
  closeBar();
  return bars;
}

function tokenizeSegment(seg) {
  const re = /:\|\d\.|\|\d\.|\|:|:\||\||\(|\)|%|\*\d+|\*|:|-(?=\s|$|[|)])|[^\s|()*%:]+/g;
  return [...seg.text.matchAll(re)].map((m) => ({
    text: m[0],
    start: seg.offset + m.index,
    end: seg.offset + m.index + m[0].length,
    line: seg.line,
  }));
}

function layoutBars(bars, draft, state) {
  const events = [];
  const cursor = { last: null };
  bars.forEach((barTokens, barIndex) => {
    const nodes = readNodes(barTokens, { i: 0 }, false);
    placeNodes(nodes, barIndex * state.beatsPerBar, state.beatsPerBar, { events, cursor, barIndex, draft, state });
  });
  return events.map((e, index) => ({ ...e, index }));
}

/* Bar tokens → tree of leaves, ties, rests and beamed groups. */
function readNodes(tokens, pos, inGroup) {
  const nodes = [];
  while (pos.i < tokens.length) {
    const tok = tokens[pos.i++];
    if (tok.text === ")") {
      if (!inGroup) throw new EtudeError('There is a ")" without a matching "(".', tok.line);
      return nodes;
    }
    if (tok.text === "(") {
      nodes.push({ type: "group", children: readNodes(tokens, pos, true), tok });
    } else if (/^\*\d+$/.test(tok.text) || (tok.text === "*" && /^\d+$/.test(tokens[pos.i]?.text ?? ""))) {
      const prev = nodes.pop();
      if (!prev) throw new EtudeError(`"${tok.text}" repeats the note before it, like  hat*8`, tok.line);
      const times = Number(tok.text === "*" ? tokens[pos.i++].text : tok.text.slice(1));
      if (times < 1 || times > 64) throw new EtudeError("Repeat a note between 1 and 64 times.", tok.line);
      nodes.push(...Array(times).fill(prev));
    } else {
      nodes.push({ type: "leaf", tok });
    }
  }
  if (inGroup) throw new EtudeError('A "(" group is missing its ")".', tokens[tokens.length - 1].line);
  return nodes;
}

function placeNodes(nodes, start, span, ctx) {
  const step = span / nodes.length;
  nodes.forEach((node, i) => {
    const beat = start + i * step;
    if (node.type === "group") {
      if (node.children.length === 0) throw new EtudeError("An empty ( ) group has nothing to play.", node.tok.line);
      placeNodes(node.children, beat, step, ctx);
      return;
    }
    placeLeaf(node.tok, beat, step, ctx);
  });
}

function placeLeaf(tok, beat, dur, ctx) {
  const word = tok.text;
  if (word === "-") {
    if (ctx.cursor.last) ctx.cursor.last.dur += dur;
    return;
  }
  if (word === "r" || word === "rest") {
    ctx.cursor.last = null;
    return;
  }
  const isDrums = ctx.draft.instrument === "drums";
  const pieces = word.split("+");
  const event = {
    beat,
    dur,
    pitches: isDrums ? [] : pieces.map((p) => readPitch(p, tok, ctx.state.keyMap) + (tok.transpose ?? 0)),
    drums: isDrums ? pieces.map((p) => readDrum(p, tok)) : [],
    range: [tok.start, tok.end],
    bar: ctx.barIndex,
  };
  ctx.events.push(event);
  ctx.cursor.last = event;
}

function readPitch(text, tok, keyMap) {
  const m = text.replace(/♯/g, "#").replace(/♭/g, "b").match(NOTE_RE);
  if (!m) {
    const hint = DRUM_SOUNDS.includes(text.toLowerCase())
      ? ` "${text}" is a drum sound — put it in a drums: part.`
      : " Notes look like A4, C#5, Bb3 (letter, optional # or b, octave).";
    throw new EtudeError(`"${text}" isn't a note.${hint}`, tok.line);
  }
  const letter = m[1].toUpperCase();
  const accidental = m[2] !== undefined ? ACCIDENTAL[m[2]] : (keyMap[letter] ?? 0);
  const octave = m[3] !== undefined ? Number(m[3]) : 4;
  return 12 * (octave + 1) + LETTER_PC[letter] + accidental;
}

function readDrum(text, tok) {
  const name = text.toLowerCase();
  if (!DRUM_SOUNDS.includes(name)) {
    throw new EtudeError(`"${text}" isn't a drum sound.${suggest(text, DRUM_SOUNDS)} Drums are: ${DRUM_SOUNDS.join(", ")}.`, tok.line);
  }
  return name;
}

/* ---------- modifiers ---------- */

const READERS = {
  dynamics: (args, line) => readPattern(args, line, "dynamics", (w) => named(w, line, DYNAMICS, [0, 1], "a dynamic like p, mf, ff (or 0–1)")),
  tone: (args, line) => ({ ...readPattern(args, line, "tone", (w) => named(w, line, TONES, [40, 20000], "tasto, normale, ponticello (or a number in Hz)")), log: true }),
  seat: (args, line) => readPattern(args, line, "seat", (w) => named(w, line, SEATS, [-1, 1], "left, center, right (or -1 to 1)")),
  vibrato: (args, line) => readPattern(args, line, "vibrato", (w) => readVibrato(w, line)),
  bowing: (args, line) => readBowing(args, line),
  echo: (args, line) => readEcho(args, line),
  hall: (args, line) => readHall(args, line),
};

function applyModifier(part, name, args, line) {
  if (name === "tacet") return { ...part, tacet: true };
  if (name === "speed") return { ...part, speed: readSpeed(args, line) };
  if (args.length === 0) throw new EtudeError(`"${name}" needs a value.`, line);
  return { ...part, mods: { ...part.mods, [name]: READERS[name](args, line) } };
}

/* A list of values: one per note, one per bar (with | bar lines), or a
   hairpin curve (with < or >), optionally stretched with "over N". */
function readPattern(args, line, name, resolve) {
  const overAt = args.indexOf("over");
  const spanBars = overAt === -1 ? null : readOver(args.slice(overAt + 1), line);
  const words = overAt === -1 ? args : args.slice(0, overAt);
  // allow "p<f" without spaces
  const tokens = words.flatMap((w) => w.split(/([<>|])/)).filter((w) => w !== "");

  if (tokens.some((t) => t === "<" || t === ">")) {
    if (!CURVABLE.includes(name)) {
      throw new EtudeError(`Hairpins (< and >) work with ${CURVABLE.join(", ")} — not ${name}.`, line);
    }
    return readCurve(tokens, line, resolve, spanBars);
  }
  if (spanBars !== null) throw new EtudeError(`"over" stretches a hairpin, like  dynamics p < f over 4`, line);

  if (tokens.includes("|")) {
    const groups = tokens.join(" ").split("|").map((g) => g.trim()).filter((g) => g !== "");
    if (groups.some((g) => g.includes(" "))) {
      throw new EtudeError(`Between bar lines, give ${name} one value per bar, like  ${name} | p | f |`, line);
    }
    return { kind: "bar", values: groups.map(resolve) };
  }
  const values = tokens.map(resolve);
  return { kind: values.length === 1 ? "const" : "note", values };
}

function readCurve(tokens, line, resolve, spanBars) {
  const values = [];
  const ramps = [];
  let pendingRamp = false;
  tokens.forEach((t) => {
    if (t === "|") throw new EtudeError("Use either bar lines or hairpins in one line, not both.", line);
    if (t === "<" || t === ">") {
      if (values.length === 0) throw new EtudeError("A hairpin needs a starting value, like  p < f", line);
      pendingRamp = true;
      return;
    }
    if (values.length > 0) ramps.push(pendingRamp);
    values.push(resolve(t));
    pendingRamp = false;
  });
  if (pendingRamp) throw new EtudeError("A hairpin needs somewhere to go, like  p < f", line);
  return { kind: values.length === 1 ? "const" : "curve", values, ramps, spanBars };
}

function readOver(rest, line) {
  const n = Number(rest[0]);
  if (!Number.isFinite(n) || n <= 0 || n > 64) throw new EtudeError('Write "over" with a number of bars, like  over 4', line);
  return n;
}

function named(word, line, table, [min, max], expected) {
  const key = word.toLowerCase();
  if (key in table) return table[key];
  const n = Number(word);
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  throw new EtudeError(`"${word}" should be ${expected}.${suggest(word, Object.keys(table))}`, line);
}

function readVibrato(word, line) {
  const key = word.toLowerCase();
  if (key in VIBRATOS) return VIBRATOS[key];
  const depth = Number(word);
  if (Number.isFinite(depth) && depth >= 0 && depth <= 100) return { rate: 5.5, depth };
  throw new EtudeError(`Vibrato is ${Object.keys(VIBRATOS).join(", ")} (or a width in cents).${suggest(word, Object.keys(VIBRATOS))}`, line);
}

function readBowing(args, line) {
  const first = args[0].toLowerCase();
  if (!ENVELOPE_LABELS.includes(first)) {
    return readPattern(args, line, "bowing", (w) => {
      const stroke = BOWINGS[w.toLowerCase()];
      if (!stroke) throw new EtudeError(`"${w}" isn't a bow stroke.${suggest(w, Object.keys(BOWINGS))} Strokes: ${Object.keys(BOWINGS).join(", ")}.`, line);
      return stroke;
    });
  }
  if (args.length % 2 !== 0) throw new EtudeError("Give each envelope word a number, like  bowing attack 0.1 release 0.5", line);
  const custom = { ...BOWINGS[DEFAULT_BOWING], length: 1 };
  for (let i = 0; i < args.length; i += 2) {
    const label = args[i].toLowerCase();
    const n = Number(args[i + 1]);
    if (!ENVELOPE_LABELS.includes(label)) {
      throw new EtudeError(`"${args[i]}" isn't part of an envelope.${suggest(args[i], ENVELOPE_LABELS)}`, line);
    }
    if (!Number.isFinite(n) || n < 0 || n > 4) throw new EtudeError(`${label} should be a number of seconds from 0 to 4.`, line);
    custom[label] = label === "sustain" ? Math.min(n, 1) : n;
  }
  return { kind: "const", values: [custom] };
}

function readEcho(args, line) {
  const amount = Number(args[0]);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new EtudeError("Echo starts with an amount from 0 to 1, like  echo 0.5", line);
  const timeWord = (args[1] ?? DEFAULT_ECHO_TIME).toLowerCase();
  const beats = NOTE_VALUES[timeWord] ?? Number(timeWord);
  if (!Number.isFinite(beats) || beats <= 0 || beats > 8) {
    throw new EtudeError(`The echo's second word is a note value: ${Object.keys(NOTE_VALUES).join(", ")}.${suggest(timeWord, Object.keys(NOTE_VALUES))}`, line);
  }
  const feedback = args[2] === undefined ? DEFAULT_ECHO_FEEDBACK : Number(args[2]);
  if (!Number.isFinite(feedback) || feedback < 0 || feedback > 0.95) throw new EtudeError("The echo's third number (how long it keeps repeating) goes from 0 to 0.95.", line);
  return { amount, beats, feedback };
}

function readHall(args, line) {
  const word = args[0].toLowerCase();
  if (word in HALLS) return HALLS[word];
  const seconds = Number(word);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 12) return seconds;
  throw new EtudeError(`Halls are ${Object.keys(HALLS).join(", ")} (or seconds of reverb, 0–12).${suggest(word, Object.keys(HALLS))}`, line);
}

function readSpeed(args, line) {
  const word = (args[0] ?? "").toLowerCase();
  const n = SPEEDS[word] ?? Number(word);
  if (!Number.isFinite(n) || n < 0.125 || n > 8) throw new EtudeError("Speed is half, double, or a number like 1.5", line);
  return n;
}

/* ---------- curves ---------- */

function curveAt(pattern, ctx) {
  const { values, ramps, spanBars, log } = pattern;
  const spanBeats = spanBars ? spanBars * (ctx.beatsPerBar ?? 4) : (ctx.spanBeats ?? 4);
  const pos = mod(ctx.beat ?? 0, spanBeats) / spanBeats;
  const segments = values.length - 1;
  const at = pos * segments;
  const i = Math.min(Math.floor(at), segments - 1);
  const frac = at - i;
  if (!ramps[i]) return values[i];
  const [a, b] = [values[i], values[i + 1]];
  if (log && a > 0 && b > 0) return a * Math.pow(b / a, frac);
  return a + (b - a) * frac;
}

/* ---------- helpers ---------- */

function mod(n, m) {
  return ((n % m) + m) % m;
}

function suggest(word, options) {
  const target = word.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  options.forEach((opt) => {
    const d = distance(target, opt);
    if (d < bestDist) [best, bestDist] = [opt, d];
  });
  return best && bestDist <= Math.max(2, Math.floor(target.length / 3)) ? ` Did you mean "${best}"?` : "";
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
