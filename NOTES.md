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

---

## [milestone 4] · chord mode

Straightforward, built on the M3 live path. `harmony.js` (`chordSemitones`) was
ported as-is and worked unchanged — its logic was already correct.

**A chord is just stacked live voices.** `notesForKey()` (in `ui/keyboard.js`)
returns an array of semitones; chord mode returns the chord's notes, single-note
mode returns one. `triggerKey` fires one superdough voice per returned semitone,
so chords ride the exact same strike + triangular-grain retrigger path as single
notes — no separate chord code path, and effects/sustain behave identically.

**Routing rule:** chord mode only intercepts LOWER-octave keys (those in
`LOWER_OCTAVE_DEGREE`); upper-octave keys stay melodic single notes even with
chord mode on. This matches "lower-octave keys double as chord-zone keys."

**Bass** is `chord.chordRoot - 12` prepended to the note list (root one octave
below the chord), gated by `state.bassOn`. **octaveShift** is applied uniformly
to every resolved semitone (chord or single) as the last step.

Verified by asserting resolved note names per setting (C triad → c4/e4/g4; 7th →
+b4; bass → +c3; root D → d4/f#4/a4...), plus an audio smoke test. Note these are
live superdough voices, so they don't show up in `getLastPattern()` — that's the
pattern path, which chords will join later for recording/export (M7/M8).

**Preset change cuts held chord voices (`stopChordZoneVoices`).** Changing the
root or complexity while a chord-zone key is held used to overlap the old and new
chords (e.g. C vs C# flickering) because the old chord's grains kept retriggering
/ ringing. Fix: on root/complexity change, stop the retrigger loops for held
LOWER-octave keys (chord mode only) and drop them from `heldKeys`; the user
re-presses to play the new chord. We do NOT retune live (deeper change, deferred).
Because superdough has no note-off, already-scheduled grains still fade over
~one grain (~0.25s) — the fastest honest cut. Melody / upper-octave keys are
deliberately left ringing (they aren't derived from the root).

---

## [milestone 5] · arpeggiator

**Path choice: PATTERN path, not the live-trigger path.** An arp is inherently
rhythmic, looped, and must lock to the clock for BPM sync — exactly what Strudel's
cyclist engine does. Doing it on the live path would mean hand-rolling a clock /
sequencer (against the thesis). So arp = `evaluate(note(...).fast(...))`. This is
the OPPOSITE tradeoff from M3's live keyboard, and that's deliberate:

  - live single notes (M3/M4): need ~150ms onset -> superdough (no clock needed).
  - arp (M5): needs tempo-locked looping -> pattern path (onset latency is fine
    because an arp is a sustained loop, not a one-shot).

**Onset latency, re-checked.** Pattern re-eval is cycle-quantized, BUT an arp has
many events per cycle (e.g. 1/8 = 8), so the next event after a keypress is at
most one subdivision away (~one 1/8 ≈ 0.25s at 120bpm) plus the ~0.5s scheduler
floor — not a whole cycle. Acceptable for a looping arp; a player feels the loop,
not the first-event delay.

**Rate math (one global clock, both modes correct).** Global `cps = bpm/240`
(1 cycle = 1 bar of 4/4). Held notes -> `note("c4 e4 g4").fast(R)` where R is set
so the events-per-second land right:
  - rate (events/sec) = len * R * cps
  - SYNCED:  want rate = spc * cps (spc events per cycle) -> R = spc/len. The cps
    cancels, so the *pattern string is BPM-independent* but the audible rate
    scales with BPM (raise BPM -> faster). spc table: 1/4=4 ... 1/32T=48.
  - FREE:    want rate = a fixed Hz -> R = hz/(len*cps). Here R absorbs cps, so
    the audible rate stays constant as BPM changes (BPM-independent), which is
    what "not synced" should mean.
Verified both: synced 1/8 @120 and @240 keep `.fast(2.6667)` (cps changes);
free 8Hz keeps the rate by changing `.fast` from 5.3333 (@120) to 2.6667 (@240).

**Integration.** `rebuildAndPlay()` is now the single funnel for the whole
PATTERN path: it stacks every active source (arp of held keys + the M2 test loop;
drums/layers will join in M6/M7) into one `stack(...)`, sets cps, and evaluates —
empty stack -> `hush()`. When arp is on, held keys route through this instead of
superdough (keyboard.js branches on `state.arpOn`). `setCps` is `repl.setCps`
(no restart). The shared `fxChain()` (now incl. `.analyze("live")`) is used by
test loop + arp so they sound identical and both feed the analyser.

**Chord preset change while arping:** retunes live (clean pattern hot-swap) rather
than the M4 superdough cut — `main.onChordPresetChange` picks the right behavior
based on `state.arpOn`.

**Deferred:** simultaneous arp + non-synced rate + drums all want the one global
cps; that's fine now (free arp divides cps out) but a truly independent per-source
clock would need Strudel's multi-pattern (`$:`) machinery — revisit if M6 drums
+ free arp ever fight over tempo.
