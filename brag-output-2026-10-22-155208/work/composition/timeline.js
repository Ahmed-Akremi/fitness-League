// The whole video: render(t) sets every element for time t (seconds). 120 BPM: a bar = 2 s.
// Screens are real captures of the app (Expo web build, offline demo data), 390×844 at 3×, iPhone safe areas.
const S = (n) => `screens/${n}.png`;

// Tap points in screen px (390×844), measured on the captures.
const P = {
  plus: [317, 78], sport: [195, 168], powerlifting: [195, 366], addExercise: [195, 314], backSquat: [195, 525],
  reps: [120, 427], weight: [246, 427], save: [195, 721], leagueTab: [195, 800], region: [137, 135], gym: [211, 135],
};
const LP_CARD = [16, 110, 358, 184];
// Where things sit: landscape by default; reel.html sets window.LAYOUT for 1080×1920.
const LY = window.LAYOUT ?? {
  H: 1080, center: [960, 540], rise: 980,
  hero: { cx: 1370, cy: 540, s: 1.04 },
  trio: [{ cx: 420, cy: 520, s: 0.74, rot: -4 }, { cx: 960, cy: 520, s: 0.74, rot: 0 }, { cx: 1500, cy: 520, s: 0.74, rot: 4 }],
  label: { top: 870, w: 520 },
};
// When each tap lands (s). Also the soundtrack's tap cues (cues.json).
const TAPS = {
  plus: 8.3, sport: 8.8, powerlifting: 9.3, addExercise: 9.7, backSquat: 10.1, reps: 10.45, weight: 10.8, save: 11.4,
  leagueTab: 12.25, region: 13.45, gym: 14.65,
};
window.TAPS = TAPS;

// What phone A shows, and how each screen arrives: push / pop (navigation), sheet / dismiss (modal), fade, cut.
const PLAN = [
  { at: 0, name: 'home' },
  { at: TAPS.plus + 0.1, name: 'log0', how: 'push' },
  { at: TAPS.sport + 0.1, name: 'log-sport', how: 'sheet' },
  { at: TAPS.powerlifting + 0.1, name: 'log-pl', how: 'dismiss' },
  { at: TAPS.addExercise + 0.1, name: 'log-pick', how: 'sheet' },
  { at: TAPS.backSquat + 0.1, name: 'log-sq', how: 'dismiss' },
  { at: TAPS.reps + 0.17, name: 'log-r5', how: 'cut' },
  { at: TAPS.weight + 0.12, name: 'log-w1', how: 'cut' },
  { at: TAPS.weight + 0.22, name: 'log-w10', how: 'cut' },
  { at: TAPS.weight + 0.32, name: 'log-w105', how: 'cut' },
  { at: TAPS.save + 0.1, name: 'save-a', how: 'cut' },
  { at: TAPS.save + 0.35, name: 'save-b', how: 'pop' },
  { at: TAPS.leagueTab + 0.08, name: 'league-national', how: 'fade', dur: 0.12 },
  { at: TAPS.region + 0.08, name: 'league-region', how: 'fade', dur: 0.12 },
  { at: TAPS.gym + 0.08, name: 'league-gym', how: 'fade', dur: 0.12 },
  { at: 15.95, name: 'battle-new', how: 'fade', dur: 0.3 },
];

// --- build ------------------------------------------------------------------------------------------------
const A = makePhone('phoneA');
const L = {};
for (const { name } of PLAN) L[name] = layer(A, S(name));
const tapA = tapMark(A);
const ring = document.createElement('div');
ring.className = 'ring';
A.querySelector('.screen').appendChild(ring);

const B = makePhone('phoneB'), C = makePhone('phoneC');
layer(B, S('gym'));
layer(C, S('competition'));

