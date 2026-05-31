// src/ui/arp.js
//
// Arpeggiator + transport controls: arp on/off, sync-to-BPM toggle, rate slider
// (snaps to musical subdivisions when synced; free Hz when not), and the BPM
// slider. Each writes state then calls onChange (rebuildAndPlay) so a running
// arp re-evaluates immediately.

import { state } from "../state.js";
import { ARP_RATES } from "../lib/pattern-builder.js";

export function initArp(onChange) {
  const container = document.getElementById("arp");

  // arp on/off
  container.appendChild(
    checkboxRow("arp", "arp-on", state.arpOn, (v) => {
      state.arpOn = v;
      onChange();
    }),
  );

  // sync-to-BPM toggle (also relabels the rate slider)
  let updateRateLabel;
  container.appendChild(
    checkboxRow("sync bpm", "arp-sync", state.arpSync, (v) => {
      state.arpSync = v;
      updateRateLabel();
      onChange();
    }),
  );

  // rate slider (index into ARP_RATES)
  const rateRow = document.createElement("label");
  rateRow.className = "control";
  const rateName = document.createElement("span");
  rateName.className = "control-label";
  rateName.textContent = "rate";
  const rate = document.createElement("input");
  rate.type = "range";
  rate.min = 0;
  rate.max = ARP_RATES.length - 1;
  rate.step = 1;
  rate.value = state.arpRateIndex;
  rate.id = "arp-rate";
  const rateVal = document.createElement("span");
  rateVal.className = "control-value";
  updateRateLabel = () => {
    const r = ARP_RATES[state.arpRateIndex];
    rateVal.textContent = state.arpSync ? r.label : r.hz + "hz";
  };
  rate.addEventListener("input", () => {
    state.arpRateIndex = parseInt(rate.value, 10);
    updateRateLabel();
    onChange();
  });
  updateRateLabel();
  rateRow.append(rateName, rate, rateVal);
  container.appendChild(rateRow);

  // BPM slider
  const bpmRow = document.createElement("label");
  bpmRow.className = "control";
  const bpmName = document.createElement("span");
  bpmName.className = "control-label";
  bpmName.textContent = "bpm";
  const bpm = document.createElement("input");
  bpm.type = "range";
  bpm.min = 40;
  bpm.max = 240;
  bpm.step = 1;
  bpm.value = state.bpm;
  bpm.id = "bpm";
  const bpmVal = document.createElement("span");
  bpmVal.className = "control-value";
  bpmVal.textContent = state.bpm;
  bpm.addEventListener("input", () => {
    state.bpm = parseInt(bpm.value, 10);
    bpmVal.textContent = state.bpm;
    onChange();
  });
  bpmRow.append(bpmName, bpm, bpmVal);
  container.appendChild(bpmRow);
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
