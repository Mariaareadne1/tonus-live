import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../etude/parser.js";
import { toStrudel, strudelUrl, replUrl, fromBase64 } from "../etude/to-strudel.js";

const translate = (src) => toStrudel(parse(src));

test("one bar per cycle, tempo as cycles per minute", () => {
  const out = translate("tempo 120\nviolin: | A4 B4 C#5 D5 |");
  assert.match(out, /setcpm\(30\)/);
  assert.match(out, /\$: note\("a4 b4 c#5 d5"\)/);
  assert.match(out, /\.s\("gm_violin"\)/);
});

test("several bars become <…> alternation, ties become _", () => {
  const out = translate("violin: | A4 B4 | C5 - - D5 |");
  assert.match(out, /note\("<\[a4 b4\] \[c5 _ _ d5\]>"\)/);
});

test("beamed groups and rests use the finest grid needed", () => {
  const out = translate("bass: | (C2 C3) r D2 r |");
  assert.match(out, /note\("c2 c3 ~ ~ d2 _ ~ ~"\)/);
});

test("double stops become chords; flats follow the key", () => {
  const out = translate("key D minor\nviolin: | D4+B4 |");
  assert.match(out, /note\("\[d4,bb4\]"\)/);
});

test("drums map to Strudel sample names", () => {
  const out = translate("drums: | kick kick+snare hat r |");
  assert.match(out, /\$: s\("bd \[bd,sd\] hh ~"\)/);
});

test("ties across bar lines fall back to weighted steps", () => {
  const out = translate("cello: | C3 C3 C3 C3 | - - D3 D3 |");
  assert.match(out, /note\("\[c3 c3 c3 c3@3 d3 d3\]\/2"\)/);
});

test("per-note dynamics line up with the notes", () => {
  const out = translate("drums: | hat*4 |\n  dynamics pp f");
  assert.match(out, /\.velocity\("0\.15 0\.68 0\.15 0\.68"\)/);
});

test("hairpins become saw and tri signals", () => {
  assert.match(translate("drums: | hat*4 |\n  dynamics pp < ff"), /\.velocity\(saw\.range\(0\.15, 0\.84\)\)/);
  assert.match(translate("violin: | A4 | B4 |\n  tone tasto < ponticello > tasto over 8"), /\.lpf\(tri\.rangex\(900, 7500\)\.slow\(8\)\)/);
});

test("effects map to Strudel controls", () => {
  const out = translate("tempo 120\nviolin: | A4 |\n  echo 0.5 eighth 0.6\n  hall concert\n  seat left\n  speed half\n  tacet");
  assert.match(out, /\.delay\(0\.5\)\.delaytime\(0\.25\)\.delayfeedback\(0\.6\)/);
  assert.match(out, /\.room\(0\.4\)\.roomsize\(3\.4\)/);
  assert.match(out, /\.pan\(0\.1\)/);
  assert.match(out, /\.slow\(2\)/);
  assert.match(out, /\.hush\(\)/);
});

test("pizzicato switches to the pizzicato strings sound", () => {
  assert.match(translate("violin: | A4 |\n  bowing pizz"), /\.s\("gm_pizzicato_strings"\)/);
});

test("share links round-trip unicode code", () => {
  const code = "// étude ♯\nviolin: | A4 |";
  const hash = strudelUrl(code).split("#")[1];
  assert.equal(fromBase64(decodeURIComponent(hash)), code);
  assert.match(replUrl(code), /^repl\.html#code=/);
});
