// src/ui/drums.js
//
// The drum sequencer panel: an on/off toggle, an 8<->16 step toggle, and an
// 8-row grid. Each row has a sound picker (<select>) and one clickable cell per
// step. Clicking a cell, changing a sound, or toggling step count writes to
// state.drums and calls onChange (rebuildAndPlay), so the loop updates live.
//
// The grid is the only stateful UI here, so it's re-rendered from state whenever
// the step count changes (cells are added/removed); sound picks and cell toggles
// mutate state in place and don't need a re-render.

import { state } from "../state.js";
import { DRUM_SOUNDS } from "../lib/pattern-builder.js";

export function initDrums(onChange) {
  const container = document.getElementById("drums");

  // drums on/off
  container.appendChild(
    checkboxRow("drums", "drums-on", state.drums.on, (v) => {
      state.drums.on = v;
      onChange();
    }),
  );

  const grid = document.createElement("div");
  grid.className = "drum-grid";
  grid.id = "drum-grid";

  // step-count toggle (8 <-> 16): re-render the grid, then re-evaluate
  const stepsRow = document.createElement("div");
  stepsRow.className = "control";
  const stepsLabel = document.createElement("span");
  stepsLabel.className = "control-label";
  stepsLabel.textContent = "steps";
  const stepsBtn = document.createElement("button");
  stepsBtn.id = "drum-steps";
  stepsBtn.textContent = state.drums.steps;
  stepsBtn.addEventListener("click", () => {
    setSteps(state.drums.steps === 16 ? 8 : 16);
    stepsBtn.textContent = state.drums.steps;
    renderGrid(grid, onChange);
    onChange();
  });
  stepsRow.append(stepsLabel, stepsBtn, document.createElement("span"));
  container.appendChild(stepsRow);

  container.appendChild(grid);
  renderGrid(grid, onChange);
}

// Resize every row's step array to n, preserving existing hits (truncate when
// shrinking, pad with rests when growing).
function setSteps(n) {
  state.drums.steps = n;
  for (const row of state.drums.rows) {
    row.steps =
      n < row.steps.length
        ? row.steps.slice(0, n)
        : row.steps.concat(Array(n - row.steps.length).fill(false));
  }
}

function renderGrid(grid, onChange) {
  grid.textContent = "";
  state.drums.rows.forEach((row, i) => {
    const rowEl = document.createElement("div");
    rowEl.className = "drum-row";

    const sel = document.createElement("select");
    sel.className = "drum-sound";
    sel.id = `drum-sound-${i}`;
    for (const name of DRUM_SOUNDS) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    sel.value = row.sound;
    sel.addEventListener("change", () => {
      row.sound = sel.value;
      onChange();
    });
    rowEl.appendChild(sel);

    const cells = document.createElement("div");
    cells.className = "drum-cells";
    cells.style.gridTemplateColumns = `repeat(${state.drums.steps}, 1fr)`;
    row.steps.forEach((on, j) => {
      const cell = document.createElement("button");
      cell.className = "step" + (on ? " on" : "") + (j % 4 === 0 ? " beat" : "");
      cell.id = `drum-cell-${i}-${j}`;
      cell.addEventListener("click", () => {
        row.steps[j] = !row.steps[j];
        cell.classList.toggle("on", row.steps[j]);
        onChange();
      });
      cells.appendChild(cell);
    });
    rowEl.appendChild(cells);
    grid.appendChild(rowEl);
  });
}

function checkboxRow(labelText, id, initial, onToggle) {
  const el = document.createElement("label");
  el.className = "control";
  const name = document.createElement("span");
  name.className = "control-label";
  name.textContent = labelText;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = initial;
  input.addEventListener("change", () => onToggle(input.checked));
  el.append(name, input, document.createElement("span"));
  return el;
}
