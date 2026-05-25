// src/tests/milestone-4.spec.js
//
// Milestone 4 acceptance: lower-octave keys play scale-degree chords in the
// selected key. We assert the resolved note names (window.tonus.liveNotesForKey)
// for the Z key (= degree 0 = the I chord) under various settings, then a smoke
// check that pressing Z in chord mode actually produces audio.
//
// Run with:  npx playwright test src/tests/milestone-4.spec.js

import { test, expect } from "@playwright/test";

const Z = "90"; // keyCode for Z = lower-octave degree 0 = I chord
const notes = (page) => page.evaluate((c) => window.tonus.liveNotesForKey(c), Z);

async function peakRms(page, ms) {
  return page.evaluate(async (durationMs) => {
    const rms = (d) => {
      if (!d || !d.length) return 0;
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / d.length);
    };
    let peak = 0;
    const start = performance.now();
    while (performance.now() - start < durationMs) {
      peak = Math.max(peak, rms(window.tonus.getAnalyzerData("time", "live")));
      await new Promise((r) => setTimeout(r, 8));
    }
    return peak;
  }, ms);
}

test("milestone 4: chord mode plays scale-degree chords", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");

  // Chord mode off: Z is just a single note (c4).
  expect(await notes(page)).toEqual(["c4"]);

  // Turn on chord mode. Root defaults to C (0), complexity to triad.
  await page.locator("#chord-mode").check();
  expect(await notes(page)).toEqual(["c4", "e4", "g4"]); // C major

  // Complexity -> 7th gives C major 7.
  await page.locator("#chord-complexity").selectOption("1");
  expect(await notes(page)).toEqual(["c4", "e4", "g4", "b4"]);

  // Bass on adds the root one octave down.
  await page.locator("#chord-bass").check();
  expect(await notes(page)).toEqual(["c3", "c4", "e4", "g4", "b4"]);

  // Change root to D -> the I chord transposes (D major 7, with bass).
  await page.locator("#chord-root").selectOption("2");
  expect(await notes(page)).toEqual(["d3", "d4", "f#4", "a4", "c#5"]);

  // Audio smoke: pressing Z in chord mode produces sound; release -> silence.
  await page.keyboard.down("z");
  expect(await peakRms(page, 400)).toBeGreaterThan(0.02);
  await page.keyboard.up("z");
  await page.waitForTimeout(450);
  expect(await peakRms(page, 300)).toBeLessThan(0.02);

  expect(errors).toEqual([]);
});
