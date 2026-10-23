// Captures composition/index.html frame by frame in the headless Chrome on port 9333 (served on :8791).
// Usage: node render.mjs --only 1.2,3.05,…   → stills/t1.20.png …
//        node render.mjs                      → silent.mp4 (30 fps, 22 s), frames piped straight into ffmpeg
// Reel: PAGE=reel.html W=1080 H=1920 OUT=silent-reel.mp4 STILLS=stills-reel node render.mjs …
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30, DURATION = 22, URL = `http://127.0.0.1:8791/${process.env.PAGE ?? 'index.html'}`;
const W = Number(process.env.W ?? 1920), H = Number(process.env.H ?? 1080);
const OUT = process.env.OUT ?? 'silent.mp4', STILLS = process.env.STILLS ?? 'stills';
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(',').map(Number) : null;

const target = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'JS error');
  return r.result.value;
};

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 300 && !(await evaluate('window.ready === true').catch(() => false)); i++) await sleep(100);
  if (!(await evaluate('window.ready === true'))) throw new Error('composition did not load');

  if (only) {
    mkdirSync(join(here, STILLS), { recursive: true });
    for (const t of only) {
      await evaluate(`render(${t})`);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(here, STILLS, `t${t.toFixed(2)}.png`), Buffer.from(data, 'base64'));
    }
    console.log(`${only.length} stills`);
  } else {
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), join(here, OUT)], { stdio: ['pipe', 'inherit', 'inherit'] });
    const total = FPS * DURATION;
    for (let f = 0; f < total; f++) {
      await evaluate(`render(${f / FPS})`);
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 96 });
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 60 === 0) console.log(`${f}/${total}`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`wrote ${OUT}`);
  }
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:9333/json/close/${target.id}`).catch(() => {});
}
