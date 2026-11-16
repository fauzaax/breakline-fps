// All sound is synthesized with WebAudio: no audio files, no network. Gunshots are a
// filtered noise burst plus a low thump; beeps, stings and ticks are short oscillators.
// The context is created on the first user gesture (pointer lock / click).
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  let lastStep = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
      const length = Math.floor(ctx.sampleRate * 1);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  function noise(when, duration, filterFreq, filterType, peak, decay) {
    if (!ctx || muted) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + decay);
    source.connect(filter).connect(gain).connect(master);
    source.start(when);
    source.stop(when + duration);
  }

  function tone(when, freq, freqEnd, duration, peak, type = 'sine') {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (freqEnd && freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(freqEnd, when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  const SHOT_SHAPES = {
    sidearm: { freq: 1800, peak: 0.5, decay: 0.09, thump: 140 },
    rifle: { freq: 1400, peak: 0.6, decay: 0.11, thump: 110 },
    smg: { freq: 2000, peak: 0.45, decay: 0.07, thump: 150 },
    scatter: { freq: 900, peak: 0.8, decay: 0.16, thump: 80 },
    marksman: { freq: 1100, peak: 0.75, decay: 0.2, thump: 70 },
  };

  return {
    resume,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.45;
      return muted;
    },
    get muted() {
      return muted;
    },
    shot(kind, distance = 0) {
      if (!ensure()) return;
      const shape = SHOT_SHAPES[kind] || SHOT_SHAPES.rifle;
      const attenuation = 1 / (1 + distance * 0.06);
      const when = ctx.currentTime;
      noise(when, shape.decay + 0.05, shape.freq, 'lowpass', shape.peak * attenuation, shape.decay);
      tone(when, shape.thump, 45, 0.1, 0.35 * attenuation, 'sine');
    },
    dryFire() {
      if (!ensure()) return;
      tone(ctx.currentTime, 2200, 1800, 0.04, 0.12, 'square');
    },
    reload() {
      if (!ensure()) return;
      const when = ctx.currentTime;
      tone(when, 900, 500, 0.05, 0.15, 'square');
      tone(when + 0.28, 700, 420, 0.05, 0.15, 'square');
      tone(when + 0.55, 1200, 900, 0.06, 0.18, 'square');
    },
    footstep() {
      if (!ensure()) return;
      const now = ctx.currentTime;
      if (now - lastStep < 0.24) return;
      lastStep = now;
      noise(now, 0.07, 300, 'lowpass', 0.12, 0.06);
    },
    hit(kill) {
      if (!ensure()) return;
      tone(ctx.currentTime, kill ? 1500 : 1100, kill ? 900 : 900, 0.07, 0.22, 'sine');
    },
    hurt() {
      if (!ensure()) return;
      tone(ctx.currentTime, 180, 90, 0.12, 0.3, 'sawtooth');
    },
    beep(fast) {
      if (!ensure()) return;
      tone(ctx.currentTime, 1900, 1900, fast ? 0.05 : 0.09, 0.2, 'square');
    },
    plantTick() {
      if (!ensure()) return;
      tone(ctx.currentTime, 1300, 1300, 0.06, 0.16, 'square');
    },
    explosion() {
      if (!ensure()) return;
      const when = ctx.currentTime;
      noise(when, 0.9, 500, 'lowpass', 1.0, 0.8);
      tone(when, 120, 30, 0.7, 0.7, 'sine');
    },
    sting(win) {
      if (!ensure()) return;
      const when = ctx.currentTime;
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((freq, index) => tone(when + index * 0.12, freq, freq, 0.22, 0.2, 'triangle'));
    },
    buy() {
      if (!ensure()) return;
      const when = ctx.currentTime;
      tone(when, 1320, 1320, 0.08, 0.18, 'sine');
      tone(when + 0.07, 1760, 1760, 0.1, 0.18, 'sine');
    },
    click() {
      if (!ensure()) return;
      tone(ctx.currentTime, 800, 600, 0.04, 0.1, 'square');
    },
    roundStart() {
      if (!ensure()) return;
      tone(ctx.currentTime, 660, 660, 0.1, 0.18, 'triangle');
    },
  };
}
