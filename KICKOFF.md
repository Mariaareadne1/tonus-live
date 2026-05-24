# Kickoff prompt for Claude Code

Paste this into a fresh Claude Code session in an empty directory:

---

I'm starting a project called **tonus-v2**, a browser-based live-coding instrument that uses Strudel as its audio engine. Read `PLAN.md` and `ARCHITECTURE.md` in this directory first — they define what we're building and how.

**Critical context:**
- This replaces a vanilla-JS prototype where I (the developer) reimplemented Strudel's pattern engine in raw Web Audio. That approach failed because the reimplementation drifted from Strudel's semantics and accumulated bugs.
- The new design: my UI generates Strudel pattern strings, Strudel itself plays them. No more raw oscillator/voice management in my code.
- The project will be licensed AGPL-3.0 (required by Strudel itself).

**How I want you to work:**

1. **Verify before claiming done.** After implementing each milestone, actually run `npm run dev`, open the page in a real browser (use Playwright via `npx playwright`), click the buttons, and confirm sound plays / the UI responds. Do not say a milestone is complete based on reading the code.

2. **Honest about uncertainty.** When you hit a `@strudel/web` API question you can't answer from the docs, say so and either consult the source on https://codeberg.org/uzu/strudel or write a tiny test page to discover the behavior. Don't guess and ship.

3. **Small commits.** After each milestone, suggest a git commit with a clear message. I'll review before you proceed.

4. **Stop on red.** If a milestone test fails, stop and tell me — don't paper over it with workarounds.

**First task:** Read `PLAN.md`, then `ARCHITECTURE.md`, then start on Milestone 1 (project scaffold + Strudel verification). When Milestone 1 passes its acceptance check, stop and show me what works.

The starter files in `scaffold/` are a hand-off from the previous Claude session. They were written without being run — treat them as a suggested starting point, not as verified working code. You're allowed to change them.
