/* ============================================================
   étude — syntax colouring
   Turns source text into coloured HTML. Notes that are sounding
   right now (by source offset) get an extra "on" class.
   ============================================================ */

import { INSTRUMENTS, DRUM_SOUNDS, GLOBALS, MODIFIERS, VALUE_WORDS, PROGRAM_WORDS } from "./vocab.js";

const HEADER_RE = /^(\s*)([A-Za-z]+)((?:\s+[\w-]+)?)(\s*:)/;
const LET_RE = /^(\s*)(let)(\s+)([A-Za-z_][\w-]*)(\s*=\s*)/;
const SCORE_RE = /(:\|\d\.|\|\d\.|\|:|:\||\|)|([()])|(%)|(\*\d+|x\d+)|(-(?=\s|$|[|)]))|([*:])|([^\s|()*%:]+)|(\s+)/g;
const VALUE_RE = /([<>|])|([*/+()])|(-?\d*\.?\d+(?![\w#]))|([^\s<>|*/+()]+)|(\s+)/g;
const NOTE_RE = /^[A-Ga-g](##|#|bb|b|n|♯|♭)?(-?\d)?$/;
const NUMBER_RE = /^-?\d*\.?\d+$/;
const COMPARE_RE = /^(=|==|!=|<|>|<=|>=)$/;
const SCORE_KEYWORDS = new Set(PROGRAM_WORDS.filter((w) => w !== "r" && w !== "rest"));

/**
 * @param {string} text
 * @param {Set<number>} [active] source offsets of sounding notes
 * @returns {string}
 */
export function highlight(text, active = new Set()) {
  const names = declaredNames(text);
  let offset = 0;
  return text.split("\n").map((line) => {
    const html = highlightLine(line, offset, active, names);
    offset += line.length + 1;
    return html;
  }).join("\n");
}

/* Variable and loop-counter names, plus which variables are phrases. */
function declaredNames(text) {
  const vars = new Set();
  const phrases = new Set();
  text.split("\n").forEach((line) => {
    const m = line.replace(/\/\/.*$/, "").match(LET_RE);
    if (m) {
      vars.add(m[4]);
      const value = line.slice(m[0].length).trim();
      if (/^(\||repeat\b|if\b)/.test(value) || phrases.has(value.split(/\s+/)[0])) phrases.add(m[4]);
    }
    for (const c of line.matchAll(/\bas\s+([A-Za-z_]\w*)/g)) vars.add(c[1]);
  });
  return { vars, phrases };
}

function highlightLine(line, offset, active, names) {
  const commentAt = line.indexOf("//");
  const code = commentAt === -1 ? line : line.slice(0, commentAt);
  const comment = commentAt === -1 ? "" : span("tk-comment", line.slice(commentAt));
  return codeHtml(code, offset, active, names) + comment;
}

function codeHtml(code, offset, active, names) {
  const letLine = code.match(LET_RE);
  if (letLine) {
    const [whole, indent, kw, gap, name, eq] = letLine;
    const rest = code.slice(whole.length);
    const head = esc(indent) + span("tk-kw", kw) + esc(gap) + span("tk-var", name) + span("tk-punct", eq);
    return head + (names.phrases.has(name) ? scoreHtml(rest, offset + whole.length, active, names) : valuesHtml(rest, names));
  }

  const header = code.match(HEADER_RE);
  if (header && INSTRUMENTS.includes(header[2].toLowerCase())) {
    const [whole, indent, name, label, colon] = header;
    return esc(indent) + span("tk-inst", name) + span("tk-label", label) + span("tk-punct", colon)
      + scoreHtml(code.slice(whole.length), offset + whole.length, active, names);
  }

  const first = code.trim().split(/\s+/)[0] ?? "";
  if (code.trimStart().startsWith("|") || first === "repeat" || first === "if" || names.phrases.has(first)) {
    return scoreHtml(code, offset, active, names);
  }

  const lead = code.match(/^(\s*)(\S+)/);
  if (!lead) return esc(code);
  const word = lead[2].toLowerCase();
  const isKeyword = GLOBALS.includes(word) || MODIFIERS.includes(word);
  return esc(lead[1]) + span(isKeyword ? "tk-kw" : "", lead[2]) + valuesHtml(code.slice(lead[0].length), names);
}

function scoreHtml(text, offset, active, names) {
  return [...text.matchAll(SCORE_RE)].map((m) => {
    const [tok, bar, paren, simile, count, tie, op, word] = m;
    if (bar || simile) return span("tk-bar", tok);
    if (paren) return span("tk-paren", tok);
    if (count) return span("tk-num", tok);
    if (tie) return span("tk-tie", tok);
    if (op) return span("tk-punct", tok);
    if (word) {
      const on = active.has(offset + m.index) ? " tk-on" : "";
      return span(wordClass(word, names) + on, tok);
    }
    return esc(tok);
  }).join("");
}

function wordClass(word, names) {
  if (word === "r" || word === "rest") return "tk-rest";
  if (SCORE_KEYWORDS.has(word)) return "tk-kw";
  if (names.vars.has(word)) return "tk-var";
  if (NUMBER_RE.test(word)) return "tk-num";
  if (COMPARE_RE.test(word)) return "tk-punct";
  const pieces = word.split("+");
  const known = pieces.every((p) => NOTE_RE.test(p) || DRUM_SOUNDS.includes(p.toLowerCase()));
  return known ? "tk-note" : "tk-bad";
}

function valuesHtml(text, names) {
  return [...text.matchAll(VALUE_RE)].map((m) => {
    const [tok, mark, op, num, word] = m;
    if (mark) return span(mark === "|" ? "tk-bar" : "tk-pin", tok);
    if (op) return span("tk-punct", tok);
    if (num) return span("tk-num", tok);
    if (word && names.vars.has(word)) return span("tk-var", tok);
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
