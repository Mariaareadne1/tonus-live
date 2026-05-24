# tonus-v2 · plan

## What we're building

A browser-based live-coding instrument with a hand-crafted UI (panels, on-screen keyboard, drum grid, chord buttons, effect sliders) that drives **Strudel** as its audio engine. The user interacts with knobs and keys; the code translates their actions into Strudel pattern strings and asks Strudel to play them.

## What we're explicitly NOT doing

- We are NOT writing our own Web Audio oscillator/envelope/scheduler code. That's what the prior version got wrong.
- We are NOT cloning the Strudel REPL UI. Strudel has its own editor and we're not competing with it.
- We are NOT building a node-graph editor like strudel-flow. Our UI is a fixed instrument panel.

## Why this design

The previous prototype reimplemented Strudel's pattern engine in raw Web Audio. That meant:

- Two state machines for every note: ours and Strudel's-as-target. They drifted.
- Arpeggio output was bloated because we compiled events from live timing instead of generating idiomatic pattern strings up front.
- "Stuck key" bugs because filter envelopes and voice state machines raced with the master FX chain.

By letting Strudel do playback:

- We never write a voice/envelope/filter scheduler again.
- Our generated code IS what Strudel plays — no compile step, no fidelity gap.
- The "what does this sound like when exported to Strudel?" question becomes trivially the same as "what does it sound like here?"

## License

Project will be **AGPL-3.0-or-later** because Strudel is AGPL and we're depending on it. Source must be available to anyone who uses the hosted version. This is fine for a personal/learning/demo project. If commercial plans emerge later, the dependency has to be removed.

## User-facing features (target scope for v1)

These are the things the previous version had or aspired to. v2 should match or improve on each:

1. **Computer keyboard plays notes.** Two octaves of mappings (Z-row + Q-row).
2. **Chord mode.** Lower octave keys play scale-degree chords in a selected key (I, ii, iii, IV, V, vi, vii°, etc.).
3. **Chord complexity.** Triad / 7th / 9th switch.
4. **Optional bass note.** When on, chord plays with root one octave down.
5. **Optional arpeggio.** When on, chord notes play in sequence instead of stacked.
6. **Arp rate, optionally synced to BPM** with musical subdivisions (1/4, 1/8, 1/16, etc.).
7. **Sound picker.** Choose from Strudel's built-in sounds: `sawtooth`, `triangle`, `gm_piano`, etc.
8. **Effect controls.** LPF, HPF, attack, release, room, delay, gain, pan, crush.
9. **Drum grid.** 8 or 16 steps, 8 rows, per-row sound picker. Plays via Strudel.
10. **BPM slider.**
11. **Metronome toggle.**
12. **Recording / ARM / Layer system.** Manually arm to start capturing keypresses, FINALIZE to freeze them as a Strudel pattern, layers loop simultaneously.
13. **Export to Strudel code.** Copy/download the generated Strudel script.

## Out of scope for v1 (defer or skip)

- Audio file recording (the prior version had this; defer)
- Visualizers / oscilloscope / spectrum (defer — Strudel has its own visual feedback)
- Preset library (defer — manual setup for now)
- MIDI input (skip)

## Milestones

Each milestone has a concrete acceptance test that should be verified in a real browser before declaring done.

### Milestone 1 · Scaffold + Strudel verification

**Goal:** prove Strudel works in the project before building anything else.

- Set up Vite + plain JS (no TypeScript yet, no React yet — see ARCHITECTURE.md for why)
- Install `@strudel/web` from npm
- Build a page with two buttons: "play test pattern" and "stop"
- Clicking play evaluates `note("c a f e").s("sawtooth").play()`, clicking stop calls `hush()`
- LICENSE file present (AGPL-3.0)
- README.md notes Strudel attribution and AGPL

**Acceptance:** Open the dev server, click play, hear notes. Click stop, silence. No console errors. Test with Playwright that the buttons are clickable and no errors fire.

### Milestone 2 · Sound picker + effect chain

**Goal:** swap sounds and apply effects via UI controls.

- Sound `<select>` dropdown driving `.s(...)`
- Sliders for `lpf`, `hpf`, `room`, `delay`, `gain`, `pan` — each updates a live state object
- A single "test" pattern plays in a loop while you tweak; re-evaluate on every change

**Acceptance:** Switch sound from sawtooth to triangle while the loop is playing — sound changes audibly. Pull LPF slider down — pattern becomes muffled. Verify in a real browser with audio output.

### Milestone 3 · Computer keyboard → live note playback

**Goal:** typing on the keyboard plays notes via Strudel.