// --- frame ------------------------------------------------------------------------------------------------
function phoneAt(el, cx, cy, scale = 1, rot = 0, opacity = 1) {
  set(el, opacity, `translate(${cx - 209}px, ${cy - 436}px) rotate(${rot}deg) scale(${scale})`);
}
function textIn(el, t, t0, dy = 36) {
  const u = easeOutExpo(seg(t, t0, t0 + 0.45));
  set(el, u, `translateY(${(1 - u) * dy}px)`);
}
// A scene's text column: children stagger in from tIn, the column leaves (left, fading) from tOut.
function column(id, t, tIn, tOut) {
  const col = $(id);
  if (t < tIn - 0.01 || t > tOut + 0.3) { set(col, 0); return; }
  const out = easeIn(seg(t, tOut, tOut + 0.25));
  set(col, 1 - out, `translateX(${-60 * out}px)`);
  [...col.children].forEach((c, i) => textIn(c, t, tIn + i * 0.08));
}
function screens(t) {
  Object.values(L).forEach((img) => { set(img, 0); img.style.filter = ''; img.style.boxShadow = ''; img.style.zIndex = ''; });
  let i = -1;
  PLAN.forEach((s, k) => { if (t >= s.at) i = k; });
  if (i < 0) return;
  const cur = PLAN[i], prev = PLAN[i - 1];
  const u = seg(t, cur.at, cur.at + (cur.dur ?? 0.34));
  const [a, b] = [prev && L[prev.name], L[cur.name]];
  if (!prev || u >= 1 || cur.how === 'cut') { set(b, 1); return; }
  const e = easeOutExpo(u);
  switch (cur.how) {
    case 'push': // new screen slides in from the right over the dimmed old one
      set(a, 1, `translateX(${-110 * e}px)`); a.style.filter = `brightness(${1 - 0.45 * e})`;
      set(b, 1, `translateX(${390 * (1 - e)}px)`); b.style.boxShadow = '-24px 0 40px rgba(0,0,0,.5)'; b.style.zIndex = 2;
      break;
    case 'pop': // old screen slides out to the right, revealing the one underneath
      set(b, 1, `translateX(${-110 * (1 - e)}px)`); b.style.filter = `brightness(${0.55 + 0.45 * e})`;
      set(a, 1, `translateX(${390 * e}px)`); a.style.boxShadow = '-24px 0 40px rgba(0,0,0,.5)'; a.style.zIndex = 2;
      break;
    case 'sheet': // modal rises from the bottom
      set(a, 1); a.style.filter = `brightness(${1 - 0.4 * e})`;
      set(b, 1, `translateY(${844 * (1 - e)}px)`); b.style.zIndex = 2;
      break;
    case 'dismiss': // modal drops away
      set(b, 1); b.style.filter = `brightness(${0.6 + 0.4 * e})`;
      set(a, 1, `translateY(${844 * e}px)`); a.style.zIndex = 2;
      break;
    default: // fade
      set(a, 1); set(b, easeOut(u)); b.style.zIndex = 2;
  }
}

