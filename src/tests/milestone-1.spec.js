// src/tests/milestone-1.spec.js
//
// Milestone 1 acceptance test: the page loads, the play/stop buttons work,
// Strudel actually starts and stops playback, and nothing throws.
//
// "Did audio literally come out of the speakers" can't be asserted headlessly,
// so we check the next-best observable signals (verified by hand in NOTES.md):
//   - after PLAY:  the AudioContext is "running" and the scheduler is started
//   - after STOP:  the scheduler is no longer started
//   - no console errors or page errors fire during the flow
//
// main.js exposes testing hooks under window.tonus:
//   window.tonus.getAudioContext() -> the live AudioContext
//   window.tonus.isPlaying()       -> repl.scheduler.started (boolean)
//
// Run with:  npx playwright test src/tests/milestone-1.spec.js

import { test, expect } from "@playwright/test";

test("milestone 1: page loads, buttons work, strudel plays and stops", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console.error: " + msg.text());
  });

  await page.goto("/");

  await expect(page.locator("#play")).toBeVisible();
  await expect(page.locator("#stop")).toBeVisible();

  // Play: scheduler should start and the AudioContext should be running.
  await page.locator("#play").click();
  await expect.poll(() => page.evaluate(() => window.tonus?.isPlaying())).toBe(true);

  const ctxState = await page.evaluate(
    () => window.tonus?.getAudioContext().state,
  );
  expect(ctxState).toBe("running");

  // Stop: scheduler should no longer be started.
  await page.locator("#stop").click();
  await expect.poll(() => page.evaluate(() => window.tonus?.isPlaying())).toBe(false);

  expect(errors).toEqual([]);
});
