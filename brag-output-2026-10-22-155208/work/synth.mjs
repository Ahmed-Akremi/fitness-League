// Soundtrack for the brag video, written to picture: 120 BPM (a bar = 2 s), F minor, one shared reverb so
// the music and the effects sit in the same room. Writes work/audio/soundtrack.wav (48 kHz stereo, 32-bit float).
// Usage: node synth.mjs [cues.json]   (cues: { taps: [seconds…], bells: [[seconds, midi]…] })
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SR = 48000, DUR = 22, N = SR * DUR;
const BEAT = 0.5, BAR = 2;
const cues = JSON.parse(readFileSync(process.argv[2] ?? join(here, 'cues.json'), 'utf8'));

// --- helpers -------------------------------------------------------------------------------------------
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const bus = () => [new Float32Array(N), new Float32Array(N)];
const add = (b, i, l, r = l) => { if (i >= 0 && i < N) { b[0][i] += l; b[1][i] += r; } };
const at = (t) => Math.round(t * SR);
const lp = (a) => { let y = 0; return (x) => (y += a * (x - y)); };
const coef = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR);
// State-variable filter (Chamberlin), low-pass output; cutoff can move per sample.
function svf() {
  let low = 0, band = 0;
  return (x, fc, q = 0.7) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    return low;
  };
}
const pan = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

const drums = bus(), bass = bus(), synth = bus(), fx = bus(), send = bus();

// --- arrangement ---------------------------------------------------------------------------------------
// 0–3 s   hook: a pulsing F drone, ticks, a riser into the slam
// 3 s     « No. »: impact + sub drop, then one beat of air, a reverse swell
// 4–19 s  groove: Fm – Db – Ab – Eb, four on the floor, sidechained sub and stabs; arp from 12 s
// 19 s    final hit on the logo, Fm chord rings out to 22
const GROOVE = [4, 19];
const CHORDS = [ // root (sub), chord tones (stabs)
  { root: 41, notes: [65, 68, 72] },   // Fm
  { root: 37, notes: [65, 68, 73] },   // Db
  { root: 44, notes: [63, 68, 72] },   // Ab
  { root: 39, notes: [63, 67, 70] },   // Eb
];
const chordAt = (t) => CHORDS[Math.floor((t - GROOVE[0]) / BAR) % 4];

const kicks = [];
for (let t = GROOVE[0]; t < GROOVE[1] - 1e-6; t += BEAT) kicks.push(t);
const hookKicks = [0.0, 0.25, 1.0, 1.25, 2.0, 2.25];

