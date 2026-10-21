import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../etude/parser.js";
import {
  recordingToEtude, drumsToEtude, fxToEtude, instrumentFor, dynamicName, toneName, hallName, noteValueName, seatName,
} from "../etude/tonus-bridge.js";

const FX = { gain: 0.52, lpf: 900, attack: 0.09, decay: 0.2, sustain: 0.9, release: 0.35, room: 0, delay: 0, delaytime: 0.25, pan: 0.5 };

test("quarter notes at 120 bpm become a four-note bar", () => {
  const beat = 0.5;
  const events = [0, 2, 4, 7].map((s, i) => ({ kind: "note", notes: [s], tRel: i * beat, dur: beat }));
  const part = recordingToEtude(events, { bpm: 120, instrument: "violin" });
  assert.equal(part, "violin: | C4 D4 E4 G4 |");
  assert.equal(parse(part).parts[0].events.length, 4);
});

test("long notes become ties and gaps become rests", () => {
  const events = [
    { kind: "note", notes: [9], tRel: 0, dur: 1.5 },
    { kind: "note", notes: [12], tRel: 1.5, dur: 0.25 },
  ];
  const part = recordingToEtude(events, { bpm: 120, instrument: "cello" });
  const ev = parse(part).parts[0].events;
  assert.equal(ev.length, 2);
  assert.equal(ev[0].dur, 3);
  assert.equal(ev[1].beat, 3);
});

test("chords join with + and repeated bars use simile", () => {
  const bar = 2; // one bar at 120 bpm
  const events = [0, 1].map((i) => ({ kind: "chord", notes: [0, 4, 7], tRel: i * bar, dur: bar }));
  const part = recordingToEtude(events, { bpm: 120, instrument: "piano" });
  assert.equal(part, "piano: | C4+E4+G4 | % |");
});

test("arpeggios expand into separate notes", () => {
  const part = recordingToEtude([{ kind: "arp", notes: [0, 4, 7], tRel: 0, dur: 0.5, rateHz: 8 }], { bpm: 120, instrument: "harp" });
  assert.deepEqual(parse(part).parts[0].events.map((e) => e.pitches[0]), [60, 64, 67, 60]);
});

test("slider snapshot becomes étude modifiers", () => {
  const lines = fxToEtude({ ...FX, room: 0.7, delay: 0.4, delaytime: 0.25, pan: 0.1 }, 120);
  assert.deepEqual(lines, ["dynamics mf", "tone tasto", "bowing legato", "hall concert", "echo 0.4 eighth", "seat left"]);
});

test("a plucked envelope reads as pizz", () => {
  assert.equal(fxToEtude({ ...FX, attack: 0.001, decay: 0.3, sustain: 0, release: 0.28 }, 120)[2], "bowing pizz");
});

test("unusual envelopes are written out in full", () => {
  const lines = fxToEtude({ ...FX, attack: 1.5, sustain: 0.1 }, 120);
  assert.match(lines[2], /^bowing attack 1\.5 decay 0\.2 sustain 0\.1 release 0\.35$/);
});

test("drum grid becomes a drums part at its simplest division", () => {
  const codes = ["bd", "sd", "hh"];
  const grid = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  ];
  const part = drumsToEtude(grid, codes);
  assert.equal(part, "drums: | kick+hat hat kick+snare+hat hat kick+hat hat kick+snare+hat hat |");
  assert.equal(parse(part).parts[0].events.length, 8);
});

test("names slider values in étude words", () => {
  assert.equal(instrumentFor("gm_violin"), "violin");
  assert.equal(instrumentFor("cello"), "cello");
  assert.equal(dynamicName(0.8), "ff");
  assert.equal(toneName(7000), "ponticello");
  assert.equal(hallName(0), null);
  assert.equal(hallName(0.95), "cathedral");
  assert.equal(noteValueName(0.25, 120), "eighth");
  assert.equal(seatName(1), "right");
});
