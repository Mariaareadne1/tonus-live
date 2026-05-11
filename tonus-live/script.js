/* ============================================================
   TONUS · model 02 — live-coding instrument
   Strudel-mapped effects · harmony engine · layer recorder
   Built on the Web Audio API. Zero dependencies.
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  /* =========================================================
     1. AUDIO CONTEXT + MASTER SIGNAL CHAIN
     =========================================================
     Each voice → engine (osc) → ADSR envGain → voiceLevel (polyphony scale)
                → masterPan → masterHPF → masterLPF (+lpq) → crush
                → clipper → roomMix (dry+wet via convolver) → delayMix
                → globalGain → analyserBus → destination
  */

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // === Master FX chain ===
  const globalGain   = audioCtx.createGain();   // .gain()
  const masterLPF    = audioCtx.createBiquadFilter();
  const masterHPF    = audioCtx.createBiquadFilter();
  const masterPan    = audioCtx.createStereoPanner();
  const crushNode    = audioCtx.createWaveShaper();
  const clipNode     = audioCtx.createWaveShaper();

  // Room (reverb via convolver) — wet/dry mix.
  const roomDry      = audioCtx.createGain();
  const roomWet      = audioCtx.createGain();
  const convolver    = audioCtx.createConvolver();
  const roomBus      = audioCtx.createGain();   // post-room sum

  // Delay (feedback delay) — wet/dry mix.
  const delayDry     = audioCtx.createGain();
  const delayWet     = audioCtx.createGain();
  const delayNode    = audioCtx.createDelay(2.0);
  const delayFB      = audioCtx.createGain();
  const delayBus     = audioCtx.createGain();

  const analyserBus  = audioCtx.createAnalyser();
  const recorderTap  = audioCtx.createMediaStreamDestination();

  globalGain.gain.value = 0.30;
  masterLPF.type        = "lowpass";
  masterLPF.frequency.value = 2000;
  masterLPF.Q.value         = 1.0;
  masterHPF.type        = "highpass";
  masterHPF.frequency.value = 0.0001;   // ~off when slider is at 0
  masterPan.pan.value   = 0;
  analyserBus.fftSize   = 2048;

  // crush + clip both use waveshaper curves we can update live
  crushNode.curve = makeIdentityCurve();
  crushNode.oversample = "2x";
  clipNode.curve  = makeIdentityCurve();
  clipNode.oversample = "2x";

  // Convolver impulse: a short noise tail for "room"
  convolver.buffer = makeImpulseResponse(audioCtx, 1.6, 2.5);

  // Initial wet/dry: fully dry
  roomDry.gain.value = 1.0;
  roomWet.gain.value = 0.0;
  delayDry.gain.value = 1.0;
  delayWet.gain.value = 0.0;
  delayNode.delayTime.value = 0.25;
  delayFB.gain.value = 0.35;

  /* === Chain wiring ===
     voices fan in to masterPan → masterHPF → masterLPF → crush → clip
     → SPLIT into (roomDry, roomWet→convolver) → roomBus
     → SPLIT into (delayDry, delayWet→delay loop) → delayBus
     → globalGain → analyserBus → destination
  */
  masterPan.connect(masterHPF);
  masterHPF.connect(masterLPF);
  masterLPF.connect(crushNode);
  crushNode.connect(clipNode);

  // Room split
  clipNode.connect(roomDry);
  clipNode.connect(roomWet);
  roomWet.connect(convolver);
  roomDry.connect(roomBus);
  convolver.connect(roomBus);

  // Delay split (post-room)
  roomBus.connect(delayDry);
  roomBus.connect(delayWet);
  delayWet.connect(delayNode);
  delayNode.connect(delayFB);
  delayFB.connect(delayNode);   // feedback loop
  delayNode.connect(delayBus);
  delayDry.connect(delayBus);

  // Final stage
  delayBus.connect(globalGain);
  globalGain.connect(analyserBus);
  analyserBus.connect(audioCtx.destination);
  analyserBus.connect(recorderTap);

  /* =========================================================
     1a. HELPER: build a noisy IR + identity / nonlinear curves
     ========================================================= */

  function makeImpulseResponse(ctx, durationSec, decay) {
    const rate = ctx.sampleRate;
    const len = Math.round(rate * durationSec);
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }

  function makeIdentityCurve() {
    const c = new Float32Array(257);
    for (let i = 0; i < c.length; i++) c[i] = (i / 128) - 1;
    return c;
  }

  function makeCrushCurve(steps) {
    // Bit crush: quantize to N levels.
    const c = new Float32Array(2049);
    const half = (c.length - 1) / 2;
    for (let i = 0; i < c.length; i++) {
      const x = (i - half) / half;
      c[i] = Math.round(x * steps) / steps;
    }
    return c;
  }

  function makeClipCurve(amount) {
    // Soft clip: tanh-like saturation. amount in 0..1.
    const c = new Float32Array(2049);
    const half = (c.length - 1) / 2;
    const k = 1 + amount * 50;
    for (let i = 0; i < c.length; i++) {
      const x = (i - half) / half;
      c[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    return c;
  }

  /* =========================================================
     2. CONSTANTS
     ========================================================= */

  const MAX_POLY_GAIN = 0.40;
  const FILT_ENV_ATTACK = 0.005;
  const FILT_ENV_DECAY  = 0.20;
  const FILT_ENV_AMOUNT = 4500;

  // === Harmony engine (preserved from model 01) ===

  const ROOT_NAMES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];

  const CHORD_TABLE = [
    { offset:  0, intervals: [0, 4, 7, 11, 14], label: "I"   },
    { offset:  1, intervals: [0, 4, 7, 10, 14], label: "♭II" },
    { offset:  2, intervals: [0, 3, 7, 10, 14], label: "ii"  },
    { offset:  3, intervals: [0, 4, 7, 10, 14], label: "♭III"},
    { offset:  4, intervals: [0, 3, 7, 10, 14], label: "iii" },
    { offset:  5, intervals: [0, 4, 7, 11, 14], label: "IV"  },
    { offset:  6, intervals: [0, 4, 7, 10, 14], label: "V/V" },
    { offset:  7, intervals: [0, 4, 7, 10, 14], label: "V"   },
    { offset:  8, intervals: [0, 4, 7, 10, 14], label: "♭VI" },
    { offset:  9, intervals: [0, 3, 7, 10, 14], label: "vi"  },
    { offset: 10, intervals: [0, 4, 7, 10, 14], label: "♭VII"},
    { offset: 11, intervals: [0, 3, 6, 10, 13], label: "vii°"},
  ];

  function chordSemitones(degree, root, complexity) {
    const e = CHORD_TABLE[degree];
    if (!e) return null;
    const n = 3 + Math.max(0, Math.min(2, complexity));
    const out = [];
    for (let i = 0; i < n; i++) out.push(root + e.offset + e.intervals[i]);
    return { notes: out, label: e.label, chordRoot: root + e.offset };
  }

  function semitoneToHz(s) {
    // s is semitones from C4 = MIDI 60. C4 = 261.6256 Hz.
    return 261.6256 * Math.pow(2, s / 12);
  }

  // Convert semitone offset (relative to C4) into a Strudel-style note name
  // like "c4", "d#4", "bb3". We always use "#"-style accidentals.
  function semitoneToStrudelNote(s) {
    const midi = 60 + s;
    const octave = Math.floor(midi / 12) - 1;
    const pc = ((midi % 12) + 12) % 12;
    const names = ["c","c#","d","d#","e","f","f#","g","g#","a","a#","b"];
    return `${names[pc]}${octave}`;
  }

  const LOWER_OCTAVE_CODES = [
    "90","83","88","68","67","86","71","66","72","78","74","77",
  ];
  const LOWER_OCTAVE_DEGREE = {};
  LOWER_OCTAVE_CODES.forEach((c, i) => { LOWER_OCTAVE_DEGREE[c] = i; });

  // Base key→semitone map (semitones from C4). Octave shift adds to all values.
  const KEY_SEMITONE_BASE = {
    "90":  0, "83":  1, "88":  2, "68":  3, "67":  4, "86":  5,
    "71":  6, "66":  7, "72":  8, "78":  9, "74": 10, "77": 11,
    "81": 12, "50": 13, "87": 14, "51": 15, "69": 16, "82": 17,
    "53": 18, "84": 19, "54": 20, "89": 21, "55": 22, "85": 23,
  };
  let octaveShift = 0;   // in semitones (multiples of 12)

  function keyToHz(keyCode) {
    const semi = KEY_SEMITONE_BASE[keyCode];
    if (semi === undefined) return null;
    return semitoneToHz(semi + octaveShift);
  }
  function keyToSemitone(keyCode) {
    const semi = KEY_SEMITONE_BASE[keyCode];
    if (semi === undefined) return null;
    return semi + octaveShift;
  }

  const KEY_DISPLAY = [
    { code: "90", label: "Z", note: "C",   black: false },
    { code: "83", label: "S", note: "C♯",  black: true  },
    { code: "88", label: "X", note: "D",   black: false },
    { code: "68", label: "D", note: "D♯",  black: true  },
    { code: "67", label: "C", note: "E",   black: false },
    { code: "86", label: "V", note: "F",   black: false },
    { code: "71", label: "G", note: "F♯",  black: true  },
    { code: "66", label: "B", note: "G",   black: false },
    { code: "72", label: "H", note: "G♯",  black: true  },
    { code: "78", label: "N", note: "A",   black: false },
    { code: "74", label: "J", note: "A♯",  black: true  },
    { code: "77", label: "M", note: "B",   black: false },
    { code: "81", label: "Q", note: "C",   black: false },
    { code: "50", label: "2", note: "C♯",  black: true  },
    { code: "87", label: "W", note: "D",   black: false },
    { code: "51", label: "3", note: "D♯",  black: true  },
    { code: "69", label: "E", note: "E",   black: false },
    { code: "82", label: "R", note: "F",   black: false },
    { code: "53", label: "5", note: "F♯",  black: true  },
    { code: "84", label: "T", note: "G",   black: false },
    { code: "54", label: "6", note: "G♯",  black: true  },
    { code: "89", label: "Y", note: "A",   black: false },
    { code: "55", label: "7", note: "A♯",  black: true  },
    { code: "85", label: "U", note: "B",   black: false },
  ];

  /* =========================================================
     3. UI HANDLES
     ========================================================= */

  const $ = (id) => document.getElementById(id);
  const startBtn   = $("startBtn");
  const recordBtn  = $("recordBtn");

  const ui = {
    // 01 TONE
    soundPick:  $("soundPick"),
    gain:       $("gain"),
    preset:     $("preset"),

    // 02 FILTER
    lpf:        $("lpf"),
    lpq:        $("lpq"),
    hpf:        $("hpf"),

    // 03 ENVELOPE
    attack:     $("attack"),
    decay:      $("decay"),
    sustain:    $("sustain"),
    release:    $("release"),

    // 04 FX
    room:       $("room"),
    delay:      $("delay"),
    delaytime:  $("delaytime"),
    pan:        $("pan"),
    crush:      $("crush"),
    clip:       $("clip"),

    // harmony (preserved)
    chordMode:  $("chordMode"),
    tonalRoot:  $("tonalRoot"),
    complexity: $("complexity"),
    bassToggle: $("bassToggle"),
    arpToggle:  $("arpToggle"),
    arpRate:    $("arpRate"),

    // drums
    bpm:        $("bpm"),
  };

  /* =========================================================
     4. SLIDER → REAL VALUE MAPPING
     ========================================================= */
  // Each slider is 0–100 in the UI. mapEffect(name) returns the natural
  // value. Mapping is also used both for the actual audio param AND for
  // the generated Strudel code (so what you see matches what plays).

  function lerp(a, b, t) { return a + (b - a) * t; }
  function logLerp(a, b, t) {
    // log-mapped for frequency-like sliders
    return a * Math.pow(b / a, t);
  }

  const EFFECT_MAP = {
    // 01 TONE
    gain:      v => +(lerp(0,    1.0,   v/100)).toFixed(2),    // 0..1
    // 02 FILTER
    lpf:       v => v === 0 ? 200 : Math.round(logLerp(200, 12000, v/100)),
    lpq:       v => +(lerp(0.1,  18,    v/100)).toFixed(1),    // 0.1..18
    hpf:       v => v === 0 ? 0   : Math.round(logLerp(40,  3000,  v/100)),
    // 03 ENVELOPE (seconds)
    attack:    v => +(lerp(0.001, 2,    v/100)).toFixed(3),
    decay:     v => +(lerp(0.001, 2,    v/100)).toFixed(3),
    sustain:   v => +(lerp(0,     1,    v/100)).toFixed(2),
    release:   v => +(lerp(0.001, 4,    v/100)).toFixed(3),
    // 04 FX
    room:      v => +(lerp(0,    1.0,   v/100)).toFixed(2),    // 0..1
    delay:     v => +(lerp(0,    1.0,   v/100)).toFixed(2),    // 0..1 (wet mix)
    delaytime: v => +(lerp(0.05, 1.0,   v/100)).toFixed(2),    // seconds
    pan:       v => +(lerp(0,    1.0,   v/100)).toFixed(2),    // 0=L 1=R
    crush:     v => v === 0 ? 0 : Math.round(lerp(16, 1, v/100)), // 16=clean 1=destroyed
    clip:      v => +(lerp(0,    1.0,   v/100)).toFixed(2),
  };

  function fxValue(name) {
    const el = ui[name];
    if (!el) return 0;
    return EFFECT_MAP[name](Number(el.value));
  }

  // Pretty-printer for the readout next to each slider.
  function fxFormat(name, raw) {
    switch (name) {
      case "lpf":
      case "hpf":
        return raw === 0 ? "off" : String(raw);
      case "lpq":
        return raw.toFixed(1);
      case "attack":
      case "decay":
      case "release":
      case "delaytime":
        return raw.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
      case "sustain":
      case "gain":
      case "room":
      case "delay":
      case "pan":
      case "clip":
        return raw.toFixed(2);
      case "crush":
        return raw === 0 ? "off" : String(raw);
    }
    return String(raw);
  }

  // Wire up each effect slider: update its readout AND the audio graph
  // immediately on input. This is the live binding.
  function bindEffectSlider(name) {
    const el = ui[name];
    if (!el) return;
    const out = document.querySelector(`output[for="${el.id}"]`);
    const update = () => {
      const raw = fxValue(name);
      if (out) out.textContent = fxFormat(name, raw);
      applyMasterParam(name, raw);
      updateAdsrSummary();
    };
    el.addEventListener("input", update);
    update();
  }

  ["gain","lpf","lpq","hpf","attack","decay","sustain","release",
   "room","delay","delaytime","pan","crush","clip"].forEach(bindEffectSlider);

  function updateAdsrSummary() {
    const s = $("adsrSummary");
    if (!s) return;
    s.textContent = [
      fxValue("attack"), fxValue("decay"),
      fxValue("sustain"), fxValue("release")
    ].map(v => v.toString()).join(" : ");
  }
  updateAdsrSummary();

  // Sound picker
  ui.soundPick.addEventListener("change", () => {
    const out = document.querySelector(`output[for="${ui.soundPick.id}"]`);
    if (out) out.textContent = ui.soundPick.value;
  });
  // Initial fill
  (function initSoundReadout(){
    const out = document.querySelector(`output[for="${ui.soundPick.id}"]`);
    if (out) out.textContent = ui.soundPick.value;
  })();

  /* =========================================================
     5. APPLY EFFECT TO AUDIO GRAPH
     ========================================================= */

  function applyMasterParam(name, raw) {
    const now = audioCtx.currentTime;
    switch (name) {
      case "gain":
        globalGain.gain.setTargetAtTime(raw, now, 0.01);
        break;
      case "lpf":
        masterLPF.frequency.setTargetAtTime(Math.max(20, raw), now, 0.01);
        break;
      case "lpq":
        masterLPF.Q.setTargetAtTime(raw, now, 0.01);
        break;
      case "hpf":
        masterHPF.frequency.setTargetAtTime(Math.max(0.0001, raw), now, 0.01);
        break;
      case "pan":
        // raw is 0..1, panner expects -1..1
        masterPan.pan.setTargetAtTime(raw * 2 - 1, now, 0.01);
        break;
      case "room": {
        // wet/dry crossfade
        const wet = raw;
        const dry = Math.sqrt(1 - wet * wet);   // equal-power
        roomWet.gain.setTargetAtTime(wet, now, 0.02);
        roomDry.gain.setTargetAtTime(dry, now, 0.02);
        break;
      }
      case "delay": {
        const wet = raw;
        const dry = Math.sqrt(1 - wet * wet);
        delayWet.gain.setTargetAtTime(wet * 0.7, now, 0.02);
        delayDry.gain.setTargetAtTime(dry, now, 0.02);
        delayFB.gain.setTargetAtTime(0.2 + wet * 0.35, now, 0.02);
        break;
      }
      case "delaytime":
        delayNode.delayTime.setTargetAtTime(raw, now, 0.02);
        break;
      case "crush":
        crushNode.curve = raw === 0
          ? makeIdentityCurve()
          : makeCrushCurve(Math.max(1, raw));
        break;
      case "clip":
        clipNode.curve = raw === 0
          ? makeIdentityCurve()
          : makeClipCurve(raw);
        break;
      // attack/decay/sustain/release apply per-note (in startVoice).
    }
  }

  /* =========================================================
     6. START BUTTON
     ========================================================= */

  let audioReady = false;
  startBtn.addEventListener("click", async () => {
    await audioCtx.resume();
    audioReady = true;
    startBtn.classList.add("is-on");
    startBtn.querySelector(".btn-label").textContent = "ONLINE";
  });

  /* =========================================================
     7. VOICE BUILDER — picks engine from .sound() picker
     ========================================================= */

  // Single-osc voice. Strudel's .sound("sawtooth") maps directly to an
  // OscillatorNode type. GM instruments fall back to a layered partial mix
  // that approximates the timbre (we have no samples).
  function buildVoice(freq, dest, now) {
    const sound = ui.soundPick.value;
    if (["sawtooth","square","triangle","sine"].includes(sound)) {
      const osc = audioCtx.createOscillator();
      osc.type = sound;
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(dest);
      osc.start(now);
      return { stop: (t) => safeStop(osc, t) };
    }
    // GM approximations: layered additive partials with characterful weights.
    return buildGMVoice(sound, freq, dest, now);
  }

  // Lightweight GM emulation via partial weighting + base waveform.
  // Strudel uses real soundfonts; we ballpark the timbre so the local
  // playback gives a sense of the patch.
  const GM_RECIPES = {
    gm_acoustic_grand_piano:   { type: "triangle", partials: [1, 0.6, 0.3, 0.15, 0.08], detune: 2 },
    gm_acoustic_guitar_nylon:  { type: "triangle", partials: [1, 0.5, 0.4, 0.2, 0.1],   detune: 4 },
    gm_electric_guitar_muted:  { type: "sawtooth", partials: [1, 0.35, 0.15],           detune: 6 },
    gm_acoustic_bass:          { type: "triangle", partials: [1, 0.3, 0.1],             detune: 0 },
    gm_synth_bass_1:           { type: "sawtooth", partials: [1, 0.5, 0.25, 0.1],       detune: 5 },
    gm_violin:                 { type: "sawtooth", partials: [1, 0.7, 0.5, 0.3, 0.2],   detune: 8 },
    gm_flute:                  { type: "sine",     partials: [1, 0.15, 0.05],           detune: 3 },
    gm_voice_oohs:             { type: "sine",     partials: [1, 0.4, 0.15, 0.05],      detune: 10 },
    gm_synth_strings_1:        { type: "sawtooth", partials: [1, 0.5, 0.3, 0.2, 0.1],   detune: 12 },
    gm_lead_1_square:          { type: "square",   partials: [1, 0.0, 0.3],             detune: 4 },
    gm_lead_2_sawtooth:        { type: "sawtooth", partials: [1, 0.4, 0.2],             detune: 6 },
    gm_xylophone:              { type: "sine",     partials: [1, 0.0, 0.6, 0.0, 0.3],   detune: 0 },
  };

  function buildGMVoice(sound, freq, dest, now) {
    const r = GM_RECIPES[sound] || GM_RECIPES.gm_acoustic_grand_piano;
    const oscs = [];
    const norm = r.partials.reduce((a,b) => a + b, 0);
    r.partials.forEach((w, i) => {
      if (w <= 0) return;
      const osc = audioCtx.createOscillator();
      osc.type = r.type;
      osc.frequency.setValueAtTime(freq * (i + 1), now);
      if (r.detune) osc.detune.setValueAtTime((i % 2 ? +1 : -1) * r.detune, now);
      const g = audioCtx.createGain();
      g.gain.value = w / norm;
      osc.connect(g).connect(dest);
      osc.start(now);
      oscs.push(osc);
    });
    return { stop: (t) => oscs.forEach(o => safeStop(o, t)) };
  }

  function safeStop(osc, t) {
    try { osc.stop(t); } catch (_) {}
  }

  /* =========================================================
     8. POLYPHONY
     ========================================================= */

  const activeVoices = {};   // voiceId → record

  function redistributeVoiceLevels() {
    const keys = Object.keys(activeVoices);
    if (keys.length === 0) return;
    const perVoice = MAX_POLY_GAIN / keys.length;
    const now = audioCtx.currentTime;
    keys.forEach(k => {
      const { voiceLevel } = activeVoices[k];
      voiceLevel.gain.cancelScheduledValues(now);
      voiceLevel.gain.setTargetAtTime(perVoice, now, 0.03);
    });
  }

  /* =========================================================
     9. ENVELOPES
     ========================================================= */

  function applyAttackDecay(gainParam, now) {
    const A = Math.max(0.001, fxValue("attack"));
    const D = Math.max(0.001, fxValue("decay"));
    const S = Math.max(0.0001, fxValue("sustain"));
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(0.0001, now);
    gainParam.exponentialRampToValueAtTime(1.0, now + A);
    gainParam.exponentialRampToValueAtTime(Math.max(0.0001, S), now + A + D);
  }

  function applyFilterPluck(now) {
    const base = Math.max(20, fxValue("lpf"));
    const peak = Math.min(20000, base + FILT_ENV_AMOUNT);
    masterLPF.frequency.cancelScheduledValues(now);
    masterLPF.frequency.setValueAtTime(base, now);
    masterLPF.frequency.linearRampToValueAtTime(peak, now + FILT_ENV_ATTACK);
    masterLPF.frequency.linearRampToValueAtTime(base, now + FILT_ENV_ATTACK + FILT_ENV_DECAY);
  }

  /* =========================================================
     10. VOICE LIFECYCLE
     ========================================================= */

  function startVoice(freq, voiceId) {
    if (!audioReady) return null;
    const now = audioCtx.currentTime;
    applyFilterPluck(now);

    const envGain    = audioCtx.createGain();
    const voiceLevel = audioCtx.createGain();
    envGain.gain.value    = 0.0001;
    voiceLevel.gain.value = MAX_POLY_GAIN;

    envGain.connect(voiceLevel);
    voiceLevel.connect(masterPan);   // into the master FX chain

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    const waveData = new Uint8Array(analyser.fftSize);
    voiceLevel.connect(analyser);

    const voice = buildVoice(freq, envGain, now);

    applyAttackDecay(envGain.gain, now);

    activeVoices[voiceId] = { envGain, voiceLevel, voice, analyser, waveData };
    redistributeVoiceLevels();
    updateActiveReadout();
    return voiceId;
  }

  function stopVoice(voiceId) {
    const v = activeVoices[voiceId];
    if (!v) return;
    const now = audioCtx.currentTime;
    const R = Math.max(0.001, fxValue("release"));
    v.envGain.gain.cancelScheduledValues(now);
    v.envGain.gain.setValueAtTime(v.envGain.gain.value, now);
    v.envGain.gain.exponentialRampToValueAtTime(0.0001, now + R);
    v.voice.stop(now + R + 0.02);
    delete activeVoices[voiceId];
    redistributeVoiceLevels();
    updateActiveReadout();
  }

  /* =========================================================
     11. KEY PLAYBACK (mono + chord mode + arpeggio)
     ========================================================= */

  const keyToVoices = {};
  const keyHighlights = {};
  let arpState = null;

  function playKey(keyCode) {
    if (!audioReady) return;
    if (keyToVoices[keyCode]) return;

    const degree = LOWER_OCTAVE_DEGREE[keyCode];
    const isChordZone = (degree !== undefined) && ui.chordMode.checked;

    // Snapshot what gets recorded for code generation.
    const eventTs = audioCtx.currentTime;

    if (isChordZone) {
      const root = Number(ui.tonalRoot.value);
      const complexity = Number(ui.complexity.value);
      const chord = chordSemitones(degree, root, complexity);
      if (!chord) return;

      const bassOn = ui.bassToggle.checked;
      const notes = chord.notes.slice();
      if (bassOn) notes.unshift(chord.notes[0] - 12);

      const highlights = chordToVisualKeys(chord.notes).filter(k => k !== keyCode);
      keyHighlights[keyCode] = highlights;
      highlights.forEach(k => flashKeyChord(k, true));
      flashKey(keyCode, true);

      $("chordLabel").textContent = `${ROOT_NAMES[root]} · ${chord.label}`;

      if (ui.arpToggle.checked) {
        startArpForKey(keyCode, notes);
        recordEvent({
          kind: "arp",
          notes,
          chordLabel: chord.label,
          chordRoot: ROOT_NAMES[root],
          rateHz: Number(ui.arpRate.value),
          t: eventTs
        });
      } else {
        const voiceIds = notes.map((semi, i) => {
          const id = `${keyCode}:${i}`;
          startVoice(semitoneToHz(semi), id);
          return id;
        });
        keyToVoices[keyCode] = voiceIds;
        recordEvent({
          kind: "chord",
          notes,
          chordLabel: chord.label,
          chordRoot: ROOT_NAMES[root],
          t: eventTs
        });
      }
    } else {
      const freq = keyToHz(keyCode);
      const semi = keyToSemitone(keyCode);
      if (freq == null) return;
      startVoice(freq, keyCode);
      keyToVoices[keyCode] = [keyCode];
      flashKey(keyCode, true);
      recordEvent({ kind: "note", notes: [semi], t: eventTs });
    }
  }

  function releaseKey(keyCode) {
    if (arpState && arpState.keyCode === keyCode) stopArp();
    const voiceIds = keyToVoices[keyCode];
    if (voiceIds) {
      voiceIds.forEach(stopVoice);
      delete keyToVoices[keyCode];
    }
    const highlights = keyHighlights[keyCode];
    if (highlights) {
      highlights.forEach(k => flashKeyChord(k, false));
      delete keyHighlights[keyCode];
    }
    flashKey(keyCode, false);
    if (Object.keys(keyToVoices).length === 0) $("chordLabel").textContent = "—";

    // Mark the release time on the last open event so we know the duration.
    closeOpenEvent(audioCtx.currentTime);
  }

  function chordToVisualKeys(semitones) {
    const out = [];
    semitones.forEach(s => {
      const pc = ((s % 12) + 12) % 12;
      const code = LOWER_OCTAVE_CODES[pc];
      if (code) out.push(code);
    });
    return out;
  }

  function startArpForKey(keyCode, notes) {
    stopArp();
    let idx = 0, activeId = null;
    const step = () => {
      if (activeId) { stopVoice(activeId); activeId = null; }
      const semi = notes[idx % notes.length];
      const id = `${keyCode}:arp:${idx}`;
      startVoice(semitoneToHz(semi), id);
      activeId = id;
      keyToVoices[keyCode] = [id];
      idx++;
    };
    const rateHz = Number(ui.arpRate.value);
    step();
    const intervalId = setInterval(step, 1000 / rateHz);
    arpState = { intervalId, keyCode };
  }

  function stopArp() {
    if (!arpState) return;
    clearInterval(arpState.intervalId);
    arpState = null;
  }

  /* =========================================================
     12. KEYBOARD (computer + on-screen)
     ========================================================= */

  let sustainOn = false;
  const sustainedKeys = new Set();

  function setSustainIndicator(on) {
    const ind = $("sustainIndicator");
    if (ind) ind.classList.toggle("is-on", on);
  }

  window.addEventListener("keydown", (e) => {
    // Ignore key events when focused inside an input/textarea/select.
    const tag = (e.target.tagName || "").toLowerCase();
    if (["input","textarea","select"].includes(tag)) return;

    if (e.code === "Space" || e.which === 32) {
      e.preventDefault();
      if (!sustainOn) { sustainOn = true; setSustainIndicator(true); }
      return;
    }
    if (e.repeat) return;
    const k = (e.which || e.keyCode).toString();
    if (KEY_SEMITONE_BASE[k] !== undefined) {
      if (sustainedKeys.has(k)) { sustainedKeys.delete(k); releaseKey(k); }
      if (!keyToVoices[k]) playKey(k);
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.which === 32) {
      sustainOn = false;
      setSustainIndicator(false);
      sustainedKeys.forEach(k => releaseKey(k));
      sustainedKeys.clear();
      return;
    }
    const k = (e.which || e.keyCode).toString();
    if (keyToVoices[k]) {
      if (sustainOn) sustainedKeys.add(k);
      else releaseKey(k);
    }
  });

  function releaseFromPointer(code) {
    if (!keyToVoices[code]) return;
    if (sustainOn) sustainedKeys.add(code);
    else releaseKey(code);
  }

  // Build the on-screen keyboard
  const kb = $("keyboard");
  const keyEls = {};
  KEY_DISPLAY.forEach(({ code, label, note, black }) => {
    const el = document.createElement("div");
    el.className = `key ${black ? "key-black" : "key-white"}`;
    el.dataset.code = code;
    el.innerHTML = `
      <div class="key-note">${note}</div>
      <div class="key-label">${label}</div>
    `;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (!keyToVoices[code]) playKey(code);
    });
    const release = () => releaseFromPointer(code);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointerleave", release);
    el.addEventListener("pointercancel", release);
    kb.appendChild(el);
    keyEls[code] = el;
  });

  function flashKey(code, on)      { const el = keyEls[code]; if (el) el.classList.toggle("is-on",    !!on); }
  function flashKeyChord(code, on) { const el = keyEls[code]; if (el) el.classList.toggle("is-chord", !!on); }

  function updateActiveReadout() {
    $("polyCount").textContent = Object.keys(activeVoices).length.toString().padStart(2, "0");
  }

  /* =========================================================
     13. OCTAVE CONTROLS
     ========================================================= */

  function updateOctaveReadout() {
    // base = octave 4 (C4 is unshifted). octaveShift is in semitones.
    const octave = 4 + Math.round(octaveShift / 12);
    $("octReadout").textContent = octave;
  }
  $("octDown").addEventListener("click", () => {
    octaveShift = Math.max(-24, octaveShift - 12);
    updateOctaveReadout();
    // release everything to avoid hanging notes at the old pitch
    Object.keys(keyToVoices).slice().forEach(releaseKey);
  });
  $("octUp").addEventListener("click", () => {
    octaveShift = Math.min(24, octaveShift + 12);
    updateOctaveReadout();
    Object.keys(keyToVoices).slice().forEach(releaseKey);
  });
  updateOctaveReadout();

  /* =========================================================
     14. PRESETS
     ========================================================= */

  // Presets now target the new effect sliders (0..100).
  const PRESETS = {
    custom: null,
    daftBass: {
      soundPick: "sawtooth",
      gain: 70, lpf: 35, lpq: 60, hpf: 0,
      attack: 1, decay: 18, sustain: 35, release: 18,
      room: 5, delay: 15, delaytime: 30, pan: 50,
      crush: 0, clip: 25,
    },
    glassBell: {
      soundPick: "gm_xylophone",
      gain: 55, lpf: 75, lpq: 5, hpf: 8,
      attack: 1, decay: 35, sustain: 5, release: 60,
      room: 45, delay: 25, delaytime: 35, pan: 50,
      crush: 0, clip: 0,
    },
    discoPad: {
      soundPick: "gm_synth_strings_1",
      gain: 60, lpf: 50, lpq: 15, hpf: 0,
      attack: 35, decay: 30, sustain: 70, release: 65,
      room: 65, delay: 20, delaytime: 50, pan: 50,
      crush: 0, clip: 0,
    },
    robotLead: {
      soundPick: "square",
      gain: 55, lpf: 55, lpq: 25, hpf: 5,
      attack: 1, decay: 12, sustain: 80, release: 15,
      room: 15, delay: 35, delaytime: 25, pan: 50,
      crush: 30, clip: 15,
    },
    pluck: {
      soundPick: "triangle",
      gain: 55, lpf: 60, lpq: 12, hpf: 0,
      attack: 0, decay: 30, sustain: 0, release: 30,
      room: 25, delay: 10, delaytime: 25, pan: 50,
      crush: 0, clip: 0,
    },
  };

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.entries(p).forEach(([k, v]) => {
      const el = ui[k];
      if (!el) return;
      el.value = String(v);
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  ui.preset.addEventListener("change", () => applyPreset(ui.preset.value));

  /* =========================================================
     15. TONAL SELECTOR + harmony listeners
     ========================================================= */
  (function wireTonalSelector() {
    const sel = $("tonalSelector");
    if (!sel) return;
    const buttons = sel.querySelectorAll(".tonal-btn");
    const setActive = (val) => {
      buttons.forEach(b => b.classList.toggle("is-on", b.dataset.val === String(val)));
    };
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const val = Number(btn.dataset.val);
        ui.tonalRoot.value = String(val);
        setActive(val);
        ui.tonalRoot.dispatchEvent(new Event("input",  { bubbles: true }));
        ui.tonalRoot.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    setActive(Number(ui.tonalRoot.value));
  })();

  // Pretty harmony readouts
  if (ui.tonalRoot) {
    const out = document.querySelector(`output[for="tonalRoot"]`);
    const update = () => { out.textContent = ROOT_NAMES[Number(ui.tonalRoot.value)] + " major"; };
    ui.tonalRoot.addEventListener("input", update);
    update();
  }
  const COMPLEXITY_LABEL = ["triad", "7th", "9th"];
  if (ui.complexity) {
    const out = document.querySelector(`output[for="complexity"]`);
    const update = () => { out.textContent = COMPLEXITY_LABEL[Number(ui.complexity.value)] || "—"; };
    ui.complexity.addEventListener("input", update);
    update();
  }
  if (ui.arpRate) {
    const out = document.querySelector(`output[for="arpRate"]`);
    const update = () => { out.textContent = Number(ui.arpRate.value).toFixed(1) + " Hz"; };
    ui.arpRate.addEventListener("input", update);
    update();
  }

  // Release everything if any harmony control changes
  [ui.tonalRoot, ui.complexity, ui.chordMode, ui.bassToggle, ui.arpToggle]
    .filter(Boolean)
    .forEach(el => el.addEventListener("change", () => {
      Object.keys(keyToVoices).slice().forEach(releaseKey);
    }));

  /* =========================================================
     16. EVENT RECORDER + STRUDEL CODE GENERATION
     =========================================================
     Every key press records a high-level musical event. On finalize,
     the events become a Strudel pattern string.
  */

  const recorder = {
    events: [],         // [{kind, notes, t, dur, ...}]
    startedAt: null,
    openEvent: null,    // the most recently played event, awaiting release
  };

  function recordEvent(ev) {
    if (recorder.startedAt == null) recorder.startedAt = ev.t;
    ev.tRel = ev.t - recorder.startedAt;
    if (recorder.openEvent) recorder.openEvent.dur = ev.t - recorder.openEvent.t;
    recorder.events.push(ev);
    recorder.openEvent = ev;
    refreshRecordingView();
  }

  function closeOpenEvent(now) {
    if (recorder.openEvent && recorder.openEvent.dur == null) {
      recorder.openEvent.dur = now - recorder.openEvent.t;
    }
    refreshRecordingView();
  }

  function clearRecording() {
    recorder.events = [];
    recorder.startedAt = null;
    recorder.openEvent = null;
    refreshRecordingView();
  }

  // === Strudel pattern compilation ===
  //
  // Strategy:
  //   - Quantize event start times to a 16-step grid spanning N cycles
  //     (N = ceil(totalDuration / cycleSeconds)).
  //   - cycleSeconds defaults to 2.0s (so the whole pattern feels musical).
  //   - For each step, emit either a "~" (rest), a single note, or a
  //     chord/arp segment.
  //   - Wrap into note("...").sound(...).lpf(...)...
  //
  // For chords we use Strudel's bracket syntax: [c4,e4,g4] = strike together.
  // For arpeggios we expand into sequential events.

  const CYCLE_SECONDS = 2.0;
  const STEPS_PER_CYCLE = 16;

  function compileRecordingToPattern() {
    const ev = recorder.events;
    if (ev.length === 0) return null;
    const totalDur = Math.max(...ev.map(e => e.tRel + (e.dur || 0.2)));
    const cycles = Math.max(1, Math.ceil(totalDur / CYCLE_SECONDS));
    const totalSteps = cycles * STEPS_PER_CYCLE;
    const stepDur = (cycles * CYCLE_SECONDS) / totalSteps;

    // Bucket events into steps
    const grid = new Array(totalSteps).fill(null).map(() => []);
    ev.forEach(e => {
      let step = Math.round(e.tRel / stepDur);
      step = Math.max(0, Math.min(totalSteps - 1, step));
      // Expand arps into successive steps within the event's duration.
      if (e.kind === "arp") {
        const arpStep = Math.max(1, Math.round((1 / e.rateHz) / stepDur));
        let s = step;
        let i = 0;
        const totalArpSteps = Math.max(1, Math.round((e.dur || 0.5) / stepDur));
        while (s < step + totalArpSteps && s < totalSteps) {
          grid[s].push({ kind: "note", notes: [e.notes[i % e.notes.length]] });
          s += arpStep;
          i++;
        }
      } else {
        grid[step].push({ kind: e.kind, notes: e.notes });
      }
    });

    // Build the note pattern string
    const tokens = grid.map(cell => {
      if (cell.length === 0) return "~";
      // If multiple events landed in one step, merge their notes into a chord.
      const allNotes = cell.flatMap(c => c.notes);
      const isChord = cell.length === 1 ? cell[0].kind === "chord" : true;
      const noteNames = allNotes.map(semitoneToStrudelNote);
      if (noteNames.length === 1) return noteNames[0];
      return "[" + noteNames.join(",") + "]";
    });

    return {
      noteString: tokens.join(" "),
      cycles,
      totalSteps,
      effectsSnapshot: snapshotEffects(),
    };
  }

  function snapshotEffects() {
    return {
      sound:     ui.soundPick.value,
      gain:      fxValue("gain"),
      lpf:       fxValue("lpf"),
      lpq:       fxValue("lpq"),
      hpf:       fxValue("hpf"),
      attack:    fxValue("attack"),
      decay:     fxValue("decay"),
      sustain:   fxValue("sustain"),
      release:   fxValue("release"),
      room:      fxValue("room"),
      delay:     fxValue("delay"),
      delaytime: fxValue("delaytime"),
      pan:       fxValue("pan"),
      crush:     fxValue("crush"),
      clip:      fxValue("clip"),
    };
  }

  // Turn a compiled pattern into the actual Strudel source string.
  function patternToStrudelCode(compiled, label = "") {
    if (!compiled) return `// (empty)`;
    const fx = compiled.effectsSnapshot;
    const lines = [];
    if (label) lines.push(`// ── ${label} ──`);
    let p = `note("${compiled.noteString}")`;
    p += `.sound("${fx.sound}")`;
    // Only emit non-default effects to keep output readable.
    if (fx.gain !== 1.0)        p += `.gain(${fx.gain})`;
    if (fx.lpf > 200)           p += `.lpf(${fx.lpf})`;
    if (fx.lpq > 1.1)           p += `.lpq(${fx.lpq})`;
    if (fx.hpf > 0)             p += `.hpf(${fx.hpf})`;
    if (fx.attack !== 0.01)     p += `.attack(${fx.attack})`;
    if (fx.release !== 0.04)    p += `.release(${fx.release})`;
    if (fx.room > 0)            p += `.room(${fx.room})`;
    if (fx.delay > 0)           p += `.delay(${fx.delay}).delaytime(${fx.delaytime})`;
    if (fx.pan !== 0.5)         p += `.pan(${fx.pan})`;
    if (fx.crush > 0)           p += `.crush(${fx.crush})`;
    if (fx.clip > 0)            p += `.clip(${fx.clip})`;
    if (compiled.cycles > 1)    p += `.slow(${compiled.cycles})`;
    lines.push(`$: ${p}`);
    return lines.join("\n");
  }

  // Syntax-highlight a small subset of Strudel for the code blocks.
  function highlightStrudel(code) {
    // Escape first
    const esc = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return esc
      .replace(/(\/\/[^\n]*)/g,                  '<span class="tok-cm">$1</span>')
      .replace(/(\$:)/g,                          '<span class="tok-op">$1</span>')
      .replace(/("[^"]*")/g,                      '<span class="tok-str">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g,            '<span class="tok-num">$1</span>')
      .replace(/(\b(?:note|sound|stack|gain|lpf|lpq|hpf|attack|decay|sustain|release|room|delay|delaytime|pan|crush|clip|slow|fast|bank|n)\b)(?=\()/g,
                                                   '<span class="tok-fn">$1</span>');
  }

  function refreshRecordingView() {
    const compiled = compileRecordingToPattern();
    const codeEl = $("codeRecording");
    const countEl = $("recCount");
    const durEl = $("recDuration");
    countEl.textContent = recorder.events.length.toString();
    const total = recorder.events.length === 0
      ? 0
      : Math.max(...recorder.events.map(e => e.tRel + (e.dur || 0)));
    durEl.textContent = total.toFixed(1);
    if (!compiled) {
      codeEl.innerHTML = highlightStrudel(
`// play a note, chord, or beat to start building a pattern
// hit FINALIZE to freeze this as a looping layer
//
// $: silence`
      );
      return;
    }
    codeEl.innerHTML = highlightStrudel(patternToStrudelCode(compiled, "live · recording"));
  }

  $("clearRecBtn").addEventListener("click", clearRecording);

  /* =========================================================
     17. LAYERS — frozen, looping patterns
     ========================================================= */

  const layers = [];   // [{ id, code, compiled, fx, muted, timer }]
  let layerSeq = 0;

  function finalizeRecording() {
    if (recorder.events.length === 0) return;
    closeOpenEvent(audioCtx.currentTime);
    const compiled = compileRecordingToPattern();
    if (!compiled) return;
    const id = ++layerSeq;
    const code = patternToStrudelCode(compiled, `layer ${id}`);
    const layer = {
      id,
      code,
      compiled,
      fx: compiled.effectsSnapshot,
      muted: false,
      timer: null,
      stepIdx: 0,
    };
    startLayerScheduler(layer);
    layers.push(layer);
    clearRecording();
    renderLayers();
  }
  $("finalizeBtn").addEventListener("click", finalizeRecording);

  // Each layer schedules its events via setInterval at step-granularity.
  // It plays through the SAME audio engine, so live FX slider moves apply
  // to all layers automatically. The FX snapshot lives in the printed code
  // (so when exported to Strudel, the values reproduce what was heard).
  function startLayerScheduler(layer) {
    const cyclesSec = layer.compiled.cycles * CYCLE_SECONDS;
    const totalSteps = layer.compiled.totalSteps;
    const stepMs = (cyclesSec * 1000) / totalSteps;

    // Parse the note string back into per-step arrays.
    const tokens = layer.compiled.noteString.split(/\s+/);
    const stepNotes = tokens.map(tok => {
      if (tok === "~") return [];
      if (tok.startsWith("[")) {
        return tok.slice(1, -1).split(",").map(strudelNoteToSemitone);
      }
      return [strudelNoteToSemitone(tok)];
    });

    layer.timer = setInterval(() => {
      if (layer.muted) { layer.stepIdx = (layer.stepIdx + 1) % totalSteps; return; }
      const notes = stepNotes[layer.stepIdx];
      if (notes && notes.length) {
        notes.forEach((semi, i) => {
          const vid = `layer${layer.id}:${layer.stepIdx}:${i}`;
          startVoice(semitoneToHz(semi), vid);
          // brief gate length — slightly shorter than a step
          setTimeout(() => stopVoice(vid), Math.max(40, stepMs * 0.85));
        });
      }
      layer.stepIdx = (layer.stepIdx + 1) % totalSteps;
    }, stepMs);
  }

  function strudelNoteToSemitone(name) {
    // e.g. "c4", "c#4", "bb3"
    const m = name.match(/^([a-g])([#b]?)(-?\d+)$/i);
    if (!m) return 0;
    const baseMap = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
    let pc = baseMap[m[1].toLowerCase()];
    if (m[2] === "#") pc += 1;
    else if (m[2] === "b") pc -= 1;
    const octave = parseInt(m[3], 10);
    const midi = (octave + 1) * 12 + pc;
    return midi - 60;   // semitones from C4
  }

  function renderLayers() {
    const list = $("layersList");
    $("layerCount").textContent = layers.length.toString().padStart(2, "0");
    if (layers.length === 0) {
      list.innerHTML = `<div class="layers-empty">no layers yet · finalize a recording to start</div>`;
      return;
    }
    list.innerHTML = "";
    layers.forEach(layer => {
      const card = document.createElement("div");
      card.className = "layer-card is-playing" + (layer.muted ? " is-muted" : "");
      card.innerHTML = `
        <div class="layer-card-head">
          <span class="layer-name">
            <span class="code-dot cyan"></span>
            LAYER ${String(layer.id).padStart(2,"0")}
          </span>
          <div class="layer-actions">
            <button class="layer-btn ${layer.muted ? "is-muted" : ""}" data-act="mute">${layer.muted ? "UNMUTE" : "MUTE"}</button>
            <button class="layer-btn del" data-act="del">×</button>
          </div>
        </div>
        <pre class="layer-code">${highlightStrudel(layer.code)}</pre>
      `;
      card.querySelector('[data-act="mute"]').addEventListener("click", () => {
        layer.muted = !layer.muted;
        renderLayers();
      });
      card.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (layer.timer) clearInterval(layer.timer);
        const idx = layers.indexOf(layer);
        if (idx >= 0) layers.splice(idx, 1);
        renderLayers();
      });
      list.appendChild(card);
    });
  }

  $("muteAllBtn").addEventListener("click", () => {
    const allMuted = layers.every(l => l.muted);
    layers.forEach(l => l.muted = !allMuted);
    renderLayers();
  });

  // Export: produce a full Strudel script with all active layers + drum pattern
  $("exportBtn").addEventListener("click", () => {
    const parts = [];
    parts.push(`// TONUS export · ${new Date().toLocaleString()}`);
    parts.push(`setcpm(${(Number(ui.bpm.value)/4).toFixed(0)})`);
    parts.push("");
    layers.forEach(l => {
      if (l.muted) parts.push(`// (muted) ${l.code.split('\n')[0]}`);
      else parts.push(l.code);
    });
    if (drumPatternHasContent()) {
      parts.push("");
      parts.push(generateDrumStrudel());
    }
    const out = parts.join("\n");
    // Copy to clipboard if possible; show in a download blob otherwise.
    navigator.clipboard?.writeText(out).catch(() => {});
    // Also offer a download
    const blob = new Blob([out], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tonus-${Date.now()}.strudel.js`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* =========================================================
     18. DRUM SEQUENCER
     ========================================================= */

  const DRUMS = [
    { code: "bd",  name: "kick",       color: "#ff3cac" },
    { code: "sd",  name: "snare",      color: "#9b59ff" },
    { code: "hh",  name: "hihat",      color: "#00e5ff" },
    { code: "oh",  name: "open hat",   color: "#7fff8c" },
    { code: "cp",  name: "clap",       color: "#ffb547" },
    { code: "rim", name: "rim",        color: "#ff3cac" },
    { code: "cr",  name: "crash",      color: "#9b59ff" },
    { code: "lt",  name: "low tom",    color: "#00e5ff" },
  ];
  const NUM_STEPS = 16;
  // drumGrid[drumIdx][step] = 0 | 1
  const drumGrid = DRUMS.map(() => new Array(NUM_STEPS).fill(0));
  let drumPlaying = false;
  let drumTimer = null;
  let drumStep = 0;

  function buildDrumUI() {
    const wrap = $("drumGrid");
    wrap.innerHTML = "";
    DRUMS.forEach((d, di) => {
      const row = document.createElement("div");
      row.className = "drum-row";
      // pad
      const pad = document.createElement("button");
      pad.className = "drum-pad";
      pad.dataset.drum = di;
      pad.innerHTML = `<span class="pad-name">${d.name}</span><span class="pad-code">${d.code}</span>`;
      pad.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pad.classList.add("is-firing");
        playDrum(d.code);
        setTimeout(() => pad.classList.remove("is-firing"), 120);
      });
      row.appendChild(pad);
      // steps
      for (let s = 0; s < NUM_STEPS; s++) {
        const cell = document.createElement("div");
        cell.className = "drum-step" + (s % 4 === 0 ? " beat-mark" : "");
        cell.dataset.drum = di;
        cell.dataset.step = s;
        cell.addEventListener("click", () => {
          drumGrid[di][s] = drumGrid[di][s] ? 0 : 1;
          cell.classList.toggle("is-on", !!drumGrid[di][s]);
        });
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    });
  }
  buildDrumUI();

  // BPM readout
  ui.bpm.addEventListener("input", () => {
    $("bpmReadout").textContent = ui.bpm.value;
    if (drumPlaying) {
      stopDrumLoop();
      startDrumLoop();
    }
  });

  function stepMs() {
    // 16 steps per cycle; cycle = 1 bar at the chosen BPM (4 beats / bar)
    const bpm = Number(ui.bpm.value);
    const beatMs = 60000 / bpm;
    return (beatMs * 4) / NUM_STEPS;   // a sixteenth note
  }

  function startDrumLoop() {
    if (drumPlaying) return;
    drumPlaying = true;
    drumStep = 0;
    $("drumPlayBtn").textContent = "■ STOP";
    drumTimer = setInterval(() => {
      // Highlight current step
      document.querySelectorAll(".drum-step.is-current").forEach(el => el.classList.remove("is-current"));
      DRUMS.forEach((d, di) => {
        const sel = `.drum-step[data-drum="${di}"][data-step="${drumStep}"]`;
        const cell = document.querySelector(sel);
        if (cell) cell.classList.add("is-current");
        if (drumGrid[di][drumStep]) playDrum(d.code);
      });
      drumStep = (drumStep + 1) % NUM_STEPS;
    }, stepMs());
  }
  function stopDrumLoop() {
    drumPlaying = false;
    if (drumTimer) clearInterval(drumTimer);
    drumTimer = null;
    document.querySelectorAll(".drum-step.is-current").forEach(el => el.classList.remove("is-current"));
    $("drumPlayBtn").textContent = "▶ PLAY";
  }
  $("drumPlayBtn").addEventListener("click", () => {
    if (drumPlaying) stopDrumLoop(); else { if (!audioReady) audioCtx.resume().then(() => { audioReady = true; }); startDrumLoop(); }
  });
  $("drumClearBtn").addEventListener("click", () => {
    drumGrid.forEach(row => row.fill(0));
    document.querySelectorAll(".drum-step").forEach(el => el.classList.remove("is-on"));
  });

  // Drum synthesis — no samples, built from oscs + noise.
  function playDrum(code) {
    if (!audioReady) return;
    const now = audioCtx.currentTime;
    const out = audioCtx.createGain();
    out.gain.value = 0.5;
    out.connect(masterPan);   // route through master FX
    switch (code) {
      case "bd": {
        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.9, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(g).connect(out);
        osc.start(now); osc.stop(now + 0.22);
        break;
      }
      case "sd": {
        const noise = makeNoise(now, 0.18);
        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 1.0;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.7, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        noise.connect(bp).connect(g).connect(out);
        // Add a body tone
        const tone = audioCtx.createOscillator();
        tone.type = "triangle"; tone.frequency.setValueAtTime(220, now);
        const tg = audioCtx.createGain();
        tg.gain.setValueAtTime(0.3, now);
        tg.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        tone.connect(tg).connect(out);
        tone.start(now); tone.stop(now + 0.15);
        break;
      }
      case "hh": {
        const noise = makeNoise(now, 0.05);
        const hp = audioCtx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 7000;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.4, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        noise.connect(hp).connect(g).connect(out);
        break;
      }
      case "oh": {
        const noise = makeNoise(now, 0.25);
        const hp = audioCtx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 6000;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.35, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        noise.connect(hp).connect(g).connect(out);
        break;
      }
      case "cp": {
        // three quick noise bursts
        for (let i = 0; i < 3; i++) {
          const t = now + i * 0.01;
          const noise = makeNoise(t, 0.04);
          const bp = audioCtx.createBiquadFilter();
          bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.7;
          const g = audioCtx.createGain();
          g.gain.setValueAtTime(0.5, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
          noise.connect(bp).connect(g).connect(out);
        }
        break;
      }
      case "rim": {
        const osc = audioCtx.createOscillator();
        osc.type = "square"; osc.frequency.setValueAtTime(380, now);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.4, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(g).connect(out);
        osc.start(now); osc.stop(now + 0.06);
        break;
      }
      case "cr": {
        const noise = makeNoise(now, 0.6);
        const hp = audioCtx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 4500;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.35, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        noise.connect(hp).connect(g).connect(out);
        break;
      }
      case "lt": {
        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.18);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.7, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(g).connect(out);
        osc.start(now); osc.stop(now + 0.22);
        break;
      }
    }
  }

  function makeNoise(startTime, dur) {
    const sr = audioCtx.sampleRate;
    const buf = audioCtx.createBuffer(1, Math.max(1, Math.round(sr * dur)), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.start(startTime);
    return src;
  }

  function drumPatternHasContent() {
    return drumGrid.some(row => row.some(x => x === 1));
  }

  function generateDrumStrudel() {
    // For each drum row, produce a 16-step pattern like "x ~ ~ x".
    const lines = [];
    lines.push(`// ── drums ──`);
    const blocks = [];
    DRUMS.forEach((d, di) => {
      const row = drumGrid[di];
      if (!row.some(x => x === 1)) return;
      const steps = row.map(x => x ? d.code : "~").join(" ");
      blocks.push(`  sound("${steps}")`);
    });
    if (blocks.length === 0) return "";
    lines.push(`$: stack(`);
    lines.push(blocks.join(",\n"));
    lines.push(`).bank("RolandTR909")`);
    return lines.join("\n");
  }

  $("drumCaptureBtn").addEventListener("click", () => {
    if (!drumPatternHasContent()) return;
    const code = generateDrumStrudel();
    // Build a "layer" record that runs the drum pattern on its own.
    const id = ++layerSeq;
    const layer = {
      id,
      code: `// drums · captured layer ${id}\n` + code,
      isDrum: true,
      pattern: drumGrid.map(row => row.slice()),
      muted: false,
      timer: null,
      stepIdx: 0,
    };
    startDrumLayerScheduler(layer);
    layers.push(layer);
    renderLayers();
  });

  function startDrumLayerScheduler(layer) {
    layer.timer = setInterval(() => {
      if (layer.muted) { layer.stepIdx = (layer.stepIdx + 1) % NUM_STEPS; return; }
      DRUMS.forEach((d, di) => {
        if (layer.pattern[di][layer.stepIdx]) playDrum(d.code);
      });
      layer.stepIdx = (layer.stepIdx + 1) % NUM_STEPS;
    }, stepMs());
  }

  /* =========================================================
     19. VISUALIZERS (compact scope + spectrum)
     ========================================================= */

  const scope = $("scope");
  const sctx  = scope.getContext("2d");
  const spec  = $("spectrum");
  const xctx  = spec.getContext("2d");
  const specData = new Uint8Array(analyserBus.frequencyBinCount);

  function resizeCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width  = Math.max(1, Math.round(r.width  * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resizeAll() { resizeCanvas(scope); resizeCanvas(spec); }
  window.addEventListener("resize", resizeAll);
  resizeAll();

  function colorForVoice(i) {
    const palette = ["#7fff8c", "#ffb547", "#00e5ff", "#ff3cac", "#9b59ff"];
    return palette[i % palette.length];
  }

  function drawFrame() {
    requestAnimationFrame(drawFrame);

    // SCOPE
    const w = scope.clientWidth, h = scope.clientHeight;
    sctx.clearRect(0, 0, w, h);
    sctx.strokeStyle = "rgba(127,255,140,0.08)";
    sctx.lineWidth = 1;
    sctx.beginPath(); sctx.moveTo(0, h/2); sctx.lineTo(w, h/2); sctx.stroke();

    const voices = Object.values(activeVoices);
    if (voices.length === 0) {
      sctx.strokeStyle = "rgba(127,255,140,0.3)";
      sctx.beginPath(); sctx.moveTo(0, h/2); sctx.lineTo(w, h/2); sctx.stroke();
    } else {
      voices.forEach((v, i) => {
        v.analyser.getByteTimeDomainData(v.waveData);
        sctx.strokeStyle = colorForVoice(i);
        sctx.lineWidth = 1.4;
        sctx.globalAlpha = 0.85;
        sctx.beginPath();
        const slice = w / v.waveData.length;
        for (let j = 0; j < v.waveData.length; j++) {
          const val = (v.waveData[j] - 128) / 128;
          const x = j * slice;
          const y = h/2 + val * (h/2) * 0.9;
          if (j === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
        }
        sctx.stroke();
      });
      sctx.globalAlpha = 1;
    }

    // SPECTRUM
    const sw = spec.clientWidth, sh = spec.clientHeight;
    xctx.clearRect(0, 0, sw, sh);
    analyserBus.getByteFrequencyData(specData);

    const bins = specData.length;
    const cols = 48;
    const colW = sw / cols;
    for (let i = 0; i < cols; i++) {
      const t0 = i / cols, t1 = (i + 1) / cols;
      const f0 = Math.floor(Math.pow(t0, 2.2) * bins);
      const f1 = Math.max(f0 + 1, Math.floor(Math.pow(t1, 2.2) * bins));
      let sum = 0;
      for (let k = f0; k < f1; k++) sum += specData[k];
      const v = (sum / (f1 - f0)) / 255;
      const barH = v * sh * 0.95;
      const g = xctx.createLinearGradient(0, sh, 0, sh - barH);
      g.addColorStop(0,    "#3a4a3a");
      g.addColorStop(0.55, "#7fff8c");
      g.addColorStop(0.85, "#00e5ff");
      g.addColorStop(1,    "#ff3cac");
      xctx.fillStyle = g;
      xctx.fillRect(i * colW + 1, sh - barH, colW - 2, barH);
    }
  }
  drawFrame();

  /* =========================================================
     20. RECORDER (audio file)
     ========================================================= */

  let mediaRecorder = null, chunks = [], isRecording = false;
  recordBtn.addEventListener("click", async () => {
    if (!audioReady) {
      await audioCtx.resume();
      audioReady = true;
      startBtn.classList.add("is-on");
      startBtn.querySelector(".btn-label").textContent = "ONLINE";
    }
    if (!isRecording) {
      chunks = [];
      mediaRecorder = new MediaRecorder(recorderTap.stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `tonus-${Date.now()}.webm`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      };
      mediaRecorder.start();
      isRecording = true;
      recordBtn.classList.add("is-rec");
      recordBtn.querySelector(".btn-label").textContent = "STOP · SAVE";
    } else {
      mediaRecorder.stop();
      isRecording = false;
      recordBtn.classList.remove("is-rec");
      recordBtn.querySelector(".btn-label").textContent = "RECORD";
    }
  });

  /* =========================================================
     21. SERIAL NUMBER (cosmetic)
     ========================================================= */
  $("serial").textContent =
    Math.floor(Math.random() * 9000 + 1000) + "·" +
    Math.floor(Math.random() * 9000 + 1000);
});
