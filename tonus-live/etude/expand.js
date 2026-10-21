/* ============================================================
   étude — score expansion
   Before bars are laid out, score tokens are expanded:
     | opening x2 |            phrase variables (repeat, up/down)
     | root - root - |         value variables spliced into bars
     repeat 4 as n: …          loops, with a counter
     if n is last then … else  conditionals
   Expanded tokens keep the source position of where they were
   written, so a sounding note lights up inside its `let`.
   ============================================================ */

import { EtudeError } from "./errors.js";
import { evalNumber, evalCondition } from "./expr.js";

const BAR_RE = /^(\||\|:|:\||\|\d\.|:\|\d\.)$/;
const MAX_DEPTH = 16;
const MAX_TIMES = 64;
const MAX_SHIFT = 48;

/**
 * @typedef {{ text: string, start: number, end: number, line: number, transpose?: number }} Token
 * @typedef {{ kind: "phrase"|"value", tokens: Token[], line: number }} Let
 * @typedef {{ lets: Map<string, Let>, loops: Record<string, { value: number, count: number }>, depth: number }} Ctx
 */

/**
 * @param {Token[]} tokens
 * @param {Ctx} ctx
 * @returns {Token[]}
 */
export function expandScore(tokens, ctx) {
  if (tokens.length === 0) return [];
  if (tokens[0].text === "repeat") return expandRepeat(tokens, ctx);
  const ifAt = tokens.findIndex((t) => t.text === "if");
  if (ifAt >= 0) return [...expandBars(tokens.slice(0, ifAt), ctx), ...expandIf(tokens.slice(ifAt), ctx)];
  return expandBars(tokens, ctx);
}

/** A name → number lookup for expressions: loop counters, then numeric lets. */
export function numberLookup(ctx) {
  return (name) => {
    if (ctx.loops[name]) return ctx.loops[name].value;
    const v = ctx.lets.get(name);
    if (v?.kind !== "value" || ctx.depth > MAX_DEPTH) return undefined;
    try {
      return evalNumber(v.tokens.map((t) => t.text).join(" "), numberLookup({ ...ctx, depth: ctx.depth + 1 }), v.line);
    } catch {
      return undefined;
    }
  };
}

/* ---------- loops and conditionals ---------- */

function expandRepeat(tokens, ctx) {
  const { line } = tokens[0];
  const colon = tokens.findIndex((t) => t.text === ":");
  if (colon === -1) {
    throw new EtudeError("Write repeat with a colon, like  repeat 4: | A4 B4 |  or  repeat 4 as n: …", line);
  }
  const head = tokens.slice(1, colon).map((t) => t.text);
  const asAt = head.indexOf("as");
  const name = asAt === -1 ? null : head[asAt + 1];
  if (asAt !== -1 && (head.length !== asAt + 2 || !/^[A-Za-z_]\w*$/.test(name ?? ""))) {
    throw new EtudeError('After "as", give the counter one name, like  repeat 4 as n:', line);
  }
  const count = evalNumber((asAt === -1 ? head : head.slice(0, asAt)).join(" "), numberLookup(ctx), line);
  if (!Number.isInteger(count) || count < 1 || count > MAX_TIMES) {
    throw new EtudeError(`repeat needs a whole number from 1 to ${MAX_TIMES}.`, line);
  }
  const body = tokens.slice(colon + 1);
  const out = [];
  for (let n = 1; n <= count; n++) {
    const loops = name ? { ...ctx.loops, [name]: { value: n, count } } : ctx.loops;
    out.push(...expandScore(body, { ...ctx, loops }));
  }
  return out;
}

function expandIf(tokens, ctx) {
  const { line } = tokens[0];
  const thenAt = tokens.findIndex((t) => t.text === "then");
  if (thenAt === -1) {
    throw new EtudeError("Write if with then, like  if n is last then | D5 - - - | else | A4 - - - |", line);
  }
  const elseAt = tokens.findIndex((t, i) => i > thenAt && t.text === "else");
  const condition = tokens.slice(1, thenAt).map((t) => t.text).join(" ");
  const yes = tokens.slice(thenAt + 1, elseAt === -1 ? undefined : elseAt);
  const no = elseAt === -1 ? [] : tokens.slice(elseAt + 1);
  return expandScore(evalCondition(condition, ctx.loops, line) ? yes : no, ctx);
}

