/* ============================================================
   étude — REPL page
   Editor + player + side panel (beats, sounds, reference,
   export to Strudel, console, settings).
   ============================================================ */

import { parse, EtudeError } from "./parser.js";
import { notesBetween } from "./timeline.js";
import { Engine } from "./engine.js";
import { createEditor } from "./editor.js";
import { drawRoll } from "./roll.js";
import { toStrudel, strudelUrl, toBase64, fromBase64 } from "./to-strudel.js";
import { playNote } from "./voices.js";
import { EXAMPLES } from "./examples.js";
import {
  INSTRUMENTS, DRUM_SOUNDS, BOWINGS, DYNAMICS, TONES, VIBRATOS, HALLS, NOTE_VALUES, SEATS,
  SPEEDS, TEMPO_MARKS, DEFAULT_DYNAMIC, DEFAULT_TONE,
} from "./vocab.js";

const STORE_CODE = "etude-repl-code";
const STORE_SETTINGS = "etude-repl-settings";
const STARTER = EXAMPLES[0].code;
const ROLL_LOOKBACK = 16;
const TOAST_MS = 1800;
const DEFAULT_SETTINGS = { fontSize: 15, lineNumbers: true, showRoll: true, highlightNotes: true, autosave: true };

const $ = (id) => document.getElementById(id);
const engine = new Engine();
const state = { program: null, evaluated: null, frame: 0, lastKey: "", settings: loadSettings() };

/* ---------- storage (never trusted, never required) ---------- */

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: fine */ }
}
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readStore(STORE_SETTINGS) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function initialCode() {
  const match = location.hash.match(/code=([^&]+)/);
  if (match) {
    try {
      return fromBase64(decodeURIComponent(match[1]));
    } catch {
      log("couldn't read the code in this link — loading the starter beat", "err");
    }
  }
  return (state.settings.autosave && readStore(STORE_CODE)) || STARTER;
}

/* ---------- editor + playback ---------- */

const editor = createEditor($("editor"), {
  value: initialCode(),
  onRun: run,
  onStop: stop,
  onChange: (value) => {
    if (state.settings.autosave) writeStore(STORE_CODE, value);
    renderExport(value);
  },
});

async function run() {
  const source = editor.value;
  let program;
  try {
    program = parse(source);
  } catch (err) {
    showError(err);
    return;
  }
  showError(null);
  state.program = program;
  state.evaluated = source;
  if (engine.isPlaying) {
    await engine.update(program);
    log(`updated · ${describe(program)}`, "ok");
  } else {
    await engine.play(program);
    document.body.classList.add("is-playing");
    setPlayLabel(true);
    log(`playing · ${describe(program)}`, "ok");
    loop();
  }
}

function stop() {
  if (!engine.isPlaying) return;
  engine.stop();
  cancelAnimationFrame(state.frame);
  document.body.classList.remove("is-playing");
  setPlayLabel(false);
  $("status").textContent = "";
  state.lastKey = "";
  editor.setActive(new Set());
  clearRoll();
  log("stopped");
}

function describe(program) {
  const parts = program.parts.map((p) => p.instrument + (p.label ? " " + p.label : ""));
  return `${program.tempo} bpm · ${parts.join(", ")}`;
}

function setPlayLabel(playing) {
  $("playBtn").querySelector(".rp-icon").textContent = playing ? "■" : "▶";
  $("playBtn").querySelector(".rp-label").textContent = playing ? "stop" : "play";
}

function showError(err) {
  const line = err instanceof EtudeError ? err.line : 0;
  editor.setErrorLine(line);
  $("error").hidden = !err;
  if (!err) return;
  const message = line ? `line ${line} · ${err.message}` : err.message;
  $("error").textContent = message;
  log(message, "err");
  if (!(err instanceof EtudeError)) console.error(err);
}

function loop() {
  if (!engine.isPlaying) return;
  const beat = engine.nowBeat();
  const { program } = state;
  const perBar = program.beatsPerBar;
  const b = Math.max(0, beat);
  $("status").textContent = `bar ${Math.floor(b / perBar) + 1} · beat ${Math.floor(b % perBar) + 1}`;

  if (state.settings.highlightNotes && editor.value === state.evaluated) {
    const sounding = notesBetween(program, beat - ROLL_LOOKBACK, beat + 1e-6).filter((n) => beat < n.beat + n.dur);
    const active = new Set(sounding.map((n) => n.event.range[0]));
    const key = [...active].sort().join(",");
    if (key !== state.lastKey) {
      state.lastKey = key;
      editor.setActive(active);
    }
  }
  if (state.settings.showRoll) {
    const canvas = $("roll");
    drawRoll(canvas, program, beat, { height: canvas.clientHeight, playhead: 0.5, minBeats: 16, dim: 0.5 });
  }
  state.frame = requestAnimationFrame(loop);
}

