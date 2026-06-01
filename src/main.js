// src/main.js
//
// Boot + controller. Owns rebuildAndPlay() — the single funnel that turns state
// into the combined pattern-path program and hands it to Strudel. Data flow is
// one-way:
//
//   pattern path: user input -> state -> rebuildAndPlay() -> bridge.play(stack)
//   live path:    keydown (arp off) -> bridge.triggerNote(superdough)
//
// rebuildAndPlay stacks every active pattern-path source (arp of held keys, the
// test loop; drums/layers will join later) into one Strudel `stack(...)`, sets
// the tempo, and evaluates it. Empty -> stop.

import { state } from "./state.js";
import * as bridge from "./strudel-bridge.js";
import { buildTestPattern, buildArpString, buildDrumString, buildMetronomeString } from "./lib/pattern-builder.js";
import { semitoneToStrudelNote } from "./lib/strudel-notes.js";
import { initSound } from "./ui/sound.js";
import { initEffects } from "./ui/effects.js";
import { initKeyboard, notesForKey, heldNoteSemitones, stopChordZoneVoices } from "./ui/keyboard.js";
import { initChords } from "./ui/chords.js";
import { initArp } from "./ui/arp.js";
import { initDrums } from "./ui/drums.js";
import { initRecord, getLastRecording, setClock } from "./ui/record.js";

const log = (msg) => {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  console.log(msg);
};

// Collect every active pattern-path source into one stack and play it.
async function rebuildAndPlay() {
  const parts = [];

  if (state.arpOn) {
    const notes = heldNoteSemitones();
    if (notes.length) parts.push(buildArpString(notes));
  }
  if (state.playing) parts.push(buildTestPattern());
  if (state.drums.on) {
    // Drums need the dirt-samples bank; load it (memoized) before evaluating.
    // If it fails (e.g. offline), log and play the rest of the stack without it.
    try {
      await bridge.loadDrumSamples();
      const drumCode = buildDrumString();
      if (drumCode) parts.push(drumCode);
    } catch (err) {
      log("drum samples failed to load: " + err.message);
    }
  }
  // Finalized recording layers loop simultaneously; muted ones are skipped.
  for (const layer of state.layers) {
    if (!layer.muted) parts.push(layer.code);
  }
  // Metronome is a cycle-aligned Strudel pattern, so it shares the clock with
  // (and stays locked to) the layers above.
  if (state.metronome) parts.push(buildMetronomeString());

  if (parts.length === 0) {
    bridge.stop();
    return;
  }

  try {
    bridge.setCps(state.bpm / 240);
    const code = parts.length === 1 ? parts[0] : `stack(${parts.join(", ")})`;
    await bridge.play(code);
  } catch (err) {
    log("eval failed: " + err.message);
  }
}

// Changing the chord preset: retune the arp live (clean hot-swap) when arping,
// otherwise cut the held superdough chord voices (the M4 behavior).
function onChordPresetChange() {
  if (state.arpOn) rebuildAndPlay();
  else stopChordZoneVoices();
}

document.getElementById("play").addEventListener("click", async () => {
  state.playing = true;
  await rebuildAndPlay();
  log("playing test loop");
});

document.getElementById("stop").addEventListener("click", () => {
  state.playing = false;
  rebuildAndPlay();
  log("stopped");
});

initSound(rebuildAndPlay);
initEffects(rebuildAndPlay);
initChords(onChordPresetChange);
initArp(rebuildAndPlay);
initDrums(rebuildAndPlay);
initKeyboard(rebuildAndPlay);
initRecord(rebuildAndPlay);

// Testing/debug hooks.
window.tonus = {
  state,
  isPlaying: bridge.isPlaying,
  getLastPattern: bridge.getLastPattern,
  getCps: bridge.getCps,
  getAudioContext: bridge.getAudioContext,
  getAnalyzerData: bridge.getAnalyzerData,
  heldKeys: () => [...state.heldKeys],
  liveNotesForKey: (code) => notesForKey(code).map(semitoneToStrudelNote),
  lastRecording: getLastRecording,
  _setClock: setClock, // test seam: drive the recording grid with a fake clock
};
