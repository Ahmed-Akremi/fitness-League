import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf-8');

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

// Arabic letters join: letter spacing pulls them apart (some browsers apply it anyway).
it.each(['eyebrow', 'store-note', 'footer-title'])('Arabic text in .%s has no letter spacing', (className) => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  document.documentElement.lang = 'ar';
  const el = document.createElement('p');
  el.className = className;
  document.body.append(el);
  expect(['0', '0px', 'normal']).toContain(getComputedStyle(el).letterSpacing);
});
