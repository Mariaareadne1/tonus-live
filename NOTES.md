# NOTES — discoveries during build

Claude Code fills this in as it learns things by actually running the code. Each entry should answer a question that was open in PLAN.md or ARCHITECTURE.md, or capture a non-obvious fact about Strudel.

Format suggestion:

```
## [milestone N] · question

Answer.

Source: how I verified it (URL, command output, etc.)
```

---

## [milestone 1] · @strudel/web API, verified by running it

Installed version: `@strudel/web@1.3.0` (package.json asks for `^1.0.3`).
All facts below were confirmed by driving the page in real Chromium
(see the milestone-1 Playwright spec) and by reading the package source at
`node_modules/@strudel/web/web.mjs`.

**Does the npm `import` work, or do we need a `<script>` tag?**
The npm import works: `import { initStrudel, evaluate, hush, getAudioContext } from "@strudel/web"`.
No `<script>` tag needed. Caveat: the package is browser-only — it touches
`window` at module-load time, so it cannot be imported in plain Node (Vite/the
browser is fine).

**What does `initStrudel()` return?**
A Promise that resolves to the `repl` object once init finishes. It also:
  - calls `initAudioOnFirstClick()` (so the AudioContext resumes on the first
    user gesture — this is why play must be wired to a click), and
  - assigns `window.initStrudel`.
Must be called once, from within a user-gesture handler. We `await` it and keep
the returned `repl`.

**What does `evaluate(code)` return / does it auto-play?**
Signature is `evaluate(code, autoplay = true)`. It returns a Promise and
**auto-plays by default** — no `.play()` call required. So
`evaluate('note("c4 e4 g4 e4").s("sawtooth")')` both compiles and starts the
loop. (`Pattern.prototype.play()` also exists if we ever build a Pattern object
directly instead of from a code string.)

**Is `hush()` a global / how do we stop?**
`hush()` is a named export (we import it). Internally it calls
`repl.stop()`, which stops the **scheduler** — it does NOT close/suspend the
AudioContext. Consequence: after `hush()`, `audioContext.state` stays
`"running"` but `repl.scheduler.started` becomes `false`. So the right "is it
playing?" signal is `repl.scheduler.started`, not the context state.
Gotcha: `hush()` throws if `initStrudel()` never ran (`repl` is undefined), so
we guard the stop button until initialized.

**Where is the AudioContext?**
Not on `window.audioContext`. Use `getAudioContext()`, which is re-exported all
the way up the chain: `superdough` → `@strudel/webaudio` → `@strudel/web`.
For testability, main.js exposes `window.getStrudelAudioContext` and
`window.isStrudelPlaying` (= `repl.scheduler.started`).

**Observed playback behavior (headless Chromium):**
  - after PLAY: `audioContext.state === "running"`, `scheduler.started === true`,
    and `audioContext.currentTime` advances ~0.6s over 0.6s of wall time.
  - after STOP: `scheduler.started === false`, context still `"running"`.
  - no console errors or page errors across the whole flow.

**Still open (deferred to later milestones, not needed for M1):**
  - Stopping ONE pattern vs. all — `hush()` stops everything. The idiomatic
    multi-pattern approach (`$:` named patterns vs. one big `stack(...)`) is a
    Milestone 6/7 question.
  - BPM→cps conversion and whether `setcps()` belongs inside the evaluated
    string — revisit in Milestone 5/6.
  - Whether `gm_*` sounds need explicit `samples(...)` — Milestone 2.

---

## [milestone 2] · sound picker + effect chain

