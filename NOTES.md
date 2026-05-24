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
