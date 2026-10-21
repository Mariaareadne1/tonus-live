import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, valueAt, EtudeError } from "../etude/parser.js";

const notesOf = (part) => part.events.map((e) => e.pitches);

test("splits a bar evenly between its notes", () => {
  const { parts } = parse("violin: | A4 B4 C#5 D5 |");
  assert.deepEqual(notesOf(parts[0]), [[69], [71], [73], [74]]);
  assert.deepEqual(parts[0].events.map((e) => e.beat), [0, 1, 2, 3]);
  assert.equal(parts[0].loopBeats, 4);
});

test("defaults to octave 4 and understands flats, sharps and unicode accidentals", () => {
  const { parts } = parse("violin: | C Bb3 F♯4 E♭5 |");
  assert.deepEqual(notesOf(parts[0]), [[60], [58], [66], [75]]);
});

test("ties hold the previous note and rests leave silence", () => {
  const { parts } = parse("cello: | G2 - - r | - D3 |");
  const [first, second] = parts[0].events;
  assert.equal(first.dur, 3);
  assert.equal(parts[0].events.length, 2);
  assert.equal(second.beat, 6);
  assert.equal(second.dur, 2);
});

test("ties carry across bar lines", () => {
  const { parts } = parse("violin: | A4 B4 C5 D5 | - - E5 F5 |");
  assert.equal(parts[0].events[3].dur, 3);
});

test("beamed groups share one beat and *N repeats", () => {
  const { parts } = parse("bass: | (C2 C3)*4 |");
  const beats = parts[0].events.map((e) => e.beat);
  assert.deepEqual(beats, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.equal(parts[0].events[0].dur, 0.5);
});

test("double stops sound together", () => {
  const { parts } = parse("violin: | D4+A4 G3+D4 |");
  assert.deepEqual(notesOf(parts[0]), [[62, 69], [55, 62]]);
});

test("repeat signs play the passage twice, or as many times as xN says", () => {
  const twice = parse("violin: |: A4 :| B4 |").parts[0];
  assert.deepEqual(notesOf(twice), [[69], [69], [71]]);
  const thrice = parse("violin: |: A4 B4 :| x3").parts[0];
  assert.equal(thrice.events.length, 6);
});

test("% repeats the previous bar (simile)", () => {
  const { parts } = parse("violin: | A4 B4 | % |");
  assert.deepEqual(notesOf(parts[0]), [[69], [71], [69], [71]]);
  assert.equal(parts[0].loopBars, 2);
});

test("key signatures apply to unmarked notes; n cancels them", () => {
  const { parts } = parse("key D major\nviolin: | F4 C5 Fn4 |");
  assert.deepEqual(notesOf(parts[0]), [[66], [73], [65]]);
  const minor = parse("key D minor\nviolin: | B4 |").parts[0];
  assert.deepEqual(notesOf(minor), [[70]]);
});

test("time signature sets beats per bar and tempo marks set the tempo", () => {
  const program = parse("tempo Allegro\ntime 3/4\nviolin: | A4 B4 C5 |");
  assert.equal(program.tempo, 132);
  assert.equal(program.beatsPerBar, 3);
  assert.equal(program.parts[0].loopBeats, 3);
});

test("scores may continue on lines that start with a bar line", () => {
  const { parts } = parse("violin: | A4 |\n        | B4 |");
  assert.equal(parts[0].loopBars, 2);
});

test("drum parts take drum names", () => {
  const { parts } = parse("drums: | kick hat snare+hat hat |");
  assert.deepEqual(parts[0].events[2].drums, ["snare", "hat"]);
});

test("records the source range of every note for highlighting", () => {
  const src = "violin: | A4 B4 |";
  const ev = parse(src).parts[0].events[1];
  assert.equal(src.slice(ev.range[0], ev.range[1]), "B4");
});

test("plain value lists cycle note by note", () => {
  const part = parse("drums: | hat*4 |\n  dynamics pp f").parts[0];
  const values = [0, 1, 2, 3].map((i) => valueAt(part.mods.dynamics, { noteIndex: i }));
  assert.deepEqual(values, [0.15, 0.68, 0.15, 0.68]);
});

test("barred value lists change once per bar", () => {
  const part = parse("violin: | A4 | B4 |\n  tone | tasto | ponticello |").parts[0];
  assert.equal(valueAt(part.mods.tone, { barIndex: 0 }), 900);
  assert.equal(valueAt(part.mods.tone, { barIndex: 1 }), 7500);
  assert.equal(valueAt(part.mods.tone, { barIndex: 2 }), 900);
});

test("hairpins ramp smoothly across the loop", () => {
  const part = parse("drums: | hat*4 |\n  dynamics p < f").parts[0];
  const ctx = (beat) => ({ beat, spanBeats: part.loopBeats });
  assert.equal(valueAt(part.mods.dynamics, ctx(0)), 0.25);
  assert.ok(Math.abs(valueAt(part.mods.dynamics, ctx(2)) - 0.465) < 1e-9);
});

test("over N stretches a hairpin across N bars", () => {
  const part = parse("violin: | A4 |\n  dynamics p < f over 4").parts[0];
  assert.equal(part.mods.dynamics.spanBars, 4);
});

test("bowing takes stroke names or a hand-made envelope", () => {
  const named = parse("violin: | A4 |\n  bowing staccato").parts[0];
  assert.equal(valueAt(named.mods.bowing, { noteIndex: 0 }).length, 0.45);
  const custom = parse("violin: | A4 |\n  bowing attack 0.5 sustain 1").parts[0];
  const env = valueAt(custom.mods.bowing, { noteIndex: 0 });
  assert.equal(env.attack, 0.5);
  assert.equal(env.sustain, 1);
  assert.equal(env.release, 0.12);
});

test("echo reads amount, note value and feedback", () => {
  const part = parse("harp: | A4 |\n  echo 0.8 sixteenth 0.7").parts[0];
  assert.deepEqual(part.mods.echo, { amount: 0.8, beats: 0.25, feedback: 0.7 });
});

test("hall, seat, speed and tacet", () => {
  const part = parse("violin: | A4 |\n  hall cathedral\n  seat left\n  speed half\n  tacet").parts[0];
  assert.equal(part.mods.hall, 6);
  assert.equal(valueAt(part.mods.seat, { noteIndex: 0 }), -0.8);
  assert.equal(part.speed, 0.5);
  assert.equal(part.tacet, true);
});

test("comments are ignored", () => {
  const { parts } = parse("// warm-up\nviolin: | A4 | // open string");
  assert.equal(parts[0].events.length, 1);
});

test("errors name the line and suggest the nearest word", () => {
  assert.throws(() => parse("violin: | A4 |\n  dynamic p"), (err) => {
    assert.ok(err instanceof EtudeError);
    assert.equal(err.line, 2);
    assert.match(err.message, /dynamics/);
    return true;
  });
  assert.throws(() => parse("violn: | A4 |"), /violin/);
  assert.throws(() => parse("violin: | H4 |"), /H4/);
  assert.throws(() => parse("violin: | kick |"), /drums/);
  assert.throws(() => parse("  dynamics p"), /part/);
  assert.throws(() => parse("violin:"), /no notes/);
});