function kick(t, gain = 1, deep = false) {
  const len = at(deep ? 1.1 : 0.42), i0 = at(t);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    const f = (deep ? 38 : 46) + (deep ? 160 : 120) * Math.exp(-s * (deep ? 22 : 34));
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-s * (deep ? 3.2 : 7.5));
    const click = i < 90 ? rnd() * 0.25 * (1 - i / 90) : 0;
    add(drums, i0 + i, Math.tanh((Math.sin(ph) * env + click) * 1.6) * gain * 0.9);
  }
}
function clap(t, gain = 1) {
  const i0 = at(t), len = at(0.3), f = svf();
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    const burst = [0, 0.011, 0.022].reduce((a, o) => a + (s >= o ? Math.exp(-(s - o) * 160) : 0), 0);
    const env = burst * 0.5 + Math.exp(-s * 18) * 0.6;
    const n = rnd();
    const x = (n - f(n, 900)) * env * gain * 0.32;
    add(drums, i0 + i, x * 0.95, x);
    add(send, i0 + i, x * 0.35);
  }
}
function hat(t, gain, open = false, p = 0.2) {
  const i0 = at(t), len = at(open ? 0.22 : 0.05), f = svf(), [L, R] = pan(p);
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    const n = rnd();
    const x = (n - f(n, 7000)) * Math.exp(-s * (open ? 16 : 70)) * gain * 0.16;
    add(drums, i0 + i, x * L, x * R);
  }
}
function subNote(t, dur, m, gain = 1) {
  const i0 = at(t), len = at(dur), f0 = midi(m);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    ph += (2 * Math.PI * f0) / SR;
    const env = Math.min(1, s / 0.006) * Math.min(1, (dur - s) / 0.02);
    add(bass, i0 + i, Math.tanh((Math.sin(ph) + 0.18 * Math.sin(2 * ph)) * 1.3) * env * gain * 0.42);
  }
}
// Detuned saw voice, low-passed with its own envelope.
function saw(t, dur, m, { gain = 1, cutoff = 2400, decay = 6, voices = 3, spread = 0.12, p = 0, wet = 0.25, attack = 0.004 } = {}) {
  const i0 = at(t), len = at(dur + 0.25), [L, R] = pan(p);
  const phs = Array.from({ length: voices }, (_, v) => (v * 0.37) % 1);
  const det = Array.from({ length: voices }, (_, v) => midi(m + (voices === 1 ? 0 : (v / (voices - 1) - 0.5) * spread * 2)));
  const fl = svf();
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    let x = 0;
    for (let v = 0; v < voices; v++) {
      phs[v] = (phs[v] + det[v] / SR) % 1;
      x += 2 * phs[v] - 1;
    }
    x /= voices;
    const rel = s > dur ? Math.exp(-(s - dur) * 18) : 1;
    const env = Math.min(1, s / attack) * Math.exp(-s * decay) * rel;
    const y = fl(x, 180 + cutoff * Math.exp(-s * decay * 0.8)) * env * gain * 0.2;
    add(synth, i0 + i, y * L, y * R);
    add(send, i0 + i, y * wet);
  }
}
// Noise sweep: riser (up) or whoosh (up and back down).
function sweep(t0, t1, { gain = 1, from = 300, to = 6000, shape = 'riser', p = 0 } = {}) {
  const i0 = at(t0), len = at(t1 - t0), f = svf(), [L, R] = pan(p);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const fc = from * (to / from) ** (shape === 'riser' ? u * u : Math.sin(u * Math.PI));
    const env = shape === 'riser' ? u ** 2.2 : Math.sin(u * Math.PI) ** 2;
    const x = f(rnd(), fc, 0.35) * env * gain * 0.22;
    add(fx, i0 + i, x * L, x * R);
    add(send, i0 + i, x * 0.6);
  }
}
// Simulated tap: a short tuned « tock » on C6 (the fifth of F) with a soft click.
function tap(t, gain = 1) {
  const i0 = at(t), len = at(0.12), f0 = midi(84);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    ph += (2 * Math.PI * f0) / SR;
    const x = (Math.sin(ph) * Math.exp(-s * 55) * 0.5 + (i < 40 ? rnd() * 0.15 : 0)) * gain * 0.32;
    add(fx, i0 + i, x * 0.9, x);
    add(send, i0 + i, x * 0.5);
  }
}
// Bell-ish confirmation, in key.
function bell(t, m, gain = 1, p = 0) {
  const i0 = at(t), len = at(1.4), [L, R] = pan(p);
  const fs = [midi(m), midi(m) * 2.76, midi(m) * 5.4];
  const ps = [0, 0, 0];
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    let x = 0;
    fs.forEach((f, k) => { ps[k] += (2 * Math.PI * f) / SR; x += Math.sin(ps[k]) * Math.exp(-s * (3 + k * 6)) / (1 + k * 1.6); });
    x *= Math.min(1, s / 0.002) * gain * 0.12;
    add(fx, i0 + i, x * L, x * R);
    add(send, i0 + i, x * 0.7);
  }
}
// Impact: deep kick + noise thump + low F.
function impact(t, gain = 1) {
  kick(t, 1.1 * gain, true);
  const i0 = at(t), len = at(0.9), f = svf();
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    const x = f(rnd(), 400 + 2600 * Math.exp(-s * 9)) * Math.exp(-s * 6) * gain * 0.5;
    add(fx, i0 + i, x);
    add(send, i0 + i, x * 0.8);
  }
  subNote(t, 1.0, 29, 0.55 * gain);
}

