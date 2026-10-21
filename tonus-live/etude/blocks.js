/* ============================================================
   étude — live code blocks
   Upgrades every <div class="etude"><textarea>…</textarea></div>
   into an editable, playable block with a score roll. Only one
   block plays at a time, like the Strudel workshop.
   ============================================================ */

import { parse, EtudeError } from "./parser.js";
import { notesBetween } from "./timeline.js";
import { highlight } from "./highlight.js";
import { Engine } from "./engine.js";
import { DRUM_SOUNDS } from "./vocab.js";

const engine = new Engine();
let activeBlock = null;

const ROLL_HEIGHT = 150;
const ROLL_PLAYHEAD = 0.3;          // playhead position, fraction of width
const ROLL_MIN_BEATS = 8;
const PART_COLORS = ["--phosphor", "--pink", "--cyan", "--amber", "--purple"];
const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "ctrl";

class Block {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.program = null;
    this.evaluated = null;
    this.lastActiveKey = "";
    this.frame = 0;
    this.compact = root.hasAttribute("data-compact");
    this.build(root.querySelector("textarea").value.replace(/^\n/, "").replace(/\s+$/, ""));
  }

  build(source) {
    this.root.innerHTML = `
      <div class="eb-bar">
        <button class="eb-btn eb-play" type="button" aria-label="Play"><span class="eb-icon">▶</span></button>
        <button class="eb-btn eb-update" type="button" aria-label="Update while playing" title="update (${MOD_KEY}+enter)"><span class="eb-icon">↻</span></button>
        <span class="eb-status" aria-live="polite"></span>
      </div>
      <div class="eb-code">
        <div class="eb-gutter" aria-hidden="true"></div>
        <div class="eb-scroll">
          <div class="eb-edit">
            <pre class="eb-hl" aria-hidden="true"></pre>
            <textarea class="eb-input" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"
              aria-label="étude code — edit and press ${MOD_KEY}+enter to play"></textarea>
          </div>
        </div>
      </div>
      <div class="eb-error" role="alert" hidden></div>
      <canvas class="eb-roll" hidden></canvas>`;
    this.input = this.root.querySelector(".eb-input");
    this.hl = this.root.querySelector(".eb-hl");
    this.gutter = this.root.querySelector(".eb-gutter");
    this.status = this.root.querySelector(".eb-status");
    this.error = this.root.querySelector(".eb-error");
    this.roll = this.root.querySelector(".eb-roll");
    this.playBtn = this.root.querySelector(".eb-play");

    this.input.value = source;
    this.playBtn.addEventListener("click", () => (this.isActive ? this.stop() : this.play()));
    this.root.querySelector(".eb-update").addEventListener("click", () => this.play());
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.render();
  }

  get isActive() {
    return activeBlock === this;
  }

  onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      this.play();
    } else if (mod && e.key === ".") {
      e.preventDefault();
      this.stop();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      // execCommand keeps the edit on the undo stack
      document.execCommand("insertText", false, "  ");
    }
  }

  /* Play, or apply edits if already playing. */
  async play() {
    const source = this.input.value;
    let program;
    try {
      program = parse(source);
    } catch (err) {
      this.showError(err);
      return;
    }
    this.showError(null);
    this.program = program;
    this.evaluated = source;

    if (this.isActive) {
      await engine.update(program);
    } else {
      activeBlock?.stop();
      activeBlock = this;
      await engine.play(program);
      this.setPlaying(true);
      this.loop();
    }
    this.flash();
  }

  stop() {
    if (!this.isActive) return;
    engine.stop();
    activeBlock = null;
    cancelAnimationFrame(this.frame);
    this.setPlaying(false);
    this.lastActiveKey = "";
    this.render();
  }

  setPlaying(on) {
    this.root.classList.toggle("is-playing", on);
    this.playBtn.querySelector(".eb-icon").textContent = on ? "■" : "▶";
    this.playBtn.setAttribute("aria-label", on ? "Stop" : "Play");
    this.roll.hidden = !on || this.compact;
    this.status.textContent = "";
  }

  flash() {
    this.root.classList.remove("is-flash");
    void this.root.offsetWidth;
    this.root.classList.add("is-flash");
  }

  showError(err) {
    const line = err instanceof EtudeError ? err.line : 0;
    this.errorLine = line;
    this.error.hidden = !err;
    this.error.textContent = err ? (line ? `line ${line} · ${err.message}` : err.message) : "";
    if (err && !(err instanceof EtudeError)) console.error(err);
    this.renderGutter();
  }

  /* ---------- drawing ---------- */

  render(active = new Set()) {
    const source = this.input.value;
    const live = this.isActive && source === this.evaluated ? active : new Set();
    this.hl.innerHTML = highlight(source, live) + "\n";
    this.renderGutter();
  }

  renderGutter() {
    const count = this.input.value.split("\n").length;
    this.gutter.innerHTML = Array.from({ length: count }, (_, i) =>
      `<span class="${i + 1 === this.errorLine ? "is-err" : ""}">${i + 1}</span>`).join("");
  }

  loop() {
    if (!this.isActive) return;
    const beat = engine.nowBeat();
    const sounding = notesBetween(this.program, beat - 16, beat + 1e-6).filter((n) => beat < n.beat + n.dur);
    const active = new Set(sounding.map((n) => n.event.range[0]));
    const key = [...active].sort().join(",");
    if (key !== this.lastActiveKey) {
      this.lastActiveKey = key;
      this.render(active);
    }
    this.updateStatus(beat);
    if (!this.compact) this.drawRoll(beat);
    this.frame = requestAnimationFrame(() => this.loop());
  }

  updateStatus(beat) {
    const perBar = this.program.beatsPerBar;
    const b = Math.max(0, beat);
    this.status.textContent = `bar ${Math.floor(b / perBar) + 1} · beat ${Math.floor(b % perBar) + 1}`;
  }

  drawRoll(beat) {
    const canvas = this.roll;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(ROLL_HEIGHT * dpr);
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, ROLL_HEIGHT);

    const { program } = this;
    const span = Math.max(ROLL_MIN_BEATS, program.beatsPerBar * 2);
    const from = beat - span * ROLL_PLAYHEAD;
    const to = from + span;
    const px = width / span;
    const lanes = rollLanes(program);
    const css = getComputedStyle(document.documentElement);

    // bar lines, like a score
    g.strokeStyle = css.getPropertyValue("--line-2");
    g.lineWidth = 1;
    for (let b = Math.ceil(from / program.beatsPerBar) * program.beatsPerBar; b < to; b += program.beatsPerBar) {
      const x = Math.round((b - from) * px) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, ROLL_HEIGHT);
      g.stroke();
    }

    notesBetween(program, from - 16, to).forEach((n) => {
      if (n.beat + n.dur < from) return;
      const color = css.getPropertyValue(PART_COLORS[n.partIndex % PART_COLORS.length]).trim();
      const on = beat >= n.beat && beat < n.beat + n.dur;
      const rows = n.part.instrument === "drums" ? n.event.drums.map(lanes.drumRow) : n.event.pitches.map(lanes.pitchRow);
      g.globalAlpha = (on ? 1 : 0.35) * (0.35 + 0.65 * Math.min(1, n.params.dynamic / 0.7));
      g.fillStyle = color;
      rows.forEach((y) => {
        const x = (n.beat - from) * px;
        g.fillRect(x, y, Math.max(2, n.dur * px - 1.5), lanes.rowHeight - 1);
      });
    });
    g.globalAlpha = 1;

    const head = Math.round(span * ROLL_PLAYHEAD * px) + 0.5;
    g.strokeStyle = css.getPropertyValue("--pink");
    g.beginPath();
    g.moveTo(head, 0);
    g.lineTo(head, ROLL_HEIGHT);
    g.stroke();
  }
}

