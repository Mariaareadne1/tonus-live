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
import { buildTestPattern, buildArpString } from "./lib/pattern-builder.js";
import { semitoneToStrudelNote } from "./lib/strudel-notes.js";
import { initSound } from "./ui/sound.js";
import { initEffects } from "./ui/effects.js";
import { initKeyboard, notesForKey, heldNoteSemitones, stopChordZoneVoices } from "./ui/keyboard.js";
import { initChords } from "./ui/chords.js";
import { initArp } from "./ui/arp.js";

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
initKeyboard(rebuildAndPlay);

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
};
