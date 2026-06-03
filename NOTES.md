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

---

## [milestone 6] · drum grid — the "where do drum SAMPLES come from?" question, ANSWERED

This was the open question flagged back in M1/M2 ("drums in M6 will force the
samples question"). The M1 build disables soundfonts/samples in the prebake
(`registerSoundfonts()` and the `samples()` line are commented out in
`@strudel/web/web.mjs`), so init registers ONLY synth waveforms — there is no
`bd`/`sd`/`hh` until we load a bank ourselves.

**`samples()` IS available even though soundfonts aren't.** Traced the export
chain: `@strudel/web` → `@strudel/webaudio` (`index.mjs` does `export * from
'superdough'`) → `superdough/sampler.mjs` exports `samples`. So the loader is
re-exported all the way up; only the *prebake call* was commented out, not the
function. The bridge now imports `samples` from `@strudel/web` like everything
else.

**Bank used: `samples('github:tidalcycles/dirt-samples')`.** The `github:` prefix
resolves to that repo's `strudel.json` (see `fetchSampleMap` in sampler.mjs:
`githubPath(url, 'strudel.json')`). This gives the classic dirt set — bd, sd, hh,
ho, cp, rm, cr, lt, mt, ht, sn, perc, ... — registered at the TOP LEVEL (no
`.bank(...)` needed; `s("bd")` just works).

**Watch the folder names — they are NOT the GM/Tidal aliases.** The M6 ear check
caught two silent rows: we'd named open-hat `oh` and rimshot `rim`, but this bank
has neither key. The actual folders are `ho` (open hi-hat, `ho/HHOD0.wav`) and
`rm` (`rm/RIM0.wav`); a wrong name isn't an error, it just registers nothing and
plays silence. Verified the full picker list against the fetched `strudel.json`'s
218 keys before fixing — every other name (bd/sd/hh/cp/cr/lt/mt/ht/sn/perc) is a
real folder. (Aliases like `oh`→`ho` exist in Strudel's separate drum-machine
alias bank, which this build doesn't load — so use raw dirt folder names here.)

**Loading is two-phase, and that shaped where the await goes.** `samples(url)`
fetches+registers the sample MAP (one small JSON) — the actual audio buffers load
LAZILY on each sound's first trigger (`getSampleBuffer`→`loadBuffer` fetches on
demand). So the map fetch must finish before evaluating a drum pattern, but the
buffers stream in after. `strudel-bridge.loadDrumSamples()` memoizes the map
fetch in a module promise (resets to null on failure so a later retry can
succeed); `rebuildAndPlay()` awaits it ONLY when `state.drums.on`, inside its own
try/catch so an offline failure logs and still plays the arp/test loop. This
keeps the M3 live-keyboard onset path untouched — samples never load unless drums
are actually turned on.

**Audio test confirms it end-to-end.** The M6 Playwright spec asserts the
generated pattern string AND a `peakRms > 0.02` on the "live" analyser — the
audio assertion only passes if the dirt-samples bank fetched from GitHub and a
buffer loaded and triggered. Gave it a 3s window for the first-buffer network
round-trip; passes in ~3.7s total.

**Grid → pattern mapping.** Each row is one mini-notation sequence,
`s("bd ~ ~ ~ bd ...")`, where the row's `steps` boolean array maps 1:1 to events
in a cycle. With the established `cps = bpm/240` (1 cycle = 1 bar of 4/4), N steps
= N subdivisions: 16 steps → 16th notes, 8 → 8th notes. Active rows are stacked
(`stack(rowA, rowB, ...)`) and that whole drum source is pushed into
rebuildAndPlay's top-level `stack(...)` alongside the arp/test loop (nested stacks
are fine in Strudel). Empty rows are dropped; an all-empty grid contributes
nothing. The 16↔8 toggle resizes each row's array (truncate / pad with rests),
preserving existing hits, and re-renders the grid.

**Drums bypass `fxChain()` deliberately.** That chain forces `.s(synthWaveform)`,
which would clobber the sample sound. Drums carry their own `s("bd ...")` plus a
fixed `.gain(0.9)` and `.analyze("live")` (so tests/visualisers see them) — they
do NOT inherit the melodic lpf/hpf/room/delay/pan. Per-row drum FX is a later
concern if it ever comes up.

**Metronome: deferred to M7 (deliberate scope call).** PLAN lists "metronome
toggle" as an M6 bullet, but the M6 acceptance test doesn't require it, and the
user asked for the metronome to land together with M7's recording quantization
(the click is what you play along to while recording). So M6 is the grid only;
the metronome + beat-snap quantization come as a pair in M7.

---

## [milestone 7] · recording + layers, with INPUT quantization

The headline feature. Recording captures key presses while armed and FINALIZE
compiles them into a looping layer; layers stack and each has mute/delete.