- Z-row + Q-row key mappings (port from the previous version's `KEY_SEMITONE_BASE`)
- Pressing a key triggers a one-shot Strudel pattern with that note + current effects
- Multiple held keys = polyphony (each key independently scheduled)
- Releasing = pattern stops or fades

**Open question for Claude Code to resolve:** what's the right way to schedule one-shot notes with Strudel? Options to evaluate:
- Re-evaluate a new pattern on every keypress (might restart the clock)
- Use `note(...).play()` per key and store the handle to stop on key-up
- Maintain one always-running pattern whose contents change

Document the choice in `NOTES.md` once it's working.

**Acceptance:** Hold A, then B, then C → hear all three. Release A → two remain. Tested in real browser.

### Milestone 4 · Chord mode

**Goal:** lower-octave keys play scale-degree chords.

- Port `chordSemitones` logic from `scaffold/lib/harmony.js`
- Tonal root selector (12 buttons or a select)
- Complexity switch (triad/7th/9th)
- Optional bass toggle
- Generate `note("[c,e,g]").s(...)` for chord, with bass adding `[c2,c,e,g]`

**Acceptance:** Set root to C, press Z → hear C major chord. Set complexity to 7th → hear C major 7. Toggle bass on → low C plays under the chord. Tested in real browser.

### Milestone 5 · Arpeggiator

**Goal:** when arp is on, chord notes play in sequence instead of stacked.

- Toggle for arp
- Slider for arp rate
- Sync-to-BPM toggle with subdivision snap (1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/32T)
- Generated pattern uses `.arp(...)` form: `note("<[c,e,g]>").arp("0 1 2")`

**Acceptance:** Hold Z with arp on at 1/8 → hear c-e-g in eighth-note sequence. Drag BPM up while holding → arp speeds up. Tested in real browser.

### Milestone 6 · Drum grid

**Goal:** 8-row × 8-or-16-step drum sequencer playing via Strudel.

- Grid UI (port DOM/CSS from previous version if useful, but it's fine to rebuild)
- 8/16 step toggle
- Each row has a sound picker (bd, sd, hh, oh, cp, rim, cr, lt, etc.)
- Play button starts a Strudel pattern like `s("bd ~ sd ~ ...")` or via `stack(...)`
- BPM slider drives `setcps(bpm/60/4)` (or wherever the right knob is — Claude Code to verify)
- Metronome toggle adds a tick on every beat

**Acceptance:** Click a few cells in row 1, set sound to bd, press play → hear kicks. Switch row 1 to oh → hear open hat instead. Toggle steps 16→8 → grid halves, pattern still loops. Tested in real browser.

### Milestone 7 · Recording + layers

**Goal:** capture chord/key presses into a Strudel pattern, finalize as a looping layer.

- ARM toggle (red dot when on)
- While armed, each keypress records `{kind, notes, time}` into a buffer
- FINALIZE button compiles buffer into a Strudel pattern string and starts playing it as a layer
- Multiple layers play simultaneously via `stack(...)`
- Per-layer mute, delete

**Acceptance:** ARM, press Z X N with chord mode → finalize → progression loops. ARM again, play a melody → finalize → both loops play together. Tested in real browser.

### Milestone 8 · Export

**Goal:** copy/download a Strudel script of all current layers + the drum pattern.

- Combine all layers as `stack(...)` with comments
- Include `setcps(...)` for current BPM
- Copy-to-clipboard button + download `.js` button

**Acceptance:** Build a few layers, click export — paste the result into https://strudel.cc — pattern sounds the same.

## Definition of done for v1

All eight milestones pass their acceptance tests in a real browser. Then we'll review with the user, capture remaining issues, and plan v1.1.

## Anti-goals (things I want to actively NOT do)

- **No premature TypeScript.** Add it only after the architecture stabilizes.
- **No premature React.** The previous version was vanilla and that wasn't the problem. Stay vanilla.
- **No state libraries.** A single plain-object `state` module is enough.
- **No CSS frameworks.** Port the existing `style.css` from the prior version if you want — it was the part of the project that worked.

## What I (Claude in this chat session) provided in `scaffold/`

- A starting file tree with empty/sketched files
- `lib/harmony.js` ported from the working chord logic in the previous version
- `lib/keymap.js` with the Z/Q-row → semitone mapping
- `index.html` starting point
- A stub `strudel-bridge.js` showing the intended shape

**These files were written without being run.** Treat them as a draft. Claude Code is expected to validate them, fix bugs, and adapt the shape as needed during the actual implementation.
