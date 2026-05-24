# tonus-v2 · architecture

## Tech stack

- **Build tool:** Vite (fast HMR, plain JS works out of the box, easy npm imports)
- **Language:** Plain ES modules (no TypeScript yet)
- **Framework:** None. Vanilla JS, hand-written DOM. The previous version's UI worked fine — the problem was the audio plumbing, not the rendering.
- **Audio engine:** `@strudel/web` (loaded via npm import OR via `<script>` tag — see Milestone 1)
- **Styling:** Plain CSS, port `style.css` from the previous version if useful

## Why no TypeScript / React / state lib

Not because they're bad — because the previous version got stuck in a swamp of complexity in the wrong layer (audio scheduling). The architecture failure was conceptual, not structural. Adding more layers would have hidden that.

We can add TS/React later once v1 is working and we know what shape the abstractions should take.

## File layout

```
tonus-v2/
├── index.html                  # entry point, loads main.js as module
├── package.json
├── vite.config.js
├── LICENSE                     # AGPL-3.0
├── README.md                   # what it is, Strudel attribution, AGPL notice
├── PLAN.md                     # the plan doc
├── ARCHITECTURE.md             # this file
├── NOTES.md                    # questions / answers discovered during build
├── style.css                   # all CSS
├── src/
│   ├── main.js                 # boot: init Strudel, wire up modules
│   ├── state.js                # single source of truth (plain object)
│   ├── strudel-bridge.js       # talks to @strudel/web: play, hush, evaluate
│   ├── ui/
│   │   ├── keyboard.js         # on-screen + computer keyboard
│   │   ├── chords.js           # chord mode + complexity + bass toggle
│   │   ├── arp.js              # arp toggle + rate + sync
│   │   ├── effects.js          # sliders for LPF, HPF, etc.
│   │   ├── drums.js            # step sequencer grid
│   │   ├── recorder.js         # ARM/FINALIZE/CLEAR + layer list
│   │   └── export.js           # copy/download Strudel script
│   ├── lib/
│   │   ├── harmony.js          # chord theory (semitone math)
│   │   ├── keymap.js           # computer key → semitone
│   │   ├── pattern-builder.js  # state → Strudel pattern string
│   │   └── strudel-notes.js    # semitone → Strudel note name (c4, d#5, etc.)
│   └── tests/
│       └── *.spec.js           # Playwright tests, one per milestone
```

## Data flow

The whole thing is unidirectional:

```
user input → state mutation → pattern rebuild → strudel.evaluate(pattern)
```

That's it. No reactive system, no observables. Each UI module reads `state`, writes to `state`, and calls `rebuildAndPlay()` after writing.

## `state.js` shape (initial sketch)

```js
export const state = {
  // currently-held keys (for live playback)
  heldKeys: new Set(),  // key codes like "90", "83"

  // harmony settings
  chordMode: false,
  arpOn: false,
  arpSync: true,
  arpRateSlider: 8,
  bassOn: false,
  tonalRoot: 0,         // 0 = C, 1 = C#, etc.
  complexity: 0,        // 0 = triad, 1 = 7th, 2 = 9th
  octaveShift: 0,

  // tone/effects (all visible to pattern-builder)
  sound: "sawtooth",
  fx: {
    gain: 0.5, lpf: 12000, lpq: 1, hpf: 0,
    attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2,
    room: 0, delay: 0, delaytime: 0.25, pan: 0.5,
    crush: 0, clip: 0,
  },

  // drums
  drumSteps: 16,        // 8 or 16
  drumRows: [           // 8 rows
    { sound: "bd", grid: [0,0,0,...] },  // length matches drumSteps
    ...
  ],
  bpm: 120,
  metronomeOn: false,
  drumPlaying: false,

  // recording
  armed: false,
  recBuffer: [],        // {kind, notes, t} events
  layers: [],           // [{id, code, muted}]
};
```

## `strudel-bridge.js` — the wrapping layer

This is the only file that imports from `@strudel/web`. Everywhere else uses the bridge.

Sketch (Claude Code: verify the API, adjust as needed):