function clearRoll() {
  const canvas = $("roll");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

/* ---------- top bar ---------- */

$("playBtn").addEventListener("click", () => (engine.isPlaying ? stop() : run()));
$("updateBtn").addEventListener("click", run);
$("shareBtn").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.hash = `code=${encodeURIComponent(toBase64(editor.value))}`;
  history.replaceState(null, "", url);
  await copy(url.toString(), "link copied — anyone with it hears this piece");
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === ".") {
    e.preventDefault();
    stop();
  }
});

/* ---------- panel ---------- */

const tabs = [...document.querySelectorAll(".rp-tabs [data-tab]")];
function openTab(name) {
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  document.querySelectorAll(".rp-tab").forEach((p) => { p.hidden = p.dataset.pane !== name; });
  setPanel(true);
}
tabs.forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.goto)));

function setPanel(open) {
  document.body.classList.toggle("panel-closed", !open);
  $("panelBtn").setAttribute("aria-expanded", String(open));
}
$("panelBtn").addEventListener("click", () => setPanel(document.body.classList.contains("panel-closed")));
$("closePanel").addEventListener("click", () => setPanel(false));

/* beats */
$("examples").innerHTML = EXAMPLES.map((ex, i) =>
  `<li><button type="button" data-example="${i}"><strong>${ex.name}</strong><span>${ex.note}</span></button></li>`).join("");
$("examples").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-example]");
  if (!btn) return;
  editor.setValue(EXAMPLES[Number(btn.dataset.example)].code);
  run();
});

/* sounds */
const pitched = INSTRUMENTS.filter((i) => i !== "drums");
const PREVIEW_PITCH = { violin: 69, viola: 62, cello: 48, bass: 36, piano: 60, harp: 64, flute: 76, organ: 60 };
chips("instrumentChips", pitched, (name) => preview({ instrument: name, midi: PREVIEW_PITCH[name] }));
chips("drumChips", DRUM_SOUNDS, (name) => preview({ instrument: "drums", drum: name }));
chips("bowingChips", Object.keys(BOWINGS), (name) => preview({ instrument: "violin", midi: 69, bowing: BOWINGS[name] }));

function chips(id, names, onClick) {
  $(id).innerHTML = names.map((n) => `<button type="button" data-name="${n}">${n}</button>`).join("");
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("[data-name]");
    if (btn) onClick(btn.dataset.name);
  });
}

async function preview({ instrument, midi, drum, bowing = null }) {
  await engine.ensureContext();
  const isString = ["violin", "viola", "cello", "bass"].includes(instrument);
  playNote(engine.ctx, engine.master, {
    instrument, midi, drum,
    time: engine.ctx.currentTime + 0.02,
    seconds: 0.9,
    level: 1,
    params: {
      dynamic: DEFAULT_DYNAMIC,
      tone: DEFAULT_TONE,
      seat: 0,
      vibrato: isString || instrument === "flute" ? VIBRATOS.normal : VIBRATOS.none,
      bowing: bowing ?? (isString ? BOWINGS.detache : null),
    },
  });
}

/* reference */
const keys = (o) => Object.keys(o).map((k) => `<code>${k}</code>`).join(" ");
const REFERENCE = [
  ["tempo", `beats per minute, or ${keys(TEMPO_MARKS)}`],
  ["time 3/4", "time signature: beats in a bar"],
  ["key D major", "key signature for unmarked notes; <code>Fn</code> is a natural"],
  ["violin: | A4 B4 |", `start a part: ${INSTRUMENTS.map((i) => `<code>${i}</code>`).join(" ")}. A word after the instrument is a label.`],
  ["A4 C#5 Bb3", "notes: letter, accidental, octave (4 if left off)"],
  ["| … |", "a bar; its notes share it equally"],
  ["-  r", "tie (hold the note before) · rest"],
  ["(A4 B4)", "beamed group sharing one slot"],
  ["D4+A4", "double stop / chord"],
  ["A4*4", "repeat a note"],
  ["|: … :| x3", "repeat signs"],
  ["%", "simile: repeat the previous bar"],
  ["dynamics", `${keys(DYNAMICS)} or 0–1`],
  ["tone", `${keys(TONES)} or Hz`],
  ["vibrato", `${keys(VIBRATOS)} or width in cents`],
  ["bowing", `${keys(BOWINGS)}, or <code>attack 0.1 decay 0.1 sustain 0.5 release 0.2</code>`],
  ["echo 0.5 eighth 0.4", `amount, time (${keys(NOTE_VALUES)}), feedback`],
  ["hall", `${keys(HALLS)} or seconds`],
  ["seat", `${keys(SEATS)} or -1 to 1`],
  ["speed", `${keys(SPEEDS)} or a number — this part only`],
  ["tacet", "silence a part"],
  ["p f p f", "a list: one value per note, in turn"],
  ["| p | f |", "with bar lines: one value per bar"],
  ["p < ff > p", "hairpins: change smoothly across the part"],
  ["over 4", "stretch a hairpin across 4 bars"],
  ["let theme = | D5 E5 F5 G5 |", "name a phrase; put <code>| theme |</code> in any part to play it"],
  ["let soft = pp", "name a note, motif or value; use the name anywhere"],
  ["| theme x2 |", "play a phrase twice (also <code>* 2</code>)"],
  ["| theme up 5 |", "transpose a phrase by semitones (<code>down 12</code> for an octave lower)"],
  ["tempo 60 * 2", "any number can be a sum: <code>+ - * /</code> and parentheses"],
  ["repeat 4: | … |", "write bars several times"],
  ["repeat 4 as n: | theme up n |", "a loop with a counter: 1, 2, 3 …"],
  ["if n is last then | … | else | … |", "pick bars: <code>n is first</code>, <code>last</code>, <code>even</code>, <code>odd</code>, <code>n = 2</code>, <code>n &gt; 2</code>, <code>n is not 1</code>"],
  ["|: … |1. … :|2. … |", "first and second endings"],
  ["// note", "a comment"],
];
$("reference").innerHTML = `<dl class="rp-ref">${REFERENCE.map(([t, d]) => `<dt>${escapeHtml(t)}</dt><dd>${d}</dd>`).join("")}</dl>`;

