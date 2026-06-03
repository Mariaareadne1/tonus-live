// src/tests/milestone-8.spec.js
//
// Milestone 8 acceptance: build a few layers (+ drums), export, and get a
// standalone Strudel program that runs verbatim in strudel.cc and sounds the
// same. We can't drive strudel.cc from here, but our bridge IS Strudel — so the
// strongest automatable proxy is to EVALUATE the exported code through Strudel and
// confirm it plays with no errors. Plus: readable comments, copy, and download.
//
// Recording uses the fake beat clock (window.tonus._setClock) for determinism.
//
// Run with:  npx playwright test src/tests/milestone-8.spec.js

import { test, expect } from "@playwright/test";

const isPlaying = (page) => page.evaluate(() => window.tonus.isPlaying());
const exportCode = (page) => page.evaluate(() => window.tonus.exportCode());

const installClock = (page) =>
  page.evaluate(() => {
    window.__beat = 0;
    window.tonus._setClock(() => window.__beat);
  });
const setBeat = (page, b) => page.evaluate((x) => (window.__beat = x), b);

async function playNote(page, key, fromBeat, toBeat) {
  await setBeat(page, fromBeat);
  await page.keyboard.down(key);
  await setBeat(page, toBeat);
  await page.keyboard.up(key);
}

// Record one finalized layer; `setup` runs after arm, before the notes.
async function recordLayer(page, notes) {
  await page.locator("#arm").click();
  for (const [key, from, to] of notes) await playNote(page, key, from, to);
  await page.locator("#finalize").click();
}

test("milestone 8: export produces standalone, runnable Strudel for all layers + drums", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await installClock(page);

  // Layer 1: chord progression. Layer 2: melody. Then a four-on-the-floor kick.
  await page.locator("#chord-mode").check();
  await recordLayer(page, [
    ["z", 0, 2],
    ["x", 2, 4],
  ]);
  await page.locator("#chord-mode").uncheck();
  await recordLayer(page, [
    ["q", 0, 2],
    ["w", 2, 4],
  ]);
  for (const j of [0, 4, 8, 12]) await page.locator(`#drum-cell-0-${j}`).click();
  await page.locator("#drums-on").check();

  // --- The exported program ---
  const code = await exportCode(page);

  // tempo + structure
  expect(code).toContain("setcps(120/240)"); // exact bpm -> cps, our 1-bar-per-cycle
  expect(code).toContain("stack(");
  // readable comments
  expect(code).toContain("// layer 1");
  expect(code).toContain("// layer 2");
  expect(code).toContain("// drums");
  // content of each part
  expect(code).toContain('note("[c4,e4,g4]@2 [d4,f4,a4]@2")');
  expect(code).toContain('note("c5@2 d5@2")');
  expect(code).toContain('s("bd');
  // self-contained: loads the drum bank so strudel.cc has the samples
  expect(code).toContain("samples('github:tidalcycles/dirt-samples')");
  // tonus-internal analyser routing stripped for portability
  expect(code).not.toContain(".analyze(");
  // guides are not part of the song
  expect(code).not.toContain('note("c6 c5 c5 c5")'); // metronome excluded

  // the panel mirrors it
  expect(await page.locator("#export-code").inputValue()).toBe(code);

  // --- Copy to clipboard ---
  await page.locator("#export-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // --- Download as .js ---
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-download").click(),
  ]);
  expect(download.suggestedFilename()).toBe("tonus.js");

  // --- The real test: the exported code RUNS in Strudel (proxy for strudel.cc) ---
  await page.evaluate((c) => window.tonus._eval(c), code);
  await expect.poll(() => isPlaying(page)).toBe(true);
  expect(errors).toEqual([]); // no eval / page / console errors

  expect(errors).toEqual([]);
});

test("milestone 8: muting a layer drops it from the export", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await installClock(page);

  await page.locator("#chord-mode").check();
  await recordLayer(page, [["z", 0, 2]]); // layer 1: C major
  await page.locator("#chord-mode").uncheck();
  await recordLayer(page, [["q", 0, 2]]); // layer 2: c5

  expect(await exportCode(page)).toContain("c5"); // both present
  expect(await exportCode(page)).toContain("[c4,e4,g4]");

  await page.locator("#layer-mute-2").click(); // mute layer 2
  const code = await exportCode(page);
  expect(code).toContain("[c4,e4,g4]"); // layer 1 stays
  expect(code).not.toContain("c5"); // muted layer 2 gone
  expect(code).not.toContain("// layer 2");

  expect(errors).toEqual([]);
});
