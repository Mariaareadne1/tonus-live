// src/ui/keyboard.js
//
// Computer keyboard -> live note playback.
//
// Why this design (measured in milestone 3, see NOTES.md): re-evaluating a
// Strudel pattern on each keypress has 0.5-2s onset latency (cycle-quantized) —
// unplayable. Firing superdough directly is ~150ms — playable. But superdough
// gives no note-off handle, so to make a key SUSTAIN while held and STOP on
// release, each held key re-triggers a short note on an interval; key-up clears
// that key's interval. This is what "each key independently scheduled" means.
//
// Live notes read state.fx at every trigger, so dragging effect sliders changes
// the sound of held notes in near-real-time.

import { state } from "../state.js";
import { keyToSemitone } from "../lib/keymap.js";
import { buildLiveNoteValue } from "../lib/pattern-builder.js";
import * as bridge from "../strudel-bridge.js";

// Re-trigger period and per-note duration (slightly longer, so notes overlap
// into a continuous-ish sustain). Tunable by ear.
const RETRIGGER_MS = 150;
const NOTE_DUR_S = 0.22;

const timers = new Map(); // keyCode -> setInterval id

function triggerKey(keyCode) {
  const semitone = keyToSemitone(keyCode, state.octaveShift);
  if (semitone == null) return;
  bridge.triggerNote(buildLiveNoteValue(semitone), NOTE_DUR_S).catch(() => {});
}

export function initKeyboard() {
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const code = String(e.keyCode);
    if (keyToSemitone(code) == null) return; // not a mapped musical key
    if (state.heldKeys.has(code)) return; // already held
    state.heldKeys.add(code);
    triggerKey(code); // immediate attack
    timers.set(code, setInterval(() => triggerKey(code), RETRIGGER_MS));
  });

  window.addEventListener("keyup", (e) => {
    const code = String(e.keyCode);
    if (!state.heldKeys.has(code)) return;
    state.heldKeys.delete(code);
    const id = timers.get(code);
    if (id != null) {
      clearInterval(id);
      timers.delete(code);
    }
  });

  // Safety: if focus leaves the window mid-hold, release everything so notes
  // don't get stuck re-triggering forever.
  window.addEventListener("blur", () => {
    for (const id of timers.values()) clearInterval(id);
    timers.clear();
    state.heldKeys.clear();
  });
}