/* ---------- bars, phrases, values ---------- */

function expandBars(tokens, ctx) {
  const out = [];
  let group = [];
  const flush = () => {
    if (group.length) out.push(...expandGroup(group, ctx));
    group = [];
  };
  tokens.forEach((t) => {
    if (BAR_RE.test(t.text)) {
      flush();
      out.push(t);
    } else {
      group.push(t);
    }
  });
  flush();
  return out;
}

function expandGroup(group, ctx) {
  const [head, ...rest] = group;
  const phrase = ctx.lets.get(head.text);
  if (phrase?.kind === "phrase") return expandPhraseRef(head, phrase, rest, ctx);
  return group.flatMap((t) => expandWord(t, ctx));
}

function expandWord(t, ctx) {
  if (ctx.loops[t.text]) {
    throw new EtudeError(`"${t.text}" is a counter — use it in  up ${t.text}  or  if ${t.text} = …`, t.line);
  }
  const v = ctx.lets.get(t.text);
  if (!v) return [t];
  if (v.kind === "phrase") {
    throw new EtudeError(`"${t.text}" is a phrase, so it fills whole bars. Put it between bar lines on its own, like  | ${t.text} |`, t.line);
  }
  const inner = deeper(ctx, t);
  return v.tokens.flatMap((x) => expandWord(shifted(x, t.transpose ?? 0), inner));
}

function expandPhraseRef(head, phrase, options, ctx) {
  const { times, shift } = readPhraseOptions(head, options, ctx);
  const inner = deeper(ctx, head);
  const body = expandScore(phrase.tokens, inner).map((t) => shifted(t, shift + (head.transpose ?? 0)));
  const bar = { text: "|", start: head.start, end: head.start, line: head.line };
  const out = [];
  for (let i = 0; i < times; i++) out.push(bar, ...body, bar);
  return out;
}

/* After a phrase name: x2, * 2, *2, up 5, down 12, up n * 2 … */
function readPhraseOptions(head, options, ctx) {
  const lookup = numberLookup(ctx);
  const { line } = head;
  let times = 1;
  let shift = 0;
  let i = 0;
  while (i < options.length) {
    const word = options[i].text;
    if (/^[x*]\d+$/.test(word)) {
      times *= Number(word.slice(1));
      i += 1;
    } else if (word === "x" || word === "*") {
      times *= evalNumber(options[i + 1]?.text ?? "", lookup, line);
      i += 2;
    } else if (word === "up" || word === "down") {
      let j = i + 1;
      const expr = [];
      while (j < options.length && !/^(x\d*|up|down)$/.test(options[j].text)) {
        expr.push(options[j].text.replace(/^\*(\d)/, "* $1"));
        j += 1;
      }
      const amount = evalNumber(expr.join(" "), lookup, line);
      shift += word === "up" ? amount : -amount;
      i = j;
    } else {
      throw new EtudeError(
        `"${head.text}" is a phrase, so it fills whole bars — give "${word}" its own bar. After a phrase name you can write x2, up 5 or down 12.`,
        line,
      );
    }
  }
  if (!Number.isInteger(times) || times < 1 || times > MAX_TIMES) {
    throw new EtudeError(`Repeat a phrase a whole number of times, 1 to ${MAX_TIMES}.`, line);
  }
  if (!Number.isInteger(shift) || Math.abs(shift) > MAX_SHIFT) {
    throw new EtudeError(`Transpose by whole semitones, up to ${MAX_SHIFT} (got ${shift}).`, line);
  }
  return { times, shift };
}

function deeper(ctx, t) {
  if (ctx.depth >= MAX_DEPTH) {
    throw new EtudeError(`"${t.text}" seems to refer to itself, so it would never end.`, t.line);
  }
  return { ...ctx, depth: ctx.depth + 1 };
}

function shifted(t, semitones) {
  return semitones ? { ...t, transpose: (t.transpose ?? 0) + semitones } : t;
}
