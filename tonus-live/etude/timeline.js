/* ============================================================
   étude — timeline
   Answers "which notes start between beat a and beat b?" for a
   parsed program, with every modifier resolved for each note.
   The audio scheduler and the score roll both ask this question.
   ============================================================ */

import { valueAt } from "./parser.js";
import {
  STRINGS, DEFAULT_DYNAMIC, DEFAULT_TONE, VIBRATOS, STRING_VIBRATO, BOWINGS, DEFAULT_BOWING,
} from "./vocab.js";

const NO_VIBRATO = VIBRATOS.none;

/**
 * @typedef {{ dynamic: number, tone: number, seat: number,
 *             vibrato: { rate: number, depth: number }, bowing: object|null }} NoteParams
 * @typedef {{ partIndex: number, part: import("./parser.js").Part,
 *             event: import("./parser.js").ScoreEvent, beat: number, dur: number,
 *             params: NoteParams }} Occurrence
 */

/**
 * Notes whose start falls in [fromBeat, toBeat), in global beats.
 * @param {import("./parser.js").Program} program
 * @param {number} fromBeat
 * @param {number} toBeat
 * @returns {Occurrence[]}
 */
export function notesBetween(program, fromBeat, toBeat) {
  if (!program || toBeat <= fromBeat) return [];
  return program.parts.flatMap((part, partIndex) =>
    part.tacet || part.loopBeats === 0 ? [] : partNotes(program, part, partIndex, fromBeat, toBeat),
  );
}

function partNotes(program, part, partIndex, fromBeat, toBeat) {
  const from = fromBeat * part.speed;
  const to = toBeat * part.speed;
  const firstLoop = Math.floor(from / part.loopBeats);
  const lastLoop = Math.floor(to / part.loopBeats);
  const found = [];

  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    const loopStart = loop * part.loopBeats;
    part.events.forEach((event) => {
      const local = loopStart + event.beat;
      if (local < from || local >= to) return;
      const ctx = {
        noteIndex: loop * part.noteCount + event.index,
        barIndex: loop * part.loopBars + event.bar,
        beat: local,
        spanBeats: part.loopBeats,
        beatsPerBar: program.beatsPerBar,
      };
      found.push({
        partIndex,
        part,
        event,
        beat: local / part.speed,
        dur: event.dur / part.speed,
        params: resolveParams(part, ctx),
      });
    });
  }
  return found;
}

function resolveParams(part, ctx) {
  const { mods, instrument } = part;
  const isString = STRINGS.includes(instrument);
  const pick = (name, fallback) => (mods[name] ? valueAt(mods[name], ctx) : fallback);
  return {
    dynamic: pick("dynamics", DEFAULT_DYNAMIC),
    tone: pick("tone", DEFAULT_TONE),
    seat: pick("seat", 0),
    vibrato: pick("vibrato", isString || instrument === "flute" ? VIBRATOS[STRING_VIBRATO] : NO_VIBRATO),
    bowing: pick("bowing", isString ? BOWINGS[DEFAULT_BOWING] : null),
  };
}
