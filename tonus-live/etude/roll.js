/* ============================================================
   étude — score roll
   Draws the notes around the playhead onto a canvas: pitches on
   top, drum lanes underneath, bar lines like a score. Brightness
   follows dynamics. Shared by the workshop blocks and the REPL.
   ============================================================ */

import { notesBetween } from "./timeline.js";
import { DRUM_SOUNDS } from "./vocab.js";

const PART_COLORS = ["--phosphor", "--pink", "--cyan", "--amber", "--purple"];
const LOOKBACK_BEATS = 16;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import("./parser.js").Program} program
 * @param {number} beat current position in beats
 * @param {{ height: number, playhead?: number, minBeats?: number, dim?: number }} opts
 */
export function drawRoll(canvas, program, beat, { height, playhead = 0.3, minBeats = 8, dim = 0.35 }) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);

  const span = Math.max(minBeats, program.beatsPerBar * 2);
  const from = beat - span * playhead;
  const to = from + span;
  const px = width / span;
  const lanes = rollLanes(program, height);
  const css = getComputedStyle(document.documentElement);

  // bar lines, like a score
  g.strokeStyle = css.getPropertyValue("--line-2");
  g.lineWidth = 1;
  for (let b = Math.ceil(from / program.beatsPerBar) * program.beatsPerBar; b < to; b += program.beatsPerBar) {
    const x = Math.round((b - from) * px) + 0.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, height);
    g.stroke();
  }

  notesBetween(program, from - LOOKBACK_BEATS, to).forEach((n) => {
    if (n.beat + n.dur < from) return;
    const color = css.getPropertyValue(PART_COLORS[n.partIndex % PART_COLORS.length]).trim();
    const on = beat >= n.beat && beat < n.beat + n.dur;
    const rows = n.part.instrument === "drums" ? n.event.drums.map(lanes.drumRow) : n.event.pitches.map(lanes.pitchRow);
    g.globalAlpha = (on ? 1 : dim) * (0.35 + 0.65 * Math.min(1, n.params.dynamic / 0.7));
    g.fillStyle = color;
    rows.forEach((y) => {
      g.fillRect((n.beat - from) * px, y, Math.max(2, n.dur * px - 1.5), lanes.rowHeight - 1);
    });
  });
  g.globalAlpha = 1;

  const head = Math.round(span * playhead * px) + 0.5;
  g.strokeStyle = css.getPropertyValue("--pink");
  g.beginPath();
  g.moveTo(head, 0);
  g.lineTo(head, height);
  g.stroke();
}

/* Vertical layout: pitches on top, drums in lanes below. */
function rollLanes(program, height) {
  const pitches = program.parts.flatMap((p) => p.events.flatMap((e) => e.pitches));
  const drums = [...new Set(program.parts.flatMap((p) => p.events.flatMap((e) => e.drums)))]
    .sort((a, b) => DRUM_SOUNDS.indexOf(a) - DRUM_SOUNDS.indexOf(b));
  const lo = pitches.length ? Math.min(...pitches) - 2 : 0;
  const hi = pitches.length ? Math.max(...pitches) + 2 : -1;
  const rowCount = Math.max(1, hi - lo + 1 + drums.length);
  const rowHeight = Math.max(3, Math.min(height / 12, height / rowCount));
  const top = Math.max(0, (height - rowHeight * rowCount) / 2);
  return {
    rowHeight,
    pitchRow: (midi) => top + (hi - midi) * rowHeight,
    drumRow: (drum) => top + (hi - lo + 1 + drums.indexOf(drum)) * rowHeight,
  };
}