/* Vertical layout for the roll: pitches on top, drums in lanes below. */
function rollLanes(program) {
  const pitches = program.parts.flatMap((p) => p.events.flatMap((e) => e.pitches));
  const drums = [...new Set(program.parts.flatMap((p) => p.events.flatMap((e) => e.drums)))]
    .sort((a, b) => DRUM_SOUNDS.indexOf(a) - DRUM_SOUNDS.indexOf(b));
  const lo = pitches.length ? Math.min(...pitches) - 2 : 0;
  const hi = pitches.length ? Math.max(...pitches) + 2 : -1;
  const rowCount = Math.max(1, hi - lo + 1 + drums.length);
  const rowHeight = Math.max(3, Math.min(10, ROLL_HEIGHT / rowCount));
  const top = (ROLL_HEIGHT - rowHeight * rowCount) / 2;
  return {
    rowHeight,
    pitchRow: (midi) => top + (hi - midi) * rowHeight,
    drumRow: (drum) => top + (hi - lo + 1 + drums.indexOf(drum)) * rowHeight,
  };
}

export function initBlocks() {
  const blocks = [...document.querySelectorAll(".etude")].map((el) => new Block(el));
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ".") activeBlock?.stop();
  });
  return blocks;
}

export function stopAll() {
  activeBlock?.stop();
}