**Quantization is on the way IN, not post-record.** The recorder (`ui/record.js`)
owns a beat grid: `gridOrigin` (a timestamp for "beat 0") and `beatMs` (60000/bpm,
frozen at arm). The instant a press or release arrives, its timestamp is snapped
to the nearest beat index:
  `beat = Math.round((now - gridOrigin) / beatMs)`
which is exactly the user's formula `Math.round(tSec * bpm/60)` rebased to the
grid origin (beatMs == 1000/(bpm/60)). So captured durations are whole beats, and
the compiled code has clean integer weights — never float garbage. (Half-beat
resolution would be `beatMs/2`; we use whole beats, which matches the goal and
keeps `@n` integer.)

**The grid origin has to track what the player hears, or snapping drifts.** First
cut anchored the grid at the ARM click. But there's latency between arming and the
first keypress (in the test harness ~300ms; for a human, however long they wait).
That offset shifts every absolute beat position while the first note's start stays
0 — so a clean 2-beat hold rounded to 3 (`@3 ... .slow(1.5)`), caught by the test.
Two-part fix:
  - metronome ON  -> grid origin = the last click (`lastClick`). You play to the
    clicks, snapping aligns to the clicks.
  - metronome OFF -> grid is re-anchored to the FIRST press of the take (like a
    DAW with no count-in). Leading silence is dropped; the first note is beat 0.

**Compile = duration-weighted mini-notation (`compileLayer` in pattern-builder).**
Each event becomes a token weighted by its beat-duration: a 2-beat C chord ->
`[c4,e4,g4]@2`. Gaps become `~@n` rests. The whole loop is stretched with
`.slow(loopLen/4)` so one weight-unit == one beat (1 cycle == 1 bar == 4 beats
under the established cps=bpm/240); a 4-beat loop needs no `.slow`. Events sharing
a start beat merge into one chord; the timeline cursor is kept monotonic so the
layer is monophonic-in-time (the acceptance input is sequential presses — true
overlapping polyphony within one layer is a deliberate non-goal).

  press Z (chord mode, C major) 2 beats, then X (D minor) 2 beats ->
    note("[c4,e4,g4]@2 [d4,f4,a4]@2")

