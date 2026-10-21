/* ============================================================
   étude — engine
   A look-ahead scheduler: every few milliseconds it asks the
   timeline for the notes coming up and hands them to the voices.
   Each part gets a small bus with its own echo and hall.
   ============================================================ */

import { notesBetween } from "./timeline.js";
import { playNote } from "./voices.js";

const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;
const START_DELAY_S = 0.06;
const HALL_WET = 0.38;
const ECHO_MAX_S = 4;
const TAIL_S = 6;   // let echoes and halls ring out after an update
const FADE_S = 0.08;

export class Engine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.program = null;
    this.buses = [];
    this.retired = [];
    this.startTime = 0;
    this.scheduledTo = 0;
    this.timer = null;
    this.irCache = new Map();
  }

  get isPlaying() {
    return this.program !== null;
  }

  secondsPerBeat(program = this.program) {
    return 60 / (program?.tempo ?? 100);
  }

  /** Current position in beats since play began. */
  nowBeat() {
    if (!this.ctx || !this.program) return 0;
    return (this.ctx.currentTime - this.startTime) / this.secondsPerBeat();
  }

  /** @param {import("./parser.js").Program} program */
  async play(program) {
    this.stop();
    await this.ensureContext();
    this.program = program;
    this.startTime = this.ctx.currentTime + START_DELAY_S;
    this.scheduledTo = 0;
    this.buses = this.buildBuses(program);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Swap in edited code without losing the beat. */
  update(program) {
    if (!this.isPlaying) return this.play(program);
    const beat = this.nowBeat();
    const ahead = this.scheduledTo - beat;
    this.program = program;
    this.startTime = this.ctx.currentTime - beat * this.secondsPerBeat(program);
    this.scheduledTo = beat + ahead;
    this.releaseBuses(this.buses, TAIL_S, 1);
    this.retired = [...this.retired, ...this.buses];
    this.buses = this.buildBuses(program);
    return Promise.resolve();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.program = null;
    this.releaseBuses([...this.buses, ...this.retired], 0, FADE_S);
    this.buses = [];
    this.retired = [];
  }

  /* ---------- internals ---------- */

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: "interactive" });
      const gain = this.ctx.createGain();
      gain.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      gain.connect(comp).connect(this.ctx.destination);
      this.master = gain;
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  tick() {
    if (!this.program) return;
    const spb = this.secondsPerBeat();
    const horizon = (this.ctx.currentTime + LOOKAHEAD_S - this.startTime) / spb;
    if (horizon <= this.scheduledTo) return;

    notesBetween(this.program, this.scheduledTo, horizon).forEach((n) => {
      const time = Math.max(this.ctx.currentTime, this.startTime + n.beat * spb);
      const bus = this.buses[n.partIndex];
      const sounds = n.part.instrument === "drums"
        ? n.event.drums.map((drum) => ({ drum }))
        : n.event.pitches.map((midi) => ({ midi }));
      const level = 1 / Math.sqrt(sounds.length);
      sounds.forEach((sound) => playNote(this.ctx, bus.input, {
        ...sound,
        instrument: n.part.instrument,
        time,
        seconds: n.dur * spb,
        params: n.params,
        level,
      }));
    });
    this.scheduledTo = horizon;
  }

  buildBuses(program) {
    const spb = this.secondsPerBeat(program);
    return program.parts.map((part) => {
      const input = this.ctx.createGain();
      const out = this.ctx.createGain();
      input.connect(out);
      out.connect(this.master);

      const { echo, hall } = part.mods;
      if (echo && echo.amount > 0) this.addEcho(input, out, echo, spb);
      if (hall) this.addHall(input, out, hall);
      return { input, out };
    });
  }

  addEcho(input, out, { amount, beats, feedback }, spb) {
    const delay = this.ctx.createDelay(ECHO_MAX_S + 1);
    delay.delayTime.value = Math.min(beats * spb, ECHO_MAX_S);
    const send = this.ctx.createGain();
    send.gain.value = amount;
    const loop = this.ctx.createGain();
    loop.gain.value = feedback;
    const warm = this.ctx.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 3800;
    input.connect(send).connect(delay);
    delay.connect(warm).connect(loop).connect(delay);
    delay.connect(out);
  }

  addHall(input, out, seconds) {
    const conv = this.ctx.createConvolver();
    conv.buffer = this.impulse(seconds);
    const wet = this.ctx.createGain();
    wet.gain.value = HALL_WET;
    input.connect(conv).connect(wet).connect(out);
  }

  impulse(seconds) {
    const key = Math.round(seconds * 10);
    if (!this.irCache.has(key)) {
      const rate = this.ctx.sampleRate;
      const length = Math.max(1, Math.floor(rate * seconds));
      const buf = this.ctx.createBuffer(2, length, rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
      }
      this.irCache.set(key, buf);
    }
    return this.irCache.get(key);
  }

  /* Fade a set of buses out after `delay` seconds, then unplug them. */
  releaseBuses(buses, delay, fade) {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + delay;
    buses.forEach(({ out }) => {
      out.gain.setTargetAtTime(0, at, fade / 3);
      setTimeout(() => out.disconnect(), (delay + fade * 2) * 1000);
    });
  }
}
