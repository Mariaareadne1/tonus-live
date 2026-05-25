// src/tests/milestone-3.spec.js
//
// Milestone 3 acceptance: typing plays notes; multiple held keys are polyphonic;
// releasing one key leaves the others sounding; releasing all -> silence.
//
// We measure actual audio via the "live" analyser the keyboard routes notes
// through (window.tonus.getAnalyzerData). Held notes are re-triggered, so RMS
// pulses — we sample the MAX over a short window to ask "is sound present?".
//
// Run with:  npx playwright test src/tests/milestone-3.spec.js

import { test, expect } from "@playwright/test";

// Max RMS on the "live" analyser over `ms` (held notes pulse, so use the peak).
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

const held = (page) => page.evaluate(() => window.tonus.heldKeys());

test("milestone 3: live keyboard plays, is polyphonic, and releases", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");

  // Press Z (c4). Should register as held and produce sound.
  await page.keyboard.down("z");
  await expect.poll(() => held(page)).toContain("90");
  expect(await peakRms(page, 400)).toBeGreaterThan(0.02);

  // Also press X (d4) -> two keys held, still sounding (polyphony).
  await page.keyboard.down("x");
  await expect.poll(() => held(page)).toEqual(expect.arrayContaining(["90", "88"]));
  expect(await peakRms(page, 400)).toBeGreaterThan(0.02);

  // Release Z -> X remains held and audible ("two remain" / one remains here).
  await page.keyboard.up("z");
  await expect.poll(() => held(page)).toEqual(["88"]);
  expect(await peakRms(page, 400)).toBeGreaterThan(0.02);

  // Release X -> nothing held; sound dies out to silence.
  await page.keyboard.up("x");
  await expect.poll(() => held(page)).toEqual([]);
  await page.waitForTimeout(450); // let the last note's release tail finish
  expect(await peakRms(page, 300)).toBeLessThan(0.02);

  expect(errors).toEqual([]);
});
