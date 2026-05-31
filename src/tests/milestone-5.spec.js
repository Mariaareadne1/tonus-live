// src/tests/milestone-5.spec.js
//
// Milestone 5 acceptance: holding a chord with arp on plays its notes in
// sequence at the chosen rate; raising BPM speeds a synced arp up; a non-synced
// arp keeps its absolute rate regardless of BPM.
//
// The arp uses the pattern path, so we can assert the generated pattern string
// (window.tonus.getLastPattern) AND the global tempo (getCps), plus an audio
// smoke test via the "live" analyser.
//
// Run with:  npx playwright test src/tests/milestone-5.spec.js

import { test, expect } from "@playwright/test";

const lastPattern = (page) => page.evaluate(() => window.tonus.getLastPattern());
const isPlaying = (page) => page.evaluate(() => window.tonus.isPlaying());
const cps = (page) => page.evaluate(() => window.tonus.getCps());

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

test("milestone 5: synced arp sequences a held chord and tracks BPM", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await page.locator("#chord-mode").check(); // Z -> C major chord
  await page.locator("#arp-on").check(); // arp on; sync + 1/8 are defaults; bpm 120

  // Hold Z: arp sequences C major at 1/8. fast = spc/len = 8/3 = 2.6667.
  await page.keyboard.down("z");
  await expect.poll(() => lastPattern(page)).toContain('note("c4 e4 g4")');
  expect(await lastPattern(page)).toContain(".fast(2.6667)");
  await expect.poll(() => isPlaying(page)).toBe(true);

  // It actually makes sound.
  expect(await peakRms(page, 1600)).toBeGreaterThan(0.02);

  // Drag BPM 120 -> 240: cps doubles (arp speeds up). fast unchanged for sync.
  await page.locator("#bpm").fill("240");
  await expect.poll(() => cps(page)).toBe(1);
  expect(await lastPattern(page)).toContain(".fast(2.6667)");

  // Release -> nothing left to play -> stop.
  await page.keyboard.up("z");
  await expect.poll(() => isPlaying(page)).toBe(false);

  expect(errors).toEqual([]);
});

test("milestone 5: non-synced arp rate is BPM-independent", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await page.locator("#chord-mode").check();
  await page.locator("#arp-on").check();
  await page.locator("#arp-sync").uncheck();
  await page.locator("#arp-rate").fill("4"); // free: 8 Hz

  // bpm 120 -> cps 0.5 -> fast = hz/(len*cps) = 8/(3*0.5) = 5.3333
  await page.keyboard.down("z");
  await expect.poll(() => lastPattern(page)).toContain(".fast(5.3333)");

  // bpm 240 -> cps 1 -> fast = 8/(3*1) = 2.6667, so the rate stays 8 Hz.
  await page.locator("#bpm").fill("240");
  await expect.poll(() => lastPattern(page)).toContain(".fast(2.6667)");

  await page.keyboard.up("z");
  expect(errors).toEqual([]);
});
