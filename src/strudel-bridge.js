// src/strudel-bridge.js
//
// The ONLY module that imports from @strudel/web. Everything else talks to
// Strudel through these functions, so if the Strudel API shifts we change it
// in one place.
//
// Verified behavior (see NOTES.md, milestones 1 & 3):
//   - initStrudel() resolves to the repl; must run inside a user gesture.
//   - evaluate(code) auto-plays and HOT-SWAPS the running pattern — calling it
//     again with new code replaces what's playing without restarting the clock.
//   - hush() stops the scheduler (the AudioContext stays "running").
//   - superdough(value, t, dur) fires a single fixed-duration voice immediately
//     (~150ms onset), independent of the cyclist scheduler. It returns no stop
//     handle, so "held" live notes are sustained by re-triggering (see keyboard).

import {
  initStrudel,
  evaluate as strudelEvaluate,
  hush,
  getAudioContext,
  superdough,
  getAnalyzerData,
} from "@strudel/web";

let initialized = false;
let repl = null;
let lastPattern = "";

export async function ensureInitialized() {
  if (initialized) return repl;
  repl = await initStrudel();
  // We're called from a user gesture (click or keydown), so resume is allowed.
  await getAudioContext().resume?.();
  initialized = true;
  return repl;
}

// Fire a single live note immediately via superdough. `value` is a control
// object (see buildLiveNoteValue); `durationSec` is the note length. No await on
// the superdough promise — we want it to fire and return.
export async function triggerNote(value, durationSec) {
  await ensureInitialized();
  const ac = getAudioContext();
  // tiny offset so the onset is never scheduled in the past
  superdough(value, ac.currentTime + 0.02, durationSec);
}

// Compile + play (or hot-swap) a pattern string.
export async function play(patternString) {
  await ensureInitialized();
  await strudelEvaluate(patternString);
  lastPattern = patternString;
}

export function stop() {
  if (!initialized) return;
  hush();
}

// Set the global tempo in cycles per second (cps = bpm/240 for 4/4). Live, no
// restart — the running pattern adapts. No-op until initialized.
export function setCps(cps) {
  repl?.setCps(cps);
}

export function getCps() {
  return repl?.scheduler?.cps;
}

export function isInitialized() {
  return initialized;
}

// True while the scheduler is running. The right "is it playing?" signal —
// the AudioContext stays "running" even after hush().
export function isPlaying() {
  return !!repl?.scheduler?.started;
}

// Last pattern string handed to Strudel — used by tests and (later) export.
export function getLastPattern() {
  return lastPattern;
}

export { getAudioContext, getAnalyzerData };
