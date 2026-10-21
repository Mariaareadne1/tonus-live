import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, valueAt, EtudeError } from "../etude/parser.js";
import { evalNumber, evalCondition, foldArithmetic } from "../etude/expr.js";

const pitches = (src, part = 0) => parse(src).parts[part].events.map((e) => e.pitches.join("+"));

/* ---------- variables ---------- */

test("let names a phrase that parts can reuse between bar lines", () => {
  const src = "let opening = | C4 D4 | E4 - |\nviolin: | opening | G4 |";
  assert.deepEqual(pitches(src), ["60", "62", "64", "67"]);
  assert.equal(parse(src).parts[0].loopBars, 3);
});

test("phrases can continue on following bar-line lines", () => {
  const src = "let tune = | C4 |\n           | D4 |\ncello: | tune |";
  assert.deepEqual(pitches(src), ["60", "62"]);
});

test("a part line can be just a phrase name", () => {
  const src = "let groove = | kick hat snare hat |\ndrums:\n  groove";
  assert.equal(parse(src).parts[0].events.length, 4);
});

test("value variables work inside bars and modifiers", () => {
  const src = "let root = D3\nlet soft = pp\nlet loud = ff\ncello: | root - root A2 |\n  dynamics soft < loud";
  const part = parse(src).parts[0];
  assert.deepEqual(part.events.map((e) => e.pitches[0]), [50, 50, 45]);
  assert.equal(valueAt(part.mods.dynamics, { beat: 0, spanBeats: 4 }), 0.15);
});

test("a multi-note value splices into the bar as a motif", () => {
  assert.deepEqual(pitches("let turn = (D5 C5 B4 C5)\nviolin: | turn A4 |"), ["74", "72", "71", "72", "69"]);
});

test("phrases can use other phrases", () => {
  const src = "let cell = | C4 |\nlet line = | cell | D4 |\nviolin: | line |";
  assert.deepEqual(pitches(src), ["60", "62"]);
});

test("sounding notes point back at the phrase definition", () => {
  const src = "let opening = | C4 D4 |\nviolin: | opening |";
  const ev = parse(src).parts[0].events[1];
  assert.equal(src.slice(ev.range[0], ev.range[1]), "D4");
});

/* ---------- multiplication ---------- */

test("x2 and * 2 repeat a phrase", () => {
  assert.equal(parse("let cell = | C4 |\nviolin: | cell x3 |").parts[0].loopBars, 3);
  assert.equal(parse("let cell = | C4 |\nviolin: | cell * 2 |").parts[0].loopBars, 2);
  assert.equal(parse("let cell = | C4 |\nviolin: | cell*2 |").parts[0].loopBars, 2);
});

test("up and down transpose a phrase by semitones", () => {
  assert.deepEqual(pitches("let third = | C4 E4 |\nviolin: | third up 7 | third down 12 |"), ["67", "71", "48", "52"]);
});

test("transposition doesn't touch drums", () => {
  assert.deepEqual(parse("let hit = | kick |\ndrums: | hit up 5 |").parts[0].events[0].drums, ["kick"]);
});

test("numbers can be calculated anywhere", () => {
  assert.equal(parse("let base = 60\ntempo base * 2\nviolin: | A4 |").tempo, 120);
  const part = parse("let beat = 0.25\nviolin: | A4 |\n  echo 0.5 beat * 2\n  hall 2 * 3").parts[0];
  assert.equal(part.mods.echo.beats, 0.5);
  assert.equal(part.mods.hall, 6);
});

/* ---------- loops ---------- */

test("repeat writes its bars N times", () => {
  assert.equal(parse("violin:\n  repeat 4: | A4 B4 |").parts[0].loopBars, 4);
});

test("repeat as n counts 1, 2, 3 … for transposing", () => {
  const src = "let step = | C4 |\nviolin:\n  repeat 3 as n: | step up n * 2 |";
  assert.deepEqual(pitches(src), ["62", "64", "66"]);
});

test("repeat can follow the part name on the same line", () => {
  assert.equal(parse("violin: repeat 2: | A4 |").parts[0].loopBars, 2);
});

/* ---------- conditionals ---------- */

test("if … then … else picks bars inside a loop", () => {
  const src = "violin:\n  repeat 4 as n: | A4 | if n is last then | D5 | else | E5 |";
  assert.deepEqual(pitches(src), ["69", "76", "69", "76", "69", "76", "69", "74"]);
});

test("conditions understand even, odd, first, comparisons", () => {
  const src = "violin:\n  repeat 4 as n: if n is even then | B4 | else | A4 |";
  assert.deepEqual(pitches(src), ["69", "71", "69", "71"]);
  assert.deepEqual(pitches("violin:\n  repeat 3 as n: if n > 1 then | B4 | else | A4 |"), ["69", "71", "71"]);
  assert.deepEqual(pitches("violin:\n  repeat 3 as n: if n is first then | B4 |"), ["71"]);
});

test("first and second endings", () => {
  const src = "violin: |: C4 | D4 |1. E4 :|2. G4 |";
  assert.deepEqual(pitches(src), ["60", "62", "64", "60", "62", "67"]);
});

/* ---------- expressions ---------- */

test("evaluates arithmetic with precedence and parentheses", () => {
  const lookup = (n) => ({ n: 3 })[n];
  assert.equal(evalNumber("1 + 2 * 3", lookup, 1), 7);
  assert.equal(evalNumber("(1 + 2) * n", lookup, 1), 9);
  assert.equal(evalNumber("10 / 4", lookup, 1), 2.5);
  assert.equal(evalNumber("-n + 1", lookup, 1), -2);
});

test("folds arithmetic inside modifier words and leaves names alone", () => {
  assert.deepEqual(foldArithmetic(["0.5", "0.25*2", "dotted-eighth"], 1), ["0.5", "0.5", "dotted-eighth"]);
  assert.deepEqual(foldArithmetic(["120", "*", "1.5"], 1), ["180"]);
  assert.deepEqual(foldArithmetic(["-0.5"], 1), ["-0.5"]);
});

test("evaluates conditions against a loop counter", () => {
  const loop = { n: { value: 2, count: 4 } };
  assert.equal(evalCondition("n is even", loop, 1), true);
  assert.equal(evalCondition("n = 3", loop, 1), false);
  assert.equal(evalCondition("n is not last", loop, 1), true);
  assert.equal(evalCondition("n <= 2", loop, 1), true);
});

/* ---------- errors ---------- */

test("helpful errors for the new syntax", () => {
  assert.throws(() => parse("let a4 = pp\nviolin: | A4 |"), /looks like a note/);
  assert.throws(() => parse("let violin = pp\nviolin: | A4 |"), /instrument/);
  assert.throws(() => parse("let loop = | loop |\nviolin: | loop |"), /itself/);
  assert.throws(() => parse("let cell = | C4 |\nviolin: | cell D4 |"), /whole bars/);
  assert.throws(() => parse("violin:\n  repeat 3 as n: | A4 n |"), /counter/);
  assert.throws(() => parse("violin:\n  repeat 3 as n: if n is 2 | A4 |"), /then/);
  assert.throws(() => parse("violin: | A4 |\n  dynamics sotf"), (err) => err instanceof EtudeError);
});
