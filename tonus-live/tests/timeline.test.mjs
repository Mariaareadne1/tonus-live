import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../etude/parser.js";
import { notesBetween } from "../etude/timeline.js";

test("finds notes in a window and keeps looping the part", () => {
  const program = parse("violin: | A4 B4 |");
  const notes = notesBetween(program, 3, 9);
  assert.deepEqual(notes.map((n) => n.beat), [4, 6, 8]);
  assert.deepEqual(notes.map((n) => n.event.pitches[0]), [69, 71, 69]);
});

test("per-note values keep counting across loops", () => {
  const program = parse("violin: | A4 B4 C5 |\n  dynamics p mf");
  const dyn = notesBetween(program, 0, 5).map((n) => n.params.dynamic);
  assert.deepEqual(dyn, [0.25, 0.52, 0.25, 0.52]);
});

test("speed half stretches a part to twice the length", () => {
  const program = parse("drums: | kick kick kick kick |\n  speed half");
  assert.deepEqual(notesBetween(program, 0, 8).map((n) => n.beat), [0, 2, 4, 6]);
  assert.equal(notesBetween(program, 0, 1)[0].dur, 2);
});

test("tacet parts stay silent", () => {
  const program = parse("violin: | A4 |\n  tacet\ncello: | C3 |");
  const notes = notesBetween(program, 0, 4);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].part.instrument, "cello");
});

test("strings get bowing and vibrato by default; piano does not", () => {
  const program = parse("violin: | A4 |\npiano: | A4 |");
  const [violin, piano] = notesBetween(program, 0, 1);
  assert.ok(violin.params.bowing);
  assert.ok(violin.params.vibrato.depth > 0);
  assert.equal(piano.params.bowing, null);
  assert.equal(piano.params.vibrato.depth, 0);
});