**Re-evaluating while playing hot-swaps cleanly.**
Calling `evaluate(newCode)` again while a pattern is running replaces it without
restarting the clock or the scheduler (`scheduler.started` stays `true`, no
errors). Confirmed by switching sound and dragging sliders mid-loop in the
milestone-2 Playwright spec. So "re-evaluate on every change" is just calling
the bridge's `play()` again — no special "replace" verb needed.
(Answers ARCHITECTURE open question #2.)

**Effect controls used (all verified present in `@strudel/core/controls.mjs`):**
`gain`, `lpf` (alias of `cutoff`, value in Hz), `hpf`, `room` (reverb 0..1),
`delay` (0..1), `pan` (0..1, 0.5 = center). Passing `0` for `hpf`/`room`/`delay`
is a no-op (dry) and does not error.

**Available sounds in the `@strudel/web` build.**
Soundfonts are disabled in this build (commented out in `web.mjs`), so `gm_piano`
and friends are NOT available without extra setup. `registerSynthSounds()` runs
during `initStrudel()` and provides the basic synth waveforms — the picker uses
`sawtooth`, `square`, `triangle`, `sine`. Re-enabling samples/soundfonts is a
later-milestone task (drums in M6 will force the question).

**Architecture now in place** (was sketch-only before): `state.js` (plain
object, single source of truth), `strudel-bridge.js` (only `@strudel/web`
importer, exposes `play`/`stop`/`isPlaying`/`getLastPattern`), and
`lib/pattern-builder.js` (pure `state -> string`). UI modules
(`ui/sound.js`, `ui/effects.js`) mutate state then call `rebuildAndPlay()`.

**Test hooks unified** under `window.tonus = { state, isPlaying, getLastPattern,
getAudioContext }` (replaced M1's loose `window.isStrudelPlaying` /
`window.getStrudelAudioContext`; the M1 spec was updated to match).

---

## [milestone 3] · live keyboard — the one-shot scheduling question, ANSWERED

This was the open question in PLAN.md ("what's the right way to schedule one-shot
notes with Strudel?"). I built a throwaway experiment page (now deleted) that
measured note-ONSET latency in real headless Chromium for each candidate, using
an analyser to detect first audible RMS after the trigger call.

**Measured onset latency:**

| approach | onset latency |
| --- | --- |
| re-evaluate a once-per-cycle note, `setcps(0.5)` (default) | **~2050 ms** |
| re-evaluate, `setcps(2)` | ~545 ms |
| re-evaluate, `setcps(4)` | ~544 ms |
| **`superdough(value, t, dur)` directly** | **~150 ms** (incl. a deliberate +50ms offset) |

Re-evaluation is cycle-quantized: a `note("c4")` has one hap per cycle at phase
0, so a freshly-evaluated note doesn't sound until the next cycle boundary. Even
at high cps there's a ~500ms scheduler-lookahead floor. **Unplayable as a
keyboard.** Firing `superdough` directly bypasses the cyclist scheduler and is
~150ms — playable.

**Chosen approach: per-key immediate `superdough`, sustained by re-triggering.**
`superdough(value, t, durationSec)` fires one fixed-duration voice immediately.
Crucially it **returns `undefined`** — there is no per-voice stop handle (the
`setMaxPolyphony` docs confirm voices just "ring out via release" and die FIFO).
So to get note-OFF (release a held key and have it stop) I re-trigger a short
note (`RETRIGGER_MS=150`, `NOTE_DUR_S=0.22`) on an interval per held key, and
clear that interval on key-up. This is exactly the PLAN's phrase "each key
independently scheduled." Polyphony falls out naturally (one interval per key).

**Approaches rejected and why:**
- *Re-evaluate a held-notes stack* (PLAN option 1): clean note-off and on-thesis,
  but 0.5–2s onset latency — unplayable. Kept for loops/recording/export, not
  live input.
- *`note(...).play()` per key with a stored handle* (PLAN option 2): `.play()`
  calls `repl.setPattern`, so a second key REPLACES the first rather than
  layering — no polyphony, and still cycle-quantized.
- *Drop to `synth.onTrigger`* (which DOES return `{stop}`): bypasses superdough's
  FX chain, so effects would have to be rebuilt by hand — exactly the
  oscillator/filter plumbing the project forbids.

**superdough value object uses RESOLVED param names, not the pattern aliases.**
The `.lpf`/`.hpf` sugar only exists at the pattern/control level. A superdough
value object must use `cutoff` (for lpf) and `hcutoff` (for hpf); `gain`, `pan`,
`room`, `delay`, `note`, `attack`, `release` are as-is. See
`buildLiveNoteValue()` in pattern-builder.js.

**superdough is independent of the scheduler.** Live keys work whether or not the
test loop is "playing" — `superdough` doesn't need `scheduler.started`. It does
need the AudioContext resumed; `ensureInitialized()` now calls `ac.resume()`
(safe because the first keydown is itself a user gesture).

**Sustain smoothing — tuned by measurement.** The first cut (re-trigger every
150ms with a sharp 0.01 attack and default `sustain:0.6`/`decay:0.05`) had an
audible tremolo on pure tones (sine/triangle). I built a throwaway harness (now
deleted) that holds a sine note and measures the analyser-RMS coefficient of
variation across several pitches — a direct proxy for tremolo depth. Findings:

  - The default `sustain:0.6`/`decay:0.05` made each grain SPIKE to 1.0 then drop
    to 0.6 — a big periodic bump. Fix: `sustain:1, decay:0` (flat-top grains).
  - Grains that barely overlap leave near-silence gaps (worst-case RMS dropout
    ~87%). Heavy overlap helps, but the clear winner was an EQUAL-GAIN TRIANGULAR
    crossfade: attack == release == retrigger interval, tiny hold. Two such grains
    crossfade linearly so their summed gain is ~constant.
  - Measured ripple (RMS CV, avg / worst across c4–c5):
    naive 150ms ≈ 27% / 87%  →  triangular 120ms ≈ **11% / 20%**.
  - Random per-grain detune made it WORSE (adds beating) — rejected.

Final live envelope (`ui/keyboard.js`): `RETRIGGER_MS=120`; sustain grains
`{dur:0.13, attack:0.12, decay:0, sustain:1, release:0.12}`; the FIRST note uses
a snappy `STRIKE {attack:0.005,...}` so onset stays percussive.

**Irreducible residual + the real ceiling.** The remaining ~11% ripple is phase
interference from re-triggering an *identical* pitch (constant phase offset
2π·f·interval). It cannot be fully removed with retriggering. A perfectly clean
sustain would need a single continuous oscillator with note-off — but superdough
gives no stop handle, and rolling our own oscillator is exactly the Web-Audio
voice plumbing this project exists to avoid. So triangular-grain retrigger is the
best on-thesis option; documented here so the ceiling is a known, deliberate
choice rather than a surprise.
