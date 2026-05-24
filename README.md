# tonus live (v2)

A browser-based live-coding instrument driven by [Strudel](https://strudel.cc).

UI is a fixed instrument panel — chord buttons, on-screen keyboard, drum grid, effect sliders. Under the hood every interaction generates a Strudel pattern and Strudel plays it.

## Status

Pre-alpha. See `PLAN.md` for the milestone roadmap.

## Run

```
npm install
npm run dev
```

Then open `http://localhost:5173`.

## License

**AGPL-3.0-or-later.** Strudel itself is AGPL, so anything built on top of it must be too. If you host this project on the web, the AGPL requires that you also provide the source code to users — keep a link to the repository visible.

## Credits

- [Strudel](https://strudel.cc) — pattern engine and audio playback
- The instrument-panel UI design is original to this project

## Honest notes for future maintainers

The first version of tonus tried to reimplement Strudel's pattern engine in raw Web Audio. It didn't work. This v2 takes the opposite approach: do not reimplement anything Strudel already does. Generate Strudel pattern strings and let Strudel play them.