/* export */
function renderExport(source) {
  let strudel;
  try {
    strudel = toStrudel(parse(source));
  } catch (err) {
    strudel = `// fix the étude code first:\n// ${err.message}`;
  }
  state.strudel = strudel;
  $("strudelOut").innerHTML = highlightStrudel(strudel);
  $("openStrudel").href = strudelUrl(strudel);
}

$("copyEtude").addEventListener("click", () => copy(editor.value, "étude copied"));
$("copyStrudel").addEventListener("click", () => copy(state.strudel, "Strudel code copied"));
$("downloadEtude").addEventListener("click", () => download(editor.value, "piece.etude"));
$("downloadStrudel").addEventListener("click", () => download(state.strudel, "piece.strudel.js"));

function highlightStrudel(code) {
  return code.split("\n").map((line) => {
    const at = line.indexOf("//");
    const body = at === -1 ? line : line.slice(0, at);
    const comment = at === -1 ? "" : `<span class="s-cm">${escapeHtml(line.slice(at))}</span>`;
    // strings first, so later spans' attribute quotes aren't mistaken for strings
    return escapeHtml(body)
      .replace(/("[^"]*")/g, '<span class="s-str">$1</span>')
      .replace(/\.([a-z]+)(?=\()/gi, '.<span class="s-fn">$1</span>')
      .replace(/(\$:)/g, '<span class="s-op">$1</span>') + comment;
  }).join("\n");
}

/* console */
function log(message, kind = "") {
  const li = document.createElement("li");
  li.className = kind ? `is-${kind}` : "";
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  li.innerHTML = `<time>${time}</time>`;
  li.append(document.createTextNode(message));
  const list = $("console");
  list.prepend(li);
  while (list.children.length > 200) list.lastChild.remove();
}

/* settings */
function applySettings() {
  const s = state.settings;
  document.body.style.setProperty("--code-size", `${s.fontSize}px`);
  document.body.classList.toggle("no-lines", !s.lineNumbers);
  document.body.classList.toggle("no-roll", !s.showRoll);
  if (!s.highlightNotes) editor.setActive(new Set());
  $("fontSize").value = s.fontSize;
  $("fontSizeOut").textContent = s.fontSize;
  ["lineNumbers", "showRoll", "highlightNotes", "autosave"].forEach((k) => { $(k).checked = s[k]; });
  writeStore(STORE_SETTINGS, JSON.stringify(s));
}
$("fontSize").addEventListener("input", (e) => {
  state.settings = { ...state.settings, fontSize: Number(e.target.value) };
  applySettings();
});
["lineNumbers", "showRoll", "highlightNotes", "autosave"].forEach((k) => {
  $(k).addEventListener("change", (e) => {
    state.settings = { ...state.settings, [k]: e.target.checked };
    applySettings();
  });
});
$("resetCode").addEventListener("click", () => editor.setValue(STARTER));

/* ---------- helpers ---------- */

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast("couldn't copy — select the text and copy it yourself");
  }
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer = 0;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, TOAST_MS);
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if (/Mac|iPhone|iPad/.test(navigator.platform)) {
  document.querySelectorAll("kbd[data-mod]").forEach((k) => { k.textContent = "⌘"; });
}
if (window.matchMedia("(max-width: 820px)").matches) setPanel(false);

applySettings();
renderExport(editor.value);
log("ready · press play or ctrl+enter");