```js
// src/strudel-bridge.js
// Verified facts from https://strudel.cc/technical-manual/project-start/:
//   - initStrudel() initializes the audio context, scheduler, samples
//   - note("c a f e").s("sawtooth").play() — pattern fluent API
//   - hush() stops everything
//   - must be called from a user-gesture handler the first time
//
// Open questions for Claude Code to answer during Milestone 1:
//   1. How do we stop ONE pattern (not all)? Does play() return a handle?
//   2. Does .play() re-trigger if called again with a new pattern, or do we
//      need an explicit "replace" verb?
//   3. How do we feed in setcps/BPM globally?

let initialized = false;

export async function ensureInitialized() {
  if (initialized) return;
  // initStrudel is a global after @strudel/web loads
  initStrudel();
  initialized = true;
}

// "Background" pattern: the always-running stack of layers + drums.
// We replace this whenever layers/drums change.
let backgroundHandle = null;

export function setBackground(patternString) {
  if (backgroundHandle) backgroundHandle.stop?.();
  // TODO Milestone 2: figure out the right re-evaluate verb
  backgroundHandle = evaluate(patternString);
}

// "Foreground" pattern: short-lived keypress sounds.
export function trigger(patternString) {
  // For live keypresses — one-shots.
  // TODO Milestone 3: figure out how to fire a one-shot without restarting
  // the whole transport
  evaluate(patternString);
}

export function stopAll() {
  hush();
  backgroundHandle = null;
}
```

The bridge has TODOs because honestly I don't know the exact answers without running the code. Claude Code's first job in Milestone 1 is to answer those questions and fix the bridge.

## `pattern-builder.js` — state → Strudel string

Pure function. Takes state, returns a string.

```js
import { state } from "./state.js";

export function buildPattern() {
  const parts = [];
  parts.push(`setcps(${state.bpm / 60 / 4})`);

  // Live held notes (computer keyboard)
  if (state.heldKeys.size > 0) {
    parts.push(buildLivePattern());
  }

  // Layers
  state.layers
    .filter(l => !l.muted)
    .forEach(l => parts.push(l.code));

  // Drums
  if (state.drumPlaying) {
    parts.push(buildDrumPattern());
  }

  if (state.metronomeOn) {
    parts.push(`s("click ~ ~ ~").gain(0.3)`);
  }

  if (parts.length === 1) return parts[0]; // just setcps
  return `stack(\n  ${parts.slice(1).join(",\n  ")}\n)`;
}
```

## Testing

Each milestone has at least one Playwright spec in `src/tests/`. Specs should:

- Start dev server (or rely on one being up)
- Open Chromium
- Click buttons, set values
- Check the DOM updates as expected
- (Where possible) check that the AudioContext has playing nodes

Audio testing is hard but not impossible — Playwright can read `audioContext.state` and `audioContext.currentTime` advancement. For a smoke test, we just check that playing doesn't throw and that `hush()` brings activity to a stop.

## Open questions

(Claude Code: add answers to `NOTES.md` as you discover them.)

1. What does `initStrudel()` return / does it accept config?
2. What's the correct way to stop a single pattern in `@strudel/web`?
3. Does Strudel auto-load samples for `gm_*` sounds, or do we need `samples(...)`?
4. What's the right BPM/cps unit conversion? Strudel uses cycles per second.
5. Can we evaluate multiple patterns concurrently, or is it always one big `stack(...)`?
6. What's the latency of `evaluate(...)`? Can we hit it on every keypress, or do we need to batch?

## Things I (Claude in this chat) am uncertain about

I'm being explicit so Claude Code can verify rather than trust:

- I have not run `@strudel/web`. The API shape above is from the official docs page only.
- The `play()` / `evaluate()` distinction is from snippets in npm package pages; I haven't seen them used together in a real codebase.
- The "stack of layers + drums in one big pattern" approach is my design choice. There may be a more idiomatic Strudel way (e.g., separate `dollar-named` patterns like `$: ...`).
- The 8-step Playwright test idea is reasonable in principle but I haven't written audio-checking Playwright code before. Claude Code may need to iterate on what's actually testable.

When Claude Code finds something different from what I wrote here, that's expected. Update the architecture doc rather than working around it.
