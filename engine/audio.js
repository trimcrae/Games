// Two square-wave voices and a noise channel, in the spirit of the original
// hardware. Everything is generated; there are no audio files to load.
//
// Browsers will not start audio until the user touches something, so the
// context stays suspended until `unlock()` is called from a real gesture.

const NOTES = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

/** "A4" / "C#5" -> Hz */
export function noteFreq(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) return 440;
  const semitone = NOTES[m[1]] + (Number(m[2]) + 1) * 12;
  return 440 * 2 ** ((semitone - 69) / 12);
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.22;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  /**
   * One square-wave blip.
   * @param {number|string} note frequency in Hz, or a note name
   * @param {object} [opts]
   * @param {number} [opts.dur=0.08] seconds
   * @param {number} [opts.gain=1] relative level
   * @param {number} [opts.slide=0] end frequency multiplier for a sweep
   * @param {'square'|'triangle'|'sawtooth'|'sine'} [opts.type='square']
   * @param {number} [opts.delay=0] seconds from now
   */
  blip(note, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const { dur = 0.08, gain = 1, slide = 0, type = 'square', delay = 0 } = opts;
    const t0 = this.ctx.currentTime + delay;
    const freq = typeof note === 'string' ? noteFreq(note) : note;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered white noise, for footsteps and thuds. */
  noise({ dur = 0.06, gain = 0.5, cutoff = 1400, delay = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 2147483648 - 1) * (1 - i / frames);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = this.ctx.createGain();
    env.gain.value = gain;
    src.connect(filter).connect(env).connect(this.master);
    src.start(t0);
  }

  /** Play a little sequence: [note, startBeat, durBeats, gain?]. */
  jingle(notes, bpm = 220, opts = {}) {
    const beat = 60 / bpm;
    for (const [note, at, len, gain = 1] of notes) {
      this.blip(note, { ...opts, delay: at * beat, dur: len * beat * 0.9, gain });
    }
  }
}

/** Stock sound effects, so every cartridge sounds like the same console. */
export const SFX = {
  cursor: (a) => a.blip('E5', { dur: 0.045, gain: 0.7 }),
  confirm: (a) => a.jingle([['E5', 0, 0.5], ['B5', 0.4, 0.8]], 320),
  cancel: (a) => a.blip('B4', { dur: 0.09, slide: 0.5, gain: 0.7 }),
  bump: (a) => a.noise({ dur: 0.05, gain: 0.35, cutoff: 700 }),
  step: (a) => a.noise({ dur: 0.035, gain: 0.16, cutoff: 2200 }),
  found: (a) => a.jingle([['C5', 0, 0.5], ['E5', 0.5, 0.5], ['G5', 1, 0.5], ['C6', 1.5, 1.4]], 340),
  page: (a) => a.blip('A5', { dur: 0.03, gain: 0.4 }),
  boot: (a) => a.jingle([['C5', 0, 1], ['G5', 1.1, 2.4]], 150, { type: 'triangle' }),
};
