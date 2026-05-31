// src/tests/milestone-6.spec.js
//
// Milestone 6 acceptance: an 8-row x 8/16-step drum sequencer playing via
// Strudel's pattern path. Clicking cells builds a per-row mini-notation sequence
// (s("bd ~ ~ ~ ...")); changing a row's sound swaps the sample; the 16<->8 toggle
// halves the grid and the loop keeps running.
//
// Drums use the pattern path, so we assert the generated pattern string
// (window.tonus.getLastPattern) plus an audio smoke test via the "live" analyser.
// The audio assertion requires network access (the dirt-samples bank loads from
// GitHub on first play), so give it a generous window.
//
// Run with:  npx playwright test src/tests/milestone-6.spec.js

import { test, expect } from "@playwright/test";

const lastPattern = (page) => page.evaluate(() => window.tonus.getLastPattern());
const isPlaying = (page) => page.evaluate(() => window.tonus.isPlaying());

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

// Click a four-on-the-floor pattern into row 0 (steps 0, 4, 8, 12).
async function fourOnTheFloor(page) {
  for (const j of [0, 4, 8, 12]) {
    await page.locator(`#drum-cell-0-${j}`).click();
  }
}

test("milestone 6: drum grid plays, swaps sounds, and halves to 8 steps", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");

  // Row 0 defaults to bd. Click four kicks, then turn drums on.
  await fourOnTheFloor(page);
  await page.locator("#drums-on").check();

  // The generated pattern is a 16-step bd sequence with hits on the beats.
  await expect
    .poll(() => lastPattern(page))
    .toContain('s("bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~")');
  await expect.poll(() => isPlaying(page)).toBe(true);

  // It actually makes sound (samples load from the network on first play).
  expect(await peakRms(page, 3000)).toBeGreaterThan(0.02);

  // Switch row 0 to open hat (folder "ho" in dirt-samples) -> sample name changes.
  await page.locator("#drum-sound-0").selectOption("ho");
  await expect
    .poll(() => lastPattern(page))
    .toContain('s("ho ~ ~ ~ ho ~ ~ ~ ho ~ ~ ~ ho ~ ~ ~")');

  // Toggle 16 -> 8 steps: grid halves, the later two hits drop, loop keeps going.
  await page.locator("#drum-steps").click();
  await expect.poll(() => page.locator("#drum-steps").textContent()).toBe("8");
  await expect
    .poll(() => lastPattern(page))
    .toContain('s("ho ~ ~ ~ ho ~ ~ ~")');
  await expect.poll(() => isPlaying(page)).toBe(true);

  // Turn drums off -> nothing left in the stack -> scheduler stops.
  await page.locator("#drums-on").uncheck();
  await expect.poll(() => isPlaying(page)).toBe(false);

  expect(errors).toEqual([]);
});