// --- hook ----------------------------------------------------------------------------------------------
{ // F drone that opens up, low in the mix
  const len = at(3.0), f = svf();
  let p1 = 0, p2 = 0;
  for (let i = 0; i < len; i++) {
    const s = i / SR;
    p1 = (p1 + midi(41) / SR) % 1; p2 = (p2 + midi(41.08) / SR) % 1;
    const pulse = 0.55 + 0.45 * Math.cos(2 * Math.PI * 4 * s) ** 2;
    const x = f((2 * p1 - 1 + 2 * p2 - 1) / 2, 140 + 900 * (s / 3) ** 2) * pulse * Math.min(1, s / 0.3) * 0.16;
    add(bass, i, x);
    add(send, i, x * 0.2);
  }
}
hookKicks.forEach((t, k) => kick(t, k % 2 ? 0.38 : 0.55));
for (let t = 0; t < 3; t += 0.25) hat(t, t % 0.5 ? 0.35 : 0.55, false, 0.3);
[[0.5, 77], [1.5, 80], [2.5, 84]].forEach(([t, m]) => saw(t, 0.18, m, { gain: 0.5, cutoff: 1600, decay: 9, voices: 2, wet: 0.5, p: -0.3 }));
sweep(1.6, 3.0, { gain: 1.1, from: 250, to: 9000 });

// --- « No. » -------------------------------------------------------------------------------------------
impact(3.0, 1);
{ // reverse swell (F minor) into the drop
  const i0 = at(3.45), len = at(0.55);
  const ps = [0, 0, 0, 0];
  const ms = [53, 56, 60, 65];
  for (let i = 0; i < len; i++) {
    const u = i / len;
    let x = 0;
    ms.forEach((m, k) => { ps[k] = (ps[k] + midi(m) / SR) % 1; x += 2 * ps[k] - 1; });
    x = (x / 4) * u ** 3 * 0.12;
    add(synth, i0 + i, x);
    add(send, i0 + i, x * 0.6);
  }
}

// --- groove --------------------------------------------------------------------------------------------
kicks.forEach((t) => kick(t));
impact(19, 0.95);
for (let t = GROOVE[0]; t < GROOVE[1] - 1e-6; t += BEAT) {
  const beat = Math.round((t - GROOVE[0]) / BEAT) % 4;
  if ((beat === 1 || beat === 3) && t < 18) clap(t);
  hat(t + 0.25, 0.55, true, 0.25);
  hat(t + 0.125, 0.2, false, -0.35);
  hat(t + 0.375, 0.2, false, -0.35);
}
for (let k = 0; k < 8; k++) clap(18 + k * 0.125, 0.35 + k * 0.08); // fill into the final hit
sweep(17.9, 19.0, { gain: 1.0, from: 400, to: 10000 });

for (let t = GROOVE[0]; t < GROOVE[1] - 1e-6; t += 0.25) subNote(t, 0.23, chordAt(t).root, 1);
for (let bar = GROOVE[0]; bar < GROOVE[1] - 1e-6; bar += BAR) {
  const c = chordAt(bar);
  [0.25, 0.75, 1.25, 1.5].forEach((o) => {
    if (bar + o >= GROOVE[1]) return;
    c.notes.forEach((m, k) => saw(bar + o, 0.16, m, { gain: 0.55, cutoff: 2600, decay: 10, p: (k - 1) * 0.4, wet: 0.3 }));
  });
}
for (let t = 12; t < 19 - 1e-6; t += 0.125) {
  const c = chordAt(t);
  const step = Math.round((t - 12) / 0.125);
  const m = c.notes[step % 3] + 12 * (step % 6 >= 3 ? 1 : 0);
  saw(t, 0.08, m, { gain: t < 16 ? 0.28 : 0.38, cutoff: 3200, decay: 14, voices: 1, p: step % 2 ? 0.5 : -0.5, wet: 0.45 });
}
[53, 60, 65, 68, 72].forEach((m, k) => saw(19, 2.7, m, { gain: 1.15, cutoff: 2200, decay: 0.38, voices: 3, spread: 0.1, p: (k - 2) * 0.3, wet: 0.6, attack: 0.01 }));