window.render = (t) => {
  // background glow follows the action
  const glow = $('#glow');
  const [mx, my] = LY.center, [hx, hy] = [LY.hero.cx, LY.hero.cy];
  const g = t < 3.7 ? 0 : t < 15.9 ? easeInOut(seg(t, 3.7, 4.4)) : t < 19 ? 1 - easeInOut(seg(t, 15.9, 16.5)) : 0;
  const [gx, gy] = [lerp(mx, hx, g), lerp(my, hy, g)];
  const gs = t >= 19 ? 1 + 0.25 * easeOut(seg(t, 19, 20)) : 1;
  set(glow, t < 3 ? 0.55 + 0.45 * seg(t, 0, 3) : 1, `translate(${gx - 700}px, ${gy - 700}px) scale(${gs})`);
  set($('#grid'), 1, `translate(${-t * 6}px, ${-t * 3}px)`);

  // 1 · hook
  const hook = $('#hook');
  if (t < 3) {
    set(hook, 1, `scale(${1 + 0.04 * easeOut(seg(t, 0, 3))})`);
    const starts = [0, 0.04, 0.08, 0.12, 0.16, 0.25, 0.36, 0.41, 0.46]; // STRONG lands on the second heartbeat kick
    $$('#hook .word').forEach((w, i) => {
      const u = easeOutExpo(seg(t, starts[i], starts[i] + (i === 5 ? 0.22 : 0.16)));
      set(w, u, i === 5 ? `scale(${lerp(1.5, 1, u)})` : `translateY(${(1 - u) * 40}px)`);
    });
  } else set(hook, 0);

  // 2 · « No. » — hard cut on 3.0, wipes up into the reveal
  const no = $('#no');
  if (t >= 3 && t < 4.05) {
    const s = t - 3;
    const hit = easeOutExpo(seg(s, 0, 0.16));
    const shake = 16 * Math.exp(-11 * s) * Math.sin(2 * Math.PI * 17 * s);
    const wipe = easeInOut(seg(t, 3.62, 4.02));
    set(no, 1, `translateY(${-(LY.H + 20) * wipe}px)`);
    no.firstElementChild.style.transform = `translate(${shake}px, ${shake * 0.4}px) scale(${lerp(1.35, 1, hit)})`;
  } else set(no, 0);
  // the vignette would muddy the lime: it comes back as the wipe uncovers the dark stage
  set($('#vignette'), t >= 3 && t < 4.05 ? easeInOut(seg(t, 3.62, 4.02)) : 1);

  // 3 · reveal · 4 · log · 5 · climb
  column('#c-reveal', t, 3.95, 7.72);
  column('#c-log', t, 8.02, 11.72);
  column('#c-climb', t, 12.02, 15.72);
  const switches = [0, TAPS.region, TAPS.gym];
  const k = t < TAPS.region + 0.1 ? 0 : t < TAPS.gym + 0.1 ? 1 : 2;
  $$('.scope').forEach((s, i) => (s.style.color = i === k ? 'var(--lime)' : i < k ? 'var(--text)' : '#3a3f48'));
  const ranks = [['#2', 'in Tunisia'], ['#1', 'in Sousse'], ['#1', 'at Bodynade']];
  $('#rank-num').textContent = ranks[k][0];
  $('#rank-where').textContent = ranks[k][1];
  const flip = k === 0 ? 1 : easeOutExpo(seg(t, switches[k] + 0.1, switches[k] + 0.45));
  for (const el of [$('#rank-num'), $('#rank-where')]) {
    el.style.display = 'inline-block';
    el.style.opacity = String(flip);
    el.style.transform = `translateY(${(1 - flip) * 40}px)`;
  }

  // phone A: the hero phone from 3.7 to 16, then the left phone of the trio
  if (t >= 3.6 && t < 19) {
    const rise = spring(t, 3.72, 1.5, 5.5);
    const { hero, trio: [left] } = LY;
    let cx = hero.cx, cy = hero.cy + LY.rise * (1 - rise) + Math.sin(t * 0.9) * 4, sc = hero.s, rot = 5 * (1 - rise);
    if (t >= 15.85) {
      const m = easeInOut(seg(t, 15.85, 16.45));
      cx = lerp(hero.cx, left.cx, m); cy = lerp(cy, left.cy, m); sc = lerp(hero.s, left.s, m); rot = lerp(0, left.rot, m);
    }
    const o = easeIn(seg(t, 18.8, 19));
    phoneAt(A, cx, cy, sc * (1 - 0.15 * o), rot, 1 - o);
    screens(t);
    // the newest tap wins: its arrival cuts the previous release short
    const tap = Object.entries(TAPS).filter(([, at]) => t > at - 0.3 && t < at + 0.45).pop();
    if (tap) showTap(tapA, t, tap[1], ...P[tap[0]]); else set(tapA, 0);
    // the LP card lights up during the reveal
    const r = seg(t, 5.3, 5.6) * (1 - seg(t, 7.5, 7.75));
    const [x, y, w, h] = LP_CARD;
    Object.assign(ring.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    set(ring, r * (0.75 + 0.25 * Math.sin((t - 5.3) * 6)));
  } else set(A, 0);

  // 6 · trio
  const trioOut = easeIn(seg(t, 18.8, 19));
  if (t >= 15.9 && t < 19) {
    [[B, LY.trio[1], 16.12], [C, LY.trio[2], 16.27]].forEach(([ph, p, t0]) => {
      const u = spring(t, t0, 1.6, 6);
      phoneAt(ph, p.cx, p.cy + 700 * (1 - u), p.s * (1 - 0.15 * trioOut), p.rot, 1 - trioOut);
    });
    const head = $('#trio-head');
    textIn(head, t, 16.0);
    head.style.opacity = String(Number(head.style.opacity) * (1 - trioOut));
    ['#lab0', '#lab1', '#lab2'].forEach((id, i) => {
      const el = $(id);
      el.style.width = LY.label.w + 'px';
      el.style.left = LY.trio[i].cx - LY.label.w / 2 + 'px'; el.style.top = LY.label.top + 'px';
      const u = easeOutExpo(seg(t, 16.35 + i * 0.15, 16.8 + i * 0.15));
      set(el, u * (1 - trioOut), `translateY(${(1 - u) * 30}px)`);
    });
  } else {
    [B, C, $('#trio-head'), $('#lab0'), $('#lab1'), $('#lab2')].forEach((el) => set(el, 0));
  }

  // 7 · outro
  const outro = $('#outro');
  if (t >= 19) {
    set(outro, 1, `scale(${1 + 0.03 * easeOut(seg(t, 19, 22))})`);
    const [logo, h1, stores, langs] = outro.children;
    set(logo, Math.min(1, (t - 19) / 0.08), `scale(${spring(t, 19.0, 2.4, 7)})`);
    textIn(h1, t, 19.1, 50);
    textIn(stores, t, 19.32);
    textIn(langs, t, 19.45);
  } else set(outro, 0);
};

// Ready when the fonts and every capture are decoded.
Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]).then(() => {
  render(0);
  window.ready = true;
});
