// src/ui/keyboard.js
//
// Computer keyboard -> live note playback.
//
// Why this design (measured in milestone 3, see NOTES.md): re-evaluating a
// Strudel pattern on each keypress has 0.5-2s onset latency (cycle-quantized) —
// unplayable. Firing superdough directly is ~150ms — playable. But superdough
// gives no note-off handle, so to make a key SUSTAIN while held and STOP on
// release, each held key re-triggers a note on an interval; key-up clears that
// key's interval. This is what "each key independently scheduled" means.
//
// Smoothing the sustain (measured sweep, see NOTES.md): a held note is sustained
// by overlapping TRIANGULAR grains — each grain ramps up over one interval and
// down over the next, so two grains crossfade with constant summed gain (~11%
// residual ripple vs ~87% for naive short re-triggers). The FIRST note instead
// uses a fast-attack "strike" so the onset stays percussive/responsive.
//
// Live notes read state.fx at every trigger, so dragging effect sliders changes
// the sound of held notes in near-real-time.

import { state } from "../state.js";
import { keyToSemitone } from "../lib/keymap.js";
import { buildLiveNoteValue } from "../lib/pattern-builder.js";
import * as bridge from "../strudel-bridge.js";

const RETRIGGER_MS = 120;
// Triangular sustain grain: attack == release == interval, flat top, tiny hold.
// duration is the time to grain peak; release then fades it as the next grain
// rises. (sustain:1, decay:0 => no per-grain amplitude spike.)
const SUSTAIN_GRAIN = { dur: 0.13, attack: 0.12, decay: 0, sustain: 1, release: 0.12 };
// Percussive first hit: snappy attack so the keypress feels immediate.
const STRIKE = { dur: 0.18, attack: 0.005, decay: 0, sustain: 1, release: 0.12 };

const timers = new Map(); // keyCode -> setInterval id

function triggerKey(keyCode, env) {
  const semitone = keyToSemitone(keyCode, state.octaveShift);
  if (semitone == null) return;
  bridge.triggerNote(buildLiveNoteValue(semitone, env), env.dur).catch(() => {});
}

export function initKeyboard() {
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const code = String(e.keyCode);
    if (keyToSemitone(code) == null) return; // not a mapped musical key
    if (state.heldKeys.has(code)) return; // already held
    state.heldKeys.add(code);
    triggerKey(code, STRIKE); // immediate percussive onset
    timers.set(code, setInterval(() => triggerKey(code, SUSTAIN_GRAIN), RETRIGGER_MS));
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
