import en from '../../src/core/i18n/en.json';

const fs = jest.requireActual<typeof import('fs')>('fs');
const path = jest.requireActual<typeof import('path')>('path');

const messages = en as Record<string, string>;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sources(p) : /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

/** Placeholder names of an ICU message: `{name}` and the argument of `{count, plural, …}`. */
function placeholders(message: string): Set<string> {
  return new Set([...message.matchAll(/\{(\w+)(?:\}|,\s*plural)/g)].map((m) => m[1]));
}

/** Top-level keys of the object literal passed to t(): `{ a: x, b }` → a, b. */
function argNames(literal: string): Set<string> {
  let depth = 0;
  let part = '';
  const parts: string[] = [];
  for (const ch of literal) {
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(part);
      part = '';
    } else part += ch;
  }
  parts.push(part);
  return new Set(parts.map((p) => p.split(':')[0].trim()).filter(Boolean));
}

describe('translation calls', () => {
  const calls: { file: string; key: string; args: Set<string> }[] = [];
  for (const file of sources(path.join(__dirname, '../../src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\('(\w+)'(?:,\s*\{)?/g)) {
      let args = new Set<string>();
      if (m[0].endsWith('{')) {
        let depth = 1;
        let i = m.index! + m[0].length;
        const start = i;
        while (depth > 0 && i < text.length) {
          if (text[i] === '{') depth++;
          if (text[i] === '}') depth--;
          i++;
        }
        args = argNames(text.slice(start, i - 1));
      }
      calls.push({ file: path.relative(path.join(__dirname, '../..'), file), key: m[1], args });
    }
  }

  it('finds the calls', () => {
    expect(calls.length).toBeGreaterThan(100);
  });

  it('passes exactly the placeholders each message uses', () => {
    const problems = calls.flatMap(({ file, key, args }) => {
      if (!(key in messages)) return [`${file}: unknown key ${key}`];
      const wanted = placeholders(messages[key]);
      const missing = [...wanted].filter((p) => !args.has(p));
      const extra = [...args].filter((a) => !wanted.has(a));
      return missing.length || extra.length ? [`${file}: ${key} missing [${missing}] extra [${extra}]`] : [];
    });
    expect(problems).toEqual([]);
  });
});
