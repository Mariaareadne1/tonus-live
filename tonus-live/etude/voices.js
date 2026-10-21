/* ============================================================
   étude — voices
   One function per instrument family. Each builds a short-lived
   Web Audio graph for a single note and cleans itself up.
   ============================================================ */

import { STRINGS } from "./vocab.js";

const PEAK = 0.42;          // loudest single note before the master bus
const MIN_NOTE_S = 0.03;
const MAX_FILTER_HZ = 18000;

// Body resonances per string instrument: [Hz, gain dB] pairs.
const BODIES = {
  violin: [[290, 4], [1100, 3], [2900, 5]],
  viola:  [[230, 4], [900, 3], [2400, 4]],
  cello:  [[110, 5], [500, 3], [1500, 3]],
  bass:   [[70, 5], [300, 3], [900, 2]],
};

const PLUCK_DECAY = { harp: 0.7, default: 0.22 };

const noiseCache = new WeakMap();

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {{ instrument: string, midi?: number, drum?: string, time: number,
 *           seconds: number, params: import("./timeline.js").NoteParams, level: number }} note
 */
export function playNote(ctx, dest, note) {
  const out = ctx.createStereoPanner();
  out.pan.value = note.params.seat;
  out.connect(dest);

  const { instrument, params } = note;
  if (instrument === "drums") return playDrum(ctx, out, note);
  if (params.bowing?.pluck || instrument === "harp") return playPluck(ctx, out, note);
  if (STRINGS.includes(instrument)) return playString(ctx, out, note);
  if (instrument === "piano") return playPiano(ctx, out, note);
  return playWind(ctx, out, note);
}

/* ---------- families ---------- */

function playString(ctx, out, note) {
  const freq = mtof(note.midi);
  const env = bowedEnvelope(ctx, note);
  const filter = lowpass(ctx, note.params.tone, 0.6);
  const body = BODIES[note.instrument].reduce((node, [hz, db]) => {
    const peak = ctx.createBiquadFilter();
    peak.type = "peaking";
    peak.frequency.value = hz;
    peak.gain.value = db;
    peak.Q.value = 1.4;
    node.connect(peak);
    return peak;
  }, filter);
  body.connect(env.gain);
  env.gain.connect(out);

  const oscs = [-7, 7].map((cents) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = cents;
    osc.connect(filter);
    return osc;
  });
  addVibrato(ctx, oscs, note);
  startStop(oscs, note.time, env.end);
}

function playWind(ctx, out, note) {
  const freq = mtof(note.midi);
  const isOrgan = note.instrument === "organ";
  const env = bowedEnvelope(ctx, note, isOrgan ? ORGAN_ENVELOPE : FLUTE_ENVELOPE);
  const filter = lowpass(ctx, note.params.tone, 0.5);
  filter.connect(env.gain);
  env.gain.connect(out);

  const partials = isOrgan ? [[1, 1], [2, 0.5], [4, 0.25], [8, 0.08]] : [[1, 1], [2, 0.12], [3, 0.05]];
  const oscs = partials.map(([mult, amp]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * mult;
    const g = ctx.createGain();
    g.gain.value = amp * (isOrgan ? 0.9 : 1.5);
    osc.connect(g).connect(filter);
    return osc;
  });
  if (!isOrgan) addBreath(ctx, filter, note, env.end);
  addVibrato(ctx, oscs, note);
  startStop(oscs, note.time, env.end);
}

function playPluck(ctx, out, note) {
  const freq = mtof(note.midi);
  const decay = (PLUCK_DECAY[note.instrument] ?? PLUCK_DECAY.default) * (1 + Math.max(0, 60 - note.midi) / 30);
  const peak = PEAK * note.level * Math.pow(note.params.dynamic, 1.2) * 1.3;
  const end = note.time + decay * 6;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, note.time);
  gain.gain.linearRampToValueAtTime(peak, note.time + 0.003);
  gain.gain.setTargetAtTime(0, note.time + 0.003, decay);

  const filter = lowpass(ctx, Math.min(note.params.tone * 1.5, MAX_FILTER_HZ), 1.2);
  filter.frequency.setTargetAtTime(Math.min(400 + freq * 2, MAX_FILTER_HZ), note.time, decay * 0.6);
  filter.connect(gain).connect(out);

  const oscs = [["triangle", 1], ["sawtooth", 0.35]].map(([type, amp]) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = amp;
    osc.connect(g).connect(filter);
    return osc;
  });
  startStop(oscs, note.time, end);
}

function playPiano(ctx, out, note) {
  const freq = mtof(note.midi);
  const ring = 0.5 + Math.max(0, 72 - note.midi) / 40;
  const noteOff = note.time + Math.max(MIN_NOTE_S, note.seconds);
  const peak = PEAK * note.level * Math.pow(note.params.dynamic, 1.2);
  const end = noteOff + 0.6;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, note.time);
  gain.gain.linearRampToValueAtTime(peak, note.time + 0.004);
  gain.gain.setTargetAtTime(0, note.time + 0.004, ring);
  gain.gain.setTargetAtTime(0, noteOff, 0.08);

  const filter = lowpass(ctx, note.params.tone, 0.4);
  filter.connect(gain).connect(out);

  const oscs = [[1, 1], [2, 0.45], [3, 0.2], [4, 0.1]].map(([mult, amp]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * mult * (1 + 0.0004 * mult * mult);
    const g = ctx.createGain();
    g.gain.value = amp;
    osc.connect(g).connect(filter);
    return osc;
  });
  startStop(oscs, note.time, end);
}

