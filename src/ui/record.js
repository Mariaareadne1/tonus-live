// src/ui/record.js
//
// Recording + layers + metronome (milestone 7).
//
// QUANTIZATION (the point of this milestone): we snap on the way IN. Every key
// press/release is rounded to the nearest beat the instant it arrives, so captured
// durations are whole beats, never raw floats. FINALIZE compiles the snapped event
// list into a clean looping pattern (see compileLayer in pattern-builder.js).
//
// CLOCK / SYNC (milestone 7 fix): the grid is read from Strudel's master clock
// (bridge.getCycle, in cycles; 1 cycle = 4 beats) whenever the scheduler is
// running — i.e. whenever the metronome or any layer is playing. That's the same
// clock finalized layers ride, so a recording snaps to the grid you hear and the
// resulting layer locks to the metronome. With nothing playing, there's no master
// clock to sync to, so we fall back to performance.now anchored to the first press.
//
// The METRONOME is now a Strudel PATTERN (buildMetronomeString), stacked by
// rebuildAndPlay — cycle-aligned with layers by construction, so they never drift.
//
// LAYERS: each finalized loop is pushed to state.layers and stacked by
// rebuildAndPlay; per-layer mute/delete just re-evaluate the stack.

import { state } from "../state.js";
import * as bridge from "../strudel-bridge.js";
import { compileLayer, buildDrumString, ARP_RATES } from "../lib/pattern-builder.js";
import { setNoteEventHook } from "./keyboard.js";
import { clearDrumGrid } from "./drums.js";

let onChange = () => {}; // main's rebuildAndPlay

// Beat source override, injectable so tests can drive exact beat positions
// deterministically (real timing — wall-clock OR audio-clock — is too noisy to
// assert beat counts against). Returns the continuous beat position; null in
// production, where beatNow() uses the master clock or the perf.now fallback.
let clockOverride = null;
export function setClock(fn) {
  clockOverride = fn;
}

// --- beat grid + recording buffer ------------------------------------------
let useCycleClock = false; // captured at arm: is the master clock running?
let gridOrigin = 0; // perf.now of beat 0, fallback path only
let beatMs = 500; // ms per beat, fallback path only
let buffer = []; // captured events: { notes, startBeat, endBeat, arp, arpSpb }
const active = new Map(); // keyCode -> { notes, startBeat, arp, arpSpb }

// --- layers ----------------------------------------------------------------
let layerSeq = 0;
let lastEvents = []; // raw snapped events from the last finalize (test hook)

// Continuous beat position from the active timebase.
function beatNow() {
  if (clockOverride) return clockOverride();
  if (useCycleClock) return bridge.getCycle() * 4; // cycles -> beats (4/bar)
  return (performance.now() - gridOrigin) / beatMs;
}

// Snap to the nearest beat. round(beat) == round((tSec)*bpm/60) on the master
// grid — the quantization (see the user's formula in NOTES.md).
function beatAtNow() {
  return Math.round(beatNow());
}

// Arp steps per beat at the current settings: synced -> spc/4 (spc steps/cycle,
// 4 beats/cycle); free -> hz*60/bpm. Captured per note so the compiled arp segment
// plays back at the rate it was recorded at, not the current slider value.
function arpStepsPerBeat() {
  const r = ARP_RATES[state.arpRateIndex];
  if (!r) return 1;
  return state.arpSync ? r.spc / 4 : (r.hz * 60) / state.bpm;
}

// Note-event hook from the keyboard: capture press/release while armed.
function onNote(ev) {
  if (!state.recording) return;
  if (ev.type === "press") {
    if (!ev.notes || ev.notes.length === 0) return;
    // Fallback path only: anchor the grid to the FIRST press so arm->first-press
    // latency doesn't offset every beat. (On the master clock the grid is already
    // the audible one; with an override the test drives exact beats.)
    if (!clockOverride && !useCycleClock && active.size === 0 && buffer.length === 0) {
      gridOrigin = performance.now();
    }
    // Log mode + arp rate at press time so the compiler emits the matching form
    // (block chord vs arp sequence) at the speed it was actually played.
    active.set(ev.code, {
      notes: ev.notes.slice(),
      startBeat: beatAtNow(),
      arp: state.arpOn,
      arpSpb: state.arpOn ? arpStepsPerBeat() : 0,
    });
  } else {
    const g = active.get(ev.code);
    if (!g) return;
    active.delete(ev.code);
    let endBeat = beatAtNow();
    if (endBeat <= g.startBeat) endBeat = g.startBeat + 1; // min one beat
    buffer.push({ notes: g.notes, startBeat: g.startBeat, endBeat, arp: g.arp, arpSpb: g.arpSpb });
  }
}

