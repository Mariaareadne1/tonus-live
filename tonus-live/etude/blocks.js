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
import { drawRoll } from "./roll.js";

const engine = new Engine();
let activeBlock = null;

const ROLL_HEIGHT = 150;
const ROLL_PLAYHEAD = 0.3;          // playhead position, fraction of width
const ROLL_MIN_BEATS = 8;
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
    drawRoll(this.roll, this.program, beat, { height: ROLL_HEIGHT, playhead: ROLL_PLAYHEAD, minBeats: ROLL_MIN_BEATS });
  }
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