/* ---------- drums ---------- */

const DRUMS = {
  kick:    (ctx, out, t, v) => sweep(ctx, out, t, v, { from: 150, to: 45, glide: 0.11, decay: 0.32, level: 1.4 }),
  tom:     (ctx, out, t, v) => sweep(ctx, out, t, v, { from: 220, to: 110, glide: 0.18, decay: 0.35, level: 1 }),
  snare:   (ctx, out, t, v) => {
    sweep(ctx, out, t, v, { from: 210, to: 180, glide: 0.05, decay: 0.09, level: 0.5 });
    burst(ctx, out, t, v, { type: "bandpass", hz: 1900, q: 0.8, decay: 0.16, level: 0.9 });
  },
  hat:     (ctx, out, t, v) => burst(ctx, out, t, v, { type: "highpass", hz: 7500, q: 0.7, decay: 0.045, level: 0.55 }),
  openhat: (ctx, out, t, v) => burst(ctx, out, t, v, { type: "highpass", hz: 7000, q: 0.7, decay: 0.3, level: 0.45 }),
  clap:    (ctx, out, t, v) => [0, 0.012, 0.024].forEach((d, i) =>
    burst(ctx, out, t + d, v, { type: "bandpass", hz: 1200, q: 1.2, decay: i === 2 ? 0.14 : 0.02, level: 0.8 })),
  rim:     (ctx, out, t, v) => burst(ctx, out, t, v, { type: "bandpass", hz: 1700, q: 6, decay: 0.03, level: 1.6 }),
  crash:   (ctx, out, t, v) => burst(ctx, out, t, v, { type: "highpass", hz: 4500, q: 0.5, decay: 0.9, level: 0.5 }),
};

function playDrum(ctx, out, note) {
  const filter = lowpass(ctx, note.params.tone * 2, 0.5);
  filter.connect(out);
  DRUMS[note.drum](ctx, filter, note.time, PEAK * note.level * Math.pow(note.params.dynamic, 1.1) * 1.6);
}

function sweep(ctx, out, t, v, { from, to, glide, decay, level }) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + glide);
  const g = ctx.createGain();
  g.gain.setValueAtTime(v * level, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(g).connect(out);
  startStop([osc], t, t + decay + 0.02);
}

function burst(ctx, out, t, v, { type, hz, q, decay, level }) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v * level, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(filter).connect(g).connect(out);
  startStop([src], t, t + decay + 0.02);
}

/* ---------- shared pieces ---------- */

const FLUTE_ENVELOPE = { attack: 0.06, decay: 0.15, sustain: 0.85, release: 0.15, length: 0.95 };
const ORGAN_ENVELOPE = { attack: 0.01, decay: 0.05, sustain: 1, release: 0.06, length: 0.97 };

/* attack → decay to sustain → hold for the bowed length → release. */
function bowedEnvelope(ctx, note, fallback = FLUTE_ENVELOPE) {
  const shape = note.params.bowing ?? fallback;
  const peak = PEAK * note.level * Math.pow(note.params.dynamic, 1.2);
  const held = Math.max(MIN_NOTE_S, note.seconds * (shape.length ?? 1));
  const attack = Math.min(shape.attack, held * 0.9);
  const release = Math.max(0.01, shape.release);
  const noteOff = note.time + held;

  const gain = ctx.createGain();
  const g = gain.gain;
  g.setValueAtTime(0, note.time);
  g.linearRampToValueAtTime(peak, note.time + Math.max(0.002, attack));
  g.setTargetAtTime(peak * shape.sustain, note.time + attack, Math.max(0.005, shape.decay / 3));
  g.setTargetAtTime(0, noteOff, release / 3);
  return { gain, end: noteOff + release * 2.5 + 0.05 };
}

function addVibrato(ctx, oscs, note) {
  const { rate, depth } = note.params.vibrato;
  if (!rate || !depth) return;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const amount = ctx.createGain();
  // vibrato blooms after the bow settles, as players do
  amount.gain.setValueAtTime(0, note.time);
  amount.gain.linearRampToValueAtTime(depth, note.time + Math.min(0.35, note.seconds * 0.5 + 0.05));
  lfo.connect(amount);
  oscs.forEach((osc) => amount.connect(osc.detune));
  startStop([lfo], note.time, note.time + note.seconds + 1);
}

function addBreath(ctx, dest, note, end) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = mtof(note.midi) * 2;
  band.Q.value = 2;
  const g = ctx.createGain();
  g.gain.value = 0.04;
  src.connect(band).connect(g).connect(dest);
  startStop([src], note.time, end);
}

function lowpass(ctx, hz, q) {
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = Math.min(Math.max(hz, 40), MAX_FILTER_HZ);
  f.Q.value = q;
  return f;
}

function startStop(sources, start, end) {
  sources.forEach((s) => {
    s.start(start);
    s.stop(end);
  });
}

function noise(ctx) {
  if (!noiseCache.has(ctx)) {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return noiseCache.get(ctx);
}

export function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
