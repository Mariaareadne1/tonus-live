/* ============================================================
   étude — code editor
   A textarea laid over a highlighted <pre>, with line numbers.
   Keeps native undo, so ctrl+z works the way people expect.
   ============================================================ */

import { highlight } from "./highlight.js";

const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "ctrl";

/**
 * @param {HTMLElement} root  element to fill
 * @param {{ value: string, onRun: () => void, onStop: () => void, onChange?: (value: string) => void }} opts
 */
export function createEditor(root, { value, onRun, onStop, onChange }) {
  root.classList.add("eb-code");
  root.innerHTML = `
    <div class="eb-gutter" aria-hidden="true"></div>
    <div class="eb-scroll">
      <div class="eb-edit">
        <pre class="eb-hl" aria-hidden="true"></pre>
        <textarea class="eb-input" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"
          aria-label="étude code — edit and press ${MOD_KEY}+enter to play"></textarea>
      </div>
    </div>`;
  const input = root.querySelector(".eb-input");
  const hl = root.querySelector(".eb-hl");
  const gutter = root.querySelector(".eb-gutter");
  let errorLine = 0;
  let active = new Set();

  const render = () => {
    hl.innerHTML = highlight(input.value, active) + "\n";
    const count = input.value.split("\n").length;
    gutter.innerHTML = Array.from({ length: count }, (_, i) =>
      `<span class="${i + 1 === errorLine ? "is-err" : ""}">${i + 1}</span>`).join("");
  };

  input.value = value;
  input.addEventListener("input", () => {
    active = new Set();
    render();
    onChange?.(input.value);
  });
  input.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      onRun();
    } else if (mod && e.key === ".") {
      e.preventDefault();
      onStop();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    }
  });
  render();

  return {
    input,
    get value() { return input.value; },
    /** Replace all text, keeping it undoable. */
    setValue(text) {
      input.focus();
      input.select();
      document.execCommand("insertText", false, text);
      if (input.value !== text) input.value = text;
      active = new Set();
      render();
      onChange?.(input.value);
    },
    setActive(next) {
      active = next;
      render();
    },
    setErrorLine(line) {
      errorLine = line;
      render();
    },
  };
}
