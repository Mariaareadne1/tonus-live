// src/ui/chords.js
//
// Chord-mode controls: enable/disable chord mode, pick the tonal root, the chord
// complexity (triad/7th/9th), and toggle an added bass note. Each control just
// writes to state; the live keyboard reads state at trigger time, so changes
// take effect on the next keypress (no rebuild needed).

import { state } from "../state.js";
import { ROOT_NAMES } from "../lib/harmony.js";

const COMPLEXITY = ["triad", "7th", "9th"];

// `onPresetChange` runs after root/complexity changes — main decides whether to
// retune the arp (hot-swap) or cut held chord-zone voices (see main.js).
export function initChords(onPresetChange) {
  const container = document.getElementById("chords");
  container.append(
    checkboxRow("chord mode", "chord-mode", state.chordMode, (v) => (state.chordMode = v)),
    selectRow("root", "chord-root", ROOT_NAMES, state.tonalRoot, (i) => {
      state.tonalRoot = i;
      onPresetChange();
    }),
    selectRow("complexity", "chord-complexity", COMPLEXITY, state.complexity, (i) => {
      state.complexity = i;
      onPresetChange();
    }),
    checkboxRow("bass", "chord-bass", state.bassOn, (v) => (state.bassOn = v)),
  );
}

function row(labelText) {
  const el = document.createElement("label");
  el.className = "control";
  const name = document.createElement("span");
  name.className = "control-label";
  name.textContent = labelText;
  el.appendChild(name);
  return el;
}

function checkboxRow(labelText, id, initial, onChange) {
  const el = row(labelText);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = initial;
  input.addEventListener("change", () => onChange(input.checked));
  el.append(input, document.createElement("span")); // spacer keeps 3-col grid
  return el;
}

function selectRow(labelText, id, options, initialIndex, onChange) {
  const el = row(labelText);
  const select = document.createElement("select");
  select.id = id;
  options.forEach((opt, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = opt;
    select.appendChild(o);
  });
  select.value = String(initialIndex);
  select.addEventListener("change", () => onChange(parseInt(select.value, 10)));
  el.append(select, document.createElement("span"));
  return el;
}
