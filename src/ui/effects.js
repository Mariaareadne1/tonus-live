// src/ui/effects.js
//
// Effect sliders. Each slider is bound to one key in state.fx; moving it writes
// the value and calls onChange() (rebuildAndPlay), so changes are audible live
// while the test loop runs.

import { state } from "../state.js";

// key must match a field in state.fx. min/max/step are the slider range.
const SLIDERS = [
  { key: "gain", label: "gain", min: 0, max: 1, step: 0.01 },
  { key: "lpf", label: "lpf (Hz)", min: 100, max: 15000, step: 50 },
  { key: "hpf", label: "hpf (Hz)", min: 0, max: 5000, step: 50 },
  { key: "room", label: "room", min: 0, max: 1, step: 0.01 },
  { key: "delay", label: "delay", min: 0, max: 1, step: 0.01 },
  { key: "pan", label: "pan", min: 0, max: 1, step: 0.01 },
];

export function initEffects(onChange) {
  const container = document.getElementById("effects");

  for (const { key, label, min, max, step } of SLIDERS) {
    const row = document.createElement("label");
    row.className = "control";

    const name = document.createElement("span");
    name.className = "control-label";
    name.textContent = label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = state.fx[key];
    input.id = `fx-${key}`;

    const value = document.createElement("span");
    value.className = "control-value";
    value.textContent = state.fx[key];

    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      state.fx[key] = v;
      value.textContent = v;
      onChange();
    });

    row.append(name, input, value);
    container.appendChild(row);
  }
}
