// src/strudel-bridge.js
//
// The ONLY module that imports from @strudel/web. Everything else talks to
// Strudel through these functions, so if the Strudel API shifts we change it
// in one place.
//
// Verified behavior (see NOTES.md, milestone 1):
//   - initStrudel() resolves to the repl; must run inside a user gesture.
//   - evaluate(code) auto-plays and HOT-SWAPS the running pattern — calling it
//     again with new code replaces what's playing without restarting the clock.
//   - hush() stops the scheduler (the AudioContext stays "running").

import {
  initStrudel,
  evaluate as strudelEvaluate,
  hush,
  getAudioContext,
} from "@strudel/web";

let initialized = false;
let repl = null;
let lastPattern = "";

export async function ensureInitialized() {
  if (initialized) return repl;
  repl = await initStrudel();
  initialized = true;
  return repl;
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

export { getAudioContext };
