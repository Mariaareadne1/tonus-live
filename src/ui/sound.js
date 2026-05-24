// src/ui/sound.js
//
// The sound picker: a <select> that drives .s(...) in the pattern.
//
// Milestone 2 offers the built-in synth waveforms registered by Strudel's
// registerSynthSounds(). Sample/soundfont sounds (gm_piano etc.) are disabled
// in the @strudel/web build (see NOTES.md) and come in a later milestone.

import { state } from "../state.js";

export const SOUNDS = ["sawtooth", "square", "triangle", "sine"];

export function initSound(onChange) {
  const sel = document.getElementById("sound");
  for (const name of SOUNDS) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.value = state.sound;
  sel.addEventListener("change", () => {
    state.sound = sel.value;
    onChange();
  });
}
