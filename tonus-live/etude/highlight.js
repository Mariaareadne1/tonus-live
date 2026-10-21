/* ============================================================
   étude — syntax colouring
   Turns source text into coloured HTML. Notes that are sounding
   right now (by source offset) get an extra "on" class.
   ============================================================ */

import { INSTRUMENTS, DRUM_SOUNDS, GLOBALS, MODIFIERS, VALUE_WORDS } from "./vocab.js";

const HEADER_RE = /^(\s*)([A-Za-z]+)((?:\s+[\w-]+)?)(\s*:)/;
const SCORE_RE = /(\|:|:\||\|)|([()])|(%)|(\*\d+|x\d+)|(-(?=\s|$|[|)]))|([^\s|()*%]+)|(\s+)/g;
const VALUE_RE = /([<>|])|(-?\d*\.?\d+(?![\w#]))|([^\s<>|]+)|(\s+)/g;
const NOTE_RE = /^[A-Ga-g](##|#|bb|b|n|♯|♭)?(-?\d)?$/;

/**
 * @param {string} text
 * @param {Set<number>} [active] source offsets of sounding notes
 * @returns {string}
 */
export function highlight(text, active = new Set()) {
  let offset = 0;
  return text.split("\n").map((line) => {
    const html = highlightLine(line, offset, active);
    offset += line.length + 1;
    return html;
  }).join("\n");
}

function highlightLine(line, offset, active) {
  const commentAt = line.indexOf("//");
  const code = commentAt === -1 ? line : line.slice(0, commentAt);
  const comment = commentAt === -1 ? "" : span("tk-comment", line.slice(commentAt));
  return codeHtml(code, offset, active) + comment;
}

function codeHtml(code, offset, active) {
  const header = code.match(HEADER_RE);
  if (header && INSTRUMENTS.includes(header[2].toLowerCase())) {
    const [whole, indent, name, label, colon] = header;
    return esc(indent) + span("tk-inst", name) + span("tk-label", label) + span("tk-punct", colon)
      + scoreHtml(code.slice(whole.length), offset + whole.length, active);
  }
  if (code.trimStart().startsWith("|")) return scoreHtml(code, offset, active);

  const lead = code.match(/^(\s*)(\S+)/);
  if (!lead) return esc(code);
  const word = lead[2].toLowerCase();
  const isKeyword = GLOBALS.includes(word) || MODIFIERS.includes(word);
  return esc(lead[1]) + span(isKeyword ? "tk-kw" : "", lead[2]) + valuesHtml(code.slice(lead[0].length));
}

function scoreHtml(text, offset, active) {
  return [...text.matchAll(SCORE_RE)].map((m) => {
    const [tok, bar, paren, simile, count, tie, word] = m;
    if (bar) return span("tk-bar", tok);
    if (paren) return span("tk-paren", tok);
    if (simile) return span("tk-bar", tok);
    if (count) return span("tk-num", tok);
    if (tie) return span("tk-tie", tok);
    if (word) {
      const on = active.has(offset + m.index) ? " tk-on" : "";
      return span(wordClass(word) + on, tok);
    }
    return esc(tok);
  }).join("");
}

function wordClass(word) {
  if (word === "r" || word === "rest") return "tk-rest";
  const pieces = word.split("+");
  const known = pieces.every((p) => NOTE_RE.test(p) || DRUM_SOUNDS.includes(p.toLowerCase()));
  return known ? "tk-note" : "tk-bad";
}

function valuesHtml(text) {
  return [...text.matchAll(VALUE_RE)].map((m) => {
    const [tok, mark, num, word] = m;
    if (mark) return span(mark === "|" ? "tk-bar" : "tk-pin", tok);
    if (num) return span("tk-num", tok);
    if (word) return span(VALUE_WORDS.has(word.toLowerCase()) || NOTE_RE.test(word) ? "tk-val" : "", tok);
    return esc(tok);
  }).join("");
}

function span(cls, text) {
  if (!text) return "";
  return cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text);
}

function esc(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