**Output form follows the mode that was playing, per segment** (user's call). Each
event also logs whether the arpeggiator was ON at press time, and the compiler
emits the matching form:
  - arp OFF -> block chords:  note("[c4,e4,g4]@2 [d4,f4,a4]@2")
  - arp ON  -> arp form:      note("[c4,e4,g4]@2 [d4,f4,a4]@2").arp("0 1 2")
A take that switches arp mid-record is split into one duration-weighted timeline
per mode (the other mode's slots filled with rests) and `stack(...)`-ed, so every
segment sits at the right beat in the right form:
    stack(note("[c4,e4,g4]@2 ~@2"), note("~@2 [d4,f4,a4]@2").arp("0 1 2"))
We keep the `@n` weights even in the arp form (the PLAN sketch's bare `<...>` would
have dropped the durations) so quantization is preserved either way. The arp index
list is sized to the largest arp-segment chord ("0 1 2" for triads, "0 1 2 3" for
7ths); a single fixed list applies to the whole arp timeline.

**Metronome** is a self-scheduling `setTimeout` click (re-reads BPM each beat so
it follows the slider) firing a short square-wave blip via superdough — scheduler-
independent, like live keys, and NOT routed through `.analyze("live")` so it
doesn't pollute the analyser other tests read. Accents the downbeat (every 4th).

**Layers** live in `state.layers` ({id, code, muted, label}); rebuildAndPlay
pushes every non-muted layer's frozen code into the same top-level `stack(...)` as
arp/drums/test, so finalized loops play simultaneously and mute/delete just
re-evaluate. A layer's fxChain is baked in at finalize, so each layer keeps the
sound/effects it was recorded with.

**Testing time-dependent capture: inject the clock.** Real `waitForTimeout` holds
were too noisy to assert beat counts against (same 2x1000ms take measured 2303ms
then 3063ms across runs — enough jitter to round differently). So the recorder's
grid time source is injectable (`setClock`, exposed as `window.tonus._setClock`);
the test drives exact fake BEAT positions at each real keydown/keyup. The full
press -> hook -> snap -> compile path still runs; only the clock is controlled.

### [milestone 7 · v2 fixes] sync, arp rate, drum capture

Three issues from the M7 ear-check, fixed:

**BUG 1 — layer/metronome sync (two clocks → one).** The metronome was a
`setTimeout`/`performance.now` click loop; layers play on Strudel's `scheduler.now()`
cycle clock. Two unrelated timebases → a constant offset that "never catches up".
Fix: the metronome is now a Strudel PATTERN (`buildMetronomeString` = `note("c6 c5
c5 c5").s("square")...`, 4 clicks/cycle = 1/beat, downbeat accented by pitch),
stacked by rebuildAndPlay. Being a pattern, it rides the SAME master clock as
layers, so they're cycle-aligned by construction and never drift. The recorder's
grid now also reads that master clock (`bridge.getCycle()` = `scheduler.now()`, in
cycles; *4 = beats) whenever the scheduler is running (metronome or any layer) —
so a recording snaps to the grid you hear and the finalized layer locks to the
click. With nothing playing there's no master clock to sync to, so it falls back to
`performance.now` anchored to the first press (internal consistency only). Unmute
re-evaluates the stack, which is inherently cycle-quantized — the layer resumes on
a cycle boundary, in time with the click.

**BUG 2 — arp layer played at half speed.** `.arp(indices, pat)` is
`pat.arpWith(haps => reify(indices).fmap(i => haps[i%len]))` + `innerJoin` — it fits
the WHOLE index list into each chord's full duration, so it can't carry a fixed
rate (3 notes spread over a 2-beat hold ≈ slow). Fix: drop `.arp()` entirely and
encode an arp segment as a SUBDIVIDED note sequence sized to the recorded rate.
Each note logs `arpSpb` (steps/beat: synced = spc/4, free = hz*60/bpm); the
compiler emits `[c4 e4 g4 c4]@2` — round(dur*spb) steps cycling the chord, the
`[..]` group sub-sequencing them and `@dur` spanning the right beats. 1/8 over 2
beats → 4 steps; 1/16 → 8 steps. Plays at the recorded speed regardless of the
current slider, and (bonus) this is exactly how the live arp sounds (a fast note
sequence), so block segments stay `[c4,e4,g4]` (commas) and arp segments are
`[c4 e4 g4 ...]` (spaces) — both inline in ONE `note(...)`, no per-mode stack needed
anymore. Free-rate arps tempo-lock to the record-time BPM (acceptable: a finalized
layer is a fixed pattern).

**BUG 3 — drums weren't captured.** FINALIZE now snapshots `buildDrumString()` when
`state.drums.on` and `compileLayer(events, drumCode)` stacks it with the note part
(`stack(note(...)..., s("bd ...")...)`), so the take captures whatever drums were
playing, frozen. Drums are cycle-aligned mini-notation and the note part is
cycle-aligned too, so they loop in sync. To avoid the committed drums doubling
against the still-live grid, FINALIZE wipes the grid after baking it in — gated by
a "clear grid on finalize" checkbox (`state.clearDrumsOnFinalize`, default ON;
`clearDrumGrid()` in ui/drums.js clears the cells but leaves row sounds / step
count / the drums-on toggle alone). Turn it off to keep layering onto the same
grid. The test asserts `s("bd` appears exactly once in the live program after a
default finalize (proving no double).

Output-form note: the previous `.arp("0 1 2")` form is GONE (it couldn't encode
rate) — superseded by the per-rate sequence above.

---

## [milestone 8] · export

Serialize everything playing into a standalone Strudel program that runs verbatim
in strudel.cc (`buildExportCode` in pattern-builder.js, `ui/export.js` panel).

**What's exported:** `setcps(${bpm}/240)` (the division is exact AND self-documents
the bpm; our 1 bar = 1 cycle), a `samples('github:tidalcycles/dirt-samples')` line
when any part references a dirt sound (live drums OR drums baked into a layer), then
the non-muted layers + the live drum grid as a commented `stack(...)`:
`// layer 1`, `// layer 2`, `// drums`. A single part skips the `stack(...)` wrapper;
an empty program emits `silence`.

**What's excluded, deliberately:** the metronome and the M2 test loop — they're
guides/auditioning, not the song. And the tonus-internal `.analyze("live")` is
stripped (analyser routing for our visualiser/tests); strudel.cc doesn't need it.

**Portability proof.** We can't drive strudel.cc from a test, but our bridge IS
Strudel (same `@strudel/transpiler` strudel.cc uses). So the milestone-8 spec
EVALUATES the exported string through Strudel (`window.tonus._eval` -> bridge.play)
and asserts it plays with zero page/console errors — a strong proxy for "pastes
into strudel.cc and works". This also confirmed the multi-statement shape
(`setcps(...)` / `samples(...)` then the `stack(...)` expression) evaluates fine —
top-level statements run, the final pattern expression plays.

**Panel sync gotcha.** `refreshExport()` must run at the TOP of rebuildAndPlay
(before the `await loadDrumSamples()`), or the textarea lags a step behind state
when drums are toggled — the test caught the stale panel vs. fresh `exportCode()`.

**Copy/download.** Copy uses `navigator.clipboard.writeText` with a `execCommand`
selection fallback; download builds a `Blob` -> object URL -> `<a download="tonus.js">`.
The test grants clipboard permission and captures the download event for the name.
