// src/tests/milestone-2.spec.js
//
// Milestone 2 acceptance test: with the test loop playing, changing the sound
// and dragging the LPF slider re-evaluate the pattern live — the generated
// pattern string reflects the new sound/effect, the scheduler keeps running,
// and nothing throws. (The "is it audibly different" part is confirmed by ear;
// here we verify the full UI -> state -> pattern -> Strudel wiring.)
//
// Run with:  npx playwright test src/tests/milestone-2.spec.js

import { test, expect } from "@playwright/test";

const lastPattern = (page) => page.evaluate(() => window.tonus.getLastPattern());
const playing = (page) => page.evaluate(() => window.tonus.isPlaying());

test("milestone 2: sound + effects change the live pattern", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console.error: " + m.text());
  });

  await page.goto("/");

  // Start the loop.
  await page.locator("#play").click();
  await expect.poll(() => playing(page)).toBe(true);
  await expect.poll(() => lastPattern(page)).toContain('.s("sawtooth")');

  // Switch sound while playing -> pattern updates, still playing.
  await page.locator("#sound").selectOption("triangle");
  await expect.poll(() => lastPattern(page)).toContain('.s("triangle")');
  expect(await playing(page)).toBe(true);

  // Drag LPF down -> pattern reflects the new cutoff.
  await page.locator("#fx-lpf").fill("200");
  await expect.poll(() => lastPattern(page)).toContain(".lpf(200)");
  expect(await playing(page)).toBe(true);

  // Bump gain -> reflected too.
  await page.locator("#fx-gain").fill("0.4");
  await expect.poll(() => lastPattern(page)).toContain(".gain(0.4)");

  // Stop.
  await page.locator("#stop").click();
  await expect.poll(() => playing(page)).toBe(false);

  expect(errors).toEqual([]);
});