// --- effects written into the music --------------------------------------------------------------------
[8, 12, 16].forEach((t, k) => sweep(t - 0.45, t + 0.1, { gain: 0.7, from: 500, to: 7000, shape: 'whoosh', p: k % 2 ? 0.4 : -0.4 }));
sweep(3.55, 4.02, { gain: 0.6, from: 600, to: 8000, shape: 'whoosh' });
(cues.taps ?? []).forEach((t) => tap(t, 0.6)); // many small taps: kept in the background
(cues.bells ?? []).forEach(([t, m]) => bell(t, m, 1, 0.2));

// --- sidechain -----------------------------------------------------------------------------------------
const duck = new Float32Array(N).fill(1);
kicks.forEach((t) => {
  const i0 = at(t), len = at(0.24);
  for (let i = 0; i < len && i0 + i < N; i++) duck[i0 + i] = Math.min(duck[i0 + i], 0.25 + 0.75 * (i / len) ** 0.6);
});
for (let i = 0; i < N; i++) for (const ch of [0, 1]) { bass[ch][i] *= duck[i]; synth[ch][i] *= 0.4 + 0.6 * duck[i]; }

// --- reverb (Freeverb), shared by music and effects ----------------------------------------------------
function freeverb(input, room = 0.86, damp = 0.35, spreadSamples = 23) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], alls = [556, 441, 341, 225];
  const scale = SR / 44100;
  const out = bus();
  for (const ch of [0, 1]) {
    const off = ch ? spreadSamples : 0;
    const cb = combs.map((d) => ({ buf: new Float32Array(Math.round((d + off) * scale)), i: 0, store: 0 }));
    const ab = alls.map((d) => ({ buf: new Float32Array(Math.round((d + off) * scale)), i: 0 }));
    const y = out[ch];
    for (let n = 0; n < N; n++) {
      const inp = (input[0][n] + input[1][n]) * 0.015;
      let acc = 0;
      for (const c of cb) {
        const o = c.buf[c.i];
        c.store = o * (1 - damp) + c.store * damp;
        c.buf[c.i] = inp + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        acc += o;
      }
      for (const a of ab) {
        const b = a.buf[a.i];
        a.buf[a.i] = acc + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        acc = b - acc;
      }
      y[n] = acc;
    }
  }
  return out;
}
const verb = freeverb(send);

// --- mix + master --------------------------------------------------------------------------------------
const GAINS = { drums: 0.9, bass: 0.85, synth: 0.8, fx: 0.8, verb: 0.9 };
const mix = bus();
const hpL = lp(coef(30)), hpR = lp(coef(30));
const airL = lp(coef(12500)), airR = lp(coef(12500)); // soften the top end: nothing hissy
for (let n = 0; n < N; n++) {
  let l = drums[0][n] * GAINS.drums + bass[0][n] * GAINS.bass + synth[0][n] * GAINS.synth + fx[0][n] * GAINS.fx + verb[0][n] * GAINS.verb;
  let r = drums[1][n] * GAINS.drums + bass[1][n] * GAINS.bass + synth[1][n] * GAINS.synth + fx[1][n] * GAINS.fx + verb[1][n] * GAINS.verb;
  l -= hpL(l); r -= hpR(r);
  l = airL(l); r = airR(r);
  const t = n / SR;
  const fade = t > DUR - 1.2 ? Math.max(0, (DUR - t) / 1.2) ** 1.5 : 1;
  // gentle bus saturation only; loudness is set by loudnorm at the mux
  mix[0][n] = Math.tanh(l * 0.7) * fade;
  mix[1][n] = Math.tanh(r * 0.7) * fade;
}

mkdirSync(join(here, 'audio'), { recursive: true });
const data = Buffer.alloc(N * 2 * 4);
for (let n = 0; n < N; n++) { data.writeFloatLE(mix[0][n], n * 8); data.writeFloatLE(mix[1][n], n * 8 + 4); }
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(3, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 8, 28); hdr.writeUInt16LE(8, 32); hdr.writeUInt16LE(32, 34);
hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
writeFileSync(join(here, 'audio', 'soundtrack.wav'), Buffer.concat([hdr, data]));
console.log('wrote audio/soundtrack.wav');
