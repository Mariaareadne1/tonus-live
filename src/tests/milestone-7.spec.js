// src/tests/milestone-7.spec.js
//
// Milestone 7: recording + quantization + layers, plus the v2 fixes —
//   BUG 1: the metronome is a Strudel pattern (shares the master clock with
//          layers, so they stay in sync).
//   BUG 2: arp segments encode the recorded arp RATE as a subdivided note
//          sequence, so they play back at the speed they were performed.
//   BUG 3: the drum grid is snapshotted into the finalized layer.
//
// Timing is driven by a FAKE clock in BEATS (window.tonus._setClock) so the
// snapping runs on exact positions through the real press -> hook -> compile path,
// deterministically (real wall-clock / audio-clock timing is too noisy to assert
// beat counts against).
//
// Run with:  npx playwright test src/tests/milestone-7.spec.js

import { test, expect } from "@playwright/test";

const lastPattern = (page) => page.evaluate(() => window.tonus.getLastPattern());
const isPlaying = (page) => page.evaluate(() => window.tonus.isPlaying());
const layers = (page) => page.evaluate(() => window.tonus.state.layers);

// Install a fake clock the recorder reads, measured in BEATS (window.__beat).
const installClock = (page) =>
  page.evaluate(() => {
    window.__beat = 0;
    window.tonus._setClock(() => window.__beat);
  });
const setBeat = (page, b) => page.evaluate((x) => (window.__beat = x), b);

// Press a key at fromBeat, release at toBeat (on the fake clock).
async function playNote(page, key, fromBeat, toBeat) {
  await setBeat(page, fromBeat);
  await page.keyboard.down(key);
  await setBeat(page, toBeat);
  await page.keyboard.up(key);
}

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

test("milestone 7: quantized recording finalizes to looping layers", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await installClock(page);

  // --- Layer 1: a chord progression (Z=C major, X=D minor), 2 beats each ---
  await page.locator("#chord-mode").check();
  await page.locator("#arm").click();
  await expect.poll(() => page.locator("#rec-dot").getAttribute("class")).toContain("on");

  await playNote(page, "z", 0, 2); // C major block, beats 0..2
  await playNote(page, "x", 2, 4); // D minor block, beats 2..4
  await page.locator("#finalize").click();

  await expect.poll(() => layers(page)).toHaveLength(1);
  const code1 = (await layers(page))[0].code;
  expect(code1).toContain('note("[c4,e4,g4]@2 [d4,f4,a4]@2")'); // clean @2 weights
  expect(code1).not.toMatch(/@\d+\.\d/); // no fractional weights

  await expect.poll(() => isPlaying(page)).toBe(true);
  expect(await peakRms(page, 1600)).toBeGreaterThan(0.02);

  // --- Layer 2: a melody, recorded over the looping layer 1 ---
  await page.locator("#chord-mode").uncheck();
  await page.locator("#arm").click();
  await playNote(page, "q", 0, 2); // c5
  await playNote(page, "w", 2, 4); // d5
  await page.locator("#finalize").click();

  await expect.poll(() => layers(page)).toHaveLength(2);
  expect((await layers(page))[1].code).toContain('note("c5@2 d5@2")');

  const stacked = await lastPattern(page);
  expect(stacked).toContain("[c4,e4,g4]@2");
  expect(stacked).toContain("c5@2");
  expect(stacked).toContain("stack(");
  await expect.poll(() => isPlaying(page)).toBe(true);

  // --- Per-layer mute and delete ---
  await page.locator("#layer-mute-1").click();
  await expect.poll(() => lastPattern(page)).not.toContain("[c4,e4,g4]@2");
  await expect.poll(() => lastPattern(page)).toContain("c5@2");

  await page.locator("#layer-del-2").click();
  await expect.poll(() => layers(page)).toHaveLength(1);
  await expect.poll(() => isPlaying(page)).toBe(false);

  expect(errors).toEqual([]);
});

test("milestone 7 (BUG 2): arp segments encode the recorded rate as a sequence", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await installClock(page);
  await page.locator("#chord-mode").check();
  await page.locator("#arp-on").check();

  // Default arp rate = 1/8 (2 steps/beat). A 2-beat C-major hold -> 4 arp steps
  // cycling the triad, sequenced (spaces), NOT a block chord and NOT .arp().
  await page.locator("#arm").click();
  await playNote(page, "z", 0, 2);
  await page.locator("#finalize").click();

  const eighth = (await layers(page))[0].code;
  expect(eighth).toContain('note("[c4 e4 g4 c4]'); // 4 steps over 2 beats = 1/8
  expect(eighth).not.toContain(".arp(");
  expect(eighth).not.toContain("[c4,e4,g4]"); // not a block chord

  // Switch to 1/16 (4 steps/beat). Same 2-beat hold -> 8 arp steps: faster.
  await page.evaluate(() => (window.tonus.state.layers.length = 0));
  await page.locator("#arp-rate").fill("4"); // index 4 == 1/16
  await page.locator("#arm").click();
  await playNote(page, "z", 0, 2);
  await page.locator("#finalize").click();

  const sixteenth = (await layers(page))[0].code;
  expect(sixteenth).toContain('note("[c4 e4 g4 c4 e4 g4 c4 e4]'); // 8 steps over 2 beats

  expect(errors).toEqual([]);
});

