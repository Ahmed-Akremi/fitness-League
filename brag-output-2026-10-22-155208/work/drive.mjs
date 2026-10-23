// Drives the headless Chrome started on port 9333 through the DevTools protocol, step by step.
// Usage: node drive.mjs '<json steps>'   or   node drive.mjs steps.json
// Steps: {viewport:[w,h,dpr]} {go:url} {wait:ms} {click:"text"|"#testID"|[x,y]} {type:"text"} {key:"Enter"}
//        {scroll:[x,y,dy]} {shot:"file.png"} {eval:"js"} {dump:true} {scheme:"dark"|"light"}
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = process.argv[2];
const steps = JSON.parse(existsSync(arg) ? readFileSync(arg, 'utf8') : arg);

async function connect(port = 9333) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  return { ws, send, evaluate };
}

// Centre of the last visible element whose text or label matches (or a testID with « # »).
const FIND = (q) => `(() => {
  const q = ${JSON.stringify(q)};
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  let els;
  if (q.startsWith('#')) els = [...document.querySelectorAll('[data-testid="' + q.slice(1) + '"]')];
  else els = [...document.querySelectorAll('*')].filter((el) => (el.getAttribute('aria-label') ?? '') === q || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === q));
  els = els.filter(vis);
  if (!els.length) return null;
  const r = els[els.length - 1].getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
})()`;

const { ws, send, evaluate } = await connect();
await send('Page.enable');
try {
  for (const s of steps) {
    if (s.viewport) {
      const [width, height, dpr] = s.viewport;
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr ?? 1, mobile: true });
    } else if (s.safe) {
      const [top, bottom] = s.safe;
      await send('Emulation.setSafeAreaInsetsOverride', { insets: { top, topMax: top, bottom, bottomMax: bottom, left: 0, leftMax: 0, right: 0, rightMax: 0 } });
    } else if (s.ifat) {
      // {ifat:"/verify-email", click:"#verify-continue"}: only when the app sits on that page
      if (!(await evaluate('location.pathname')).startsWith(s.ifat)) continue;
      const xy = await evaluate(FIND(s.then));
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: xy[0], y: xy[1], button: 'left', clickCount: 1, pointerType: 'mouse' });
      }
      await sleep(s.settle ?? 3000);
    } else if (s.scheme) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: s.scheme }] });
    } else if (s.go) {
      await send('Page.navigate', { url: s.go });
      await sleep(s.settle ?? 2500);
    } else if (s.wait) {
      await sleep(s.wait);
    } else if (s.click) {
      const xy = Array.isArray(s.click) ? s.click : await evaluate(FIND(s.click));
      if (!xy) throw new Error(`not found: ${s.click}`);
      const [x, y] = xy;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
      }
      console.log('clicked', s.click, Math.round(x), Math.round(y));
      await sleep(s.settle ?? 900);
    } else if (s.type) {
      await send('Input.insertText', { text: s.type });
      await sleep(300);
    } else if (s.key) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key, code: s.key, windowsVirtualKeyCode: s.key === 'Enter' ? 13 : 0 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key, code: s.key });
      await sleep(300);
    } else if (s.scroll) {
      const [x, y, dy] = s.scroll;
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
      await sleep(s.settle ?? 600);
    } else if (s.shot) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(s.shot, Buffer.from(data, 'base64'));
      console.log('shot', s.shot);
    } else if (s.eval) {
      console.log(JSON.stringify(await evaluate(s.eval)));
    } else if (s.dump) {
      console.log(await evaluate(`[...document.querySelectorAll('[data-testid]')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.dataset.testid + ' @' + Math.round(e.getBoundingClientRect().y)).join('\\n')`));
      console.log('---');
      console.log(await evaluate('document.body.innerText.slice(0, 3000)'));
    }
  }
} finally {
  ws.close();
}