// --- arm / disarm / finalize -----------------------------------------------
function arm() {
  buffer = [];
  active.clear();
  // Sync to the master clock when something's playing (metronome/layers); else
  // fall back to perf.now (first press re-anchors it — see onNote).
  useCycleClock = bridge.isPlaying();
  beatMs = 60000 / state.bpm;
  gridOrigin = performance.now();
  state.recording = true;
}

function disarm() {
  state.recording = false;
  buffer = [];
  active.clear();
}

function finalize() {
  // Flush any keys still held: close them at the current beat.
  for (const [, g] of active) {
    let endBeat = beatAtNow();
    if (endBeat <= g.startBeat) endBeat = g.startBeat + 1;
    buffer.push({ notes: g.notes, startBeat: g.startBeat, endBeat, arp: g.arp, arpSpb: g.arpSpb });
  }
  active.clear();
  state.recording = false;

  // Snapshot the drum grid so the take captures whatever drums were playing,
  // frozen as a string (later grid edits won't change this layer).
  const drumCode = state.drums.on ? buildDrumString() : null;

  lastEvents = buffer.map((e) => ({ ...e }));
  const code = compileLayer(buffer, drumCode);
  buffer = [];
  if (!code) return null;
  const layer = { id: ++layerSeq, code, muted: false, label: `layer ${layerSeq}` };
  state.layers.push(layer);

  // If we baked drums into the layer, wipe the live grid (opt-out) so they don't
  // double. The caller's rebuildAndPlay then reflects the empty grid.
  if (drumCode && state.clearDrumsOnFinalize) clearDrumGrid();
  return layer;
}

// --- UI --------------------------------------------------------------------
export function initRecord(onChangeCb) {
  onChange = onChangeCb ?? (() => {});
  setNoteEventHook(onNote);

  const container = document.getElementById("record");

  // arm / finalize / red dot
  const bar = document.createElement("div");
  bar.className = "rec-bar";

  const dot = document.createElement("span");
  dot.className = "rec-dot";
  dot.id = "rec-dot";

  const armBtn = document.createElement("button");
  armBtn.id = "arm";
  armBtn.textContent = "arm";

  const finalizeBtn = document.createElement("button");
  finalizeBtn.id = "finalize";
  finalizeBtn.textContent = "finalize";

  const syncArm = () => {
    armBtn.textContent = state.recording ? "disarm" : "arm";
    dot.classList.toggle("on", state.recording);
  };

  armBtn.addEventListener("click", () => {
    if (state.recording) disarm();
    else arm();
    syncArm();
  });

  finalizeBtn.addEventListener("click", () => {
    const layer = finalize();
    syncArm();
    if (layer) {
      renderLayers();
      onChange();
    }
  });

  bar.append(dot, armBtn, finalizeBtn);
  container.appendChild(bar);

  // metronome toggle — now a Strudel pattern in the stack (rebuildAndPlay),
  // so it shares the master clock with layers and never drifts.
  container.appendChild(
    checkboxRow("metronome", "metronome", state.metronome, (v) => {
      state.metronome = v;
      onChange();
    }),
  );

  // clear the drum grid after finalizing a take that captured drums (opt-out)
  container.appendChild(
    checkboxRow("clear grid on finalize", "clear-drums", state.clearDrumsOnFinalize, (v) => {
      state.clearDrumsOnFinalize = v;
    }),
  );
}

function renderLayers() {
  const el = document.getElementById("layers");
  el.textContent = "";
  for (const layer of state.layers) {
    const row = document.createElement("div");
    row.className = "layer-row";

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.label;

    const mute = document.createElement("button");
    mute.id = `layer-mute-${layer.id}`;
    mute.className = "layer-btn" + (layer.muted ? " active" : "");
    mute.textContent = layer.muted ? "muted" : "mute";
    mute.addEventListener("click", () => {
      layer.muted = !layer.muted;
      mute.textContent = layer.muted ? "muted" : "mute";
      mute.classList.toggle("active", layer.muted);
      onChange();
    });

    const del = document.createElement("button");
    del.id = `layer-del-${layer.id}`;
    del.className = "layer-btn";
    del.textContent = "del";
    del.addEventListener("click", () => {
      state.layers = state.layers.filter((l) => l.id !== layer.id);
      renderLayers();
      onChange();
    });

    row.append(name, mute, del);
    el.appendChild(row);
  }
}

// Raw snapped events from the most recent finalize (test/debug hook).
export function getLastRecording() {
  return lastEvents;
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