test("milestone 7: a take that switches arp mid-record mixes block + arp in one loop", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await installClock(page);
  await page.locator("#chord-mode").check();

  await page.locator("#arm").click();
  await playNote(page, "z", 0, 2); // arp OFF -> block chord
  await page.locator("#arp-on").check(); // flip arp ON between segments
  await playNote(page, "x", 2, 4); // arp ON -> sequenced (1/8 -> 4 steps)
  await page.locator("#finalize").click();

  const code = (await layers(page))[0].code;
  expect(code).toContain("[c4,e4,g4]@2"); // block segment (commas)
  expect(code).toContain("[d4 f4 a4 d4]@2"); // arp segment (spaces, at rate)
  expect(code).toContain('note("[c4,e4,g4]@2 [d4 f4 a4 d4]@2")'); // one sequence

  expect(errors).toEqual([]);
});

test("milestone 7 (BUG 1): metronome is a cycle-aligned Strudel pattern", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");

  // Toggling it on puts the click pattern into the stack on the master clock.
  await page.locator("#metronome").check();
  await expect.poll(() => lastPattern(page)).toContain('note("c6 c5 c5 c5")');
  await expect.poll(() => isPlaying(page)).toBe(true);
  expect(await peakRms(page, 1500)).toBeGreaterThan(0.01); // audible

  // Off -> removed; nothing else playing -> scheduler stops.
  await page.locator("#metronome").uncheck();
  await expect.poll(() => isPlaying(page)).toBe(false);

  expect(errors).toEqual([]);
});

test("milestone 7 (BUG 3): the drum grid is captured into the finalized layer", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");

  // Four-on-the-floor kick on row 0, drums on.
  for (const j of [0, 4, 8, 12]) await page.locator(`#drum-cell-0-${j}`).click();
  await page.locator("#drums-on").check();

  // Record a single note while the drums play, then finalize.
  await installClock(page);
  await page.locator("#arm").click();
  await playNote(page, "z", 0, 2); // c4 (chord mode off)
  await page.locator("#finalize").click();

  const code = (await layers(page))[0].code;
  expect(code).toContain("stack("); // notes + drums stacked
  expect(code).toContain('s("bd'); // drum snapshot included
  expect(code).toContain("c4"); // recorded note included
  await expect.poll(() => isPlaying(page)).toBe(true);

  expect(errors).toEqual([]);
});

test("milestone 7: 'clear grid on finalize' wipes the grid (default) or keeps it (opt-out)", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  const rows = () => page.evaluate(() => window.tonus.state.drums.rows.map((r) => r.steps));
  const cellClass = (i, j) => page.locator(`#drum-cell-${i}-${j}`).getAttribute("class");
  const drumHits = async () => ((await lastPattern(page)).match(/s\("bd/g) || []).length;

  await page.goto("/");
  await installClock(page);

  // --- Default ON: finalize wipes the grid, so the baked drums don't double ---
  for (const j of [0, 4, 8, 12]) await page.locator(`#drum-cell-0-${j}`).click();
  await page.locator("#drums-on").check();
  await page.locator("#arm").click();
  await playNote(page, "z", 0, 2);
  await page.locator("#finalize").click();

  expect((await layers(page))[0].code).toContain('s("bd'); // captured into the layer
  await expect.poll(() => cellClass(0, 0)).not.toContain("on"); // grid wiped
  expect((await rows())[0].every((s) => s === false)).toBe(true);
  // drums appear exactly once (only in the layer; live grid is now empty)
  await expect.poll(drumHits).toBe(1);

  // --- Opt-out: turn it off, and the grid survives finalize ---
  await page.locator("#clear-drums").uncheck();
  for (const j of [0, 8]) await page.locator(`#drum-cell-0-${j}`).click();
  await page.locator("#arm").click();
  await playNote(page, "x", 0, 2);
  await page.locator("#finalize").click();

  await expect.poll(() => cellClass(0, 0)).toContain("on"); // grid preserved
  expect((await rows())[0][0]).toBe(true);

  expect(errors).toEqual([]);
});
