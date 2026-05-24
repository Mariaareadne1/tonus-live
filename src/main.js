// src/main.js
//
// Boot + controller. Wires the play/stop loop and the UI modules, and owns
// rebuildAndPlay() — the single funnel that turns state into a pattern and
// hands it to Strudel. Data flow is one-way:
//
//   user input -> state mutation -> rebuildAndPlay() -> bridge.play(pattern)

import { state } from "./state.js";
import * as bridge from "./strudel-bridge.js";
import { buildTestPattern } from "./lib/pattern-builder.js";
import { initSound } from "./ui/sound.js";
import { initEffects } from "./ui/effects.js";

const log = (msg) => {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  console.log(msg);
};

// Rebuild the pattern from current state and play it — but only while the loop
// is running. When stopped, control changes just update state silently.
async function rebuildAndPlay() {
  if (!state.playing) return;
  try {
    await bridge.play(buildTestPattern());
  } catch (err) {
    log("eval failed: " + err.message);
  }
}

document.getElementById("play").addEventListener("click", async () => {
  state.playing = true;
  try {
    await bridge.play(buildTestPattern());
    log("playing test loop");
  } catch (err) {
    state.playing = false;
    log("init/eval failed: " + err.message);
  }
});

document.getElementById("stop").addEventListener("click", () => {
  state.playing = false;
  bridge.stop();
  log("stopped");
});

initSound(rebuildAndPlay);
initEffects(rebuildAndPlay);

// Testing/debug hooks.
window.tonus = {
  state,
  isPlaying: bridge.isPlaying,
  getLastPattern: bridge.getLastPattern,
  getAudioContext: bridge.getAudioContext,
};
