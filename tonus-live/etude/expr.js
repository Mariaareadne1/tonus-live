/* ============================================================
   étude — expressions
   Small arithmetic (+ − × ÷, parentheses) and the conditions
   used by `if`: comparisons plus even / odd / first / last.
   ============================================================ */

import { EtudeError } from "./errors.js";

const TOKEN_RE = /\d*\.\d+|\d+|[A-Za-z_][\w-]*|[-+*/()]/g;
const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)$/;
const OPS = new Set(["*", "/", "+", "-"]);

/**
 * @param {string} text
 * @param {(name: string) => number|undefined} lookup
 * @param {number} line
 * @returns {number}
 */
export function evalNumber(text, lookup, line) {
  const tokens = text.match(TOKEN_RE) ?? [];
  const pos = { i: 0 };
  if (tokens.length === 0) throw new EtudeError("Expected a number here.", line);
  const value = sum(tokens, pos, lookup, line);
  if (pos.i < tokens.length) throw new EtudeError(`I couldn't work out "${text}" as a number.`, line);
  if (!Number.isFinite(value)) throw new EtudeError(`"${text}" doesn't come out to a number (dividing by zero?).`, line);
  return value;
}

function sum(t, pos, lookup, line) {
  let value = product(t, pos, lookup, line);
  while (t[pos.i] === "+" || t[pos.i] === "-") {
    const op = t[pos.i++];
    const rhs = product(t, pos, lookup, line);
    value = op === "+" ? value + rhs : value - rhs;
  }
  return value;
}

function product(t, pos, lookup, line) {
  let value = unary(t, pos, lookup, line);
  while (t[pos.i] === "*" || t[pos.i] === "/") {
    const op = t[pos.i++];
    const rhs = unary(t, pos, lookup, line);
    value = op === "*" ? value * rhs : value / rhs;
  }
  return value;
}

function unary(t, pos, lookup, line) {
  if (t[pos.i] === "-") {
    pos.i++;
    return -unary(t, pos, lookup, line);
  }
  if (t[pos.i] === "(") {
    pos.i++;
    const value = sum(t, pos, lookup, line);
    if (t[pos.i++] !== ")") throw new EtudeError('A "(" is missing its ")".', line);
    return value;
  }
  const tok = t[pos.i++];
  if (tok === undefined) throw new EtudeError("An expression ends too early.", line);
  if (NUMBER_RE.test(tok)) return Number(tok);
  const value = lookup(tok);
  if (typeof value !== "number") throw new EtudeError(`"${tok}" isn't a number I know.`, line);
  return value;
}

/**
 * Evaluate runs like `0.25 * 2` or `120*1.5` inside a list of words.
 * Hyphenated names (dotted-eighth) and negative numbers are left alone.
 * @param {string[]} words
 * @param {number} line
 * @returns {string[]}
 */
export function foldArithmetic(words, line) {
  const pieces = words.flatMap((w) => (NUMBER_RE.test(w) ? [w] : w.split(/([*/+()])/).filter((p) => p !== "")));
  const out = [];
  let i = 0;
  while (i < pieces.length) {
    const end = arithmeticRunEnd(pieces, i);
    if (end > i + 1) {
      const value = evalNumber(pieces.slice(i, end).join(" "), () => undefined, line);
      out.push(String(Math.round(value * 1e6) / 1e6));
      i = end;
    } else {
      out.push(pieces[i]);
      i += 1;
    }
  }
  return out;
}

/* Longest run starting at i that alternates number/operator (parens allowed). */
function arithmeticRunEnd(pieces, start) {
  let i = start;
  let depth = 0;
  let expectValue = true;
  let lastGood = start;
  while (i < pieces.length) {
    const p = pieces[i];
    if (expectValue && p === "(") depth++;
    else if (expectValue && NUMBER_RE.test(p)) {
      expectValue = false;
      if (depth === 0) lastGood = i + 1;
    } else if (!expectValue && p === ")" && depth > 0) {
      depth--;
      if (depth === 0) lastGood = i + 1;
    } else if (!expectValue && OPS.has(p)) expectValue = true;
    else break;
    i++;
  }
  // only a real calculation if it contains an operator
  const run = pieces.slice(start, lastGood);
  return run.some((p) => OPS.has(p)) ? lastGood : start;
}

/**
 * @param {string} text  e.g. "n is even", "n = 4", "n is not last", "n > 2"
 * @param {Record<string, { value: number, count: number }>} loops
 * @param {number} line
 * @returns {boolean}
 */
export function evalCondition(text, loops, line) {
  const lookup = (name) => loops[name]?.value;
  const special = text.match(/^(.+?)\s+is\s+(not\s+)?(even|odd|first|last)$/);
  if (special) {
    const [, lhs, not, word] = special;
    const name = lhs.trim();
    const value = evalNumber(name, lookup, line);
    const count = loops[name]?.count;
    if ((word === "first" || word === "last") && count === undefined) {
      throw new EtudeError(`"${word}" needs a loop counter, like  if n is ${word} then …`, line);
    }
    const result = { even: value % 2 === 0, odd: value % 2 !== 0, first: value === 1, last: value === count }[word];
    return not ? !result : result;
  }
  const cmp = text.match(/^(.+?)\s*(>=|<=|!=|==|=|>|<|\bis not\b|\bis\b)\s*(.+)$/);
  if (!cmp) {
    throw new EtudeError(`I couldn't read the condition "${text}". Try  n = 4,  n > 2,  n is even  or  n is last.`, line);
  }
  const a = evalNumber(cmp[1], lookup, line);
  const b = evalNumber(cmp[3], lookup, line);
  switch (cmp[2]) {
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "!=": case "is not": return a !== b;
    default: return a === b;
  }
}
