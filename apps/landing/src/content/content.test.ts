import { copies, LANGS } from '.';

/** Every path in the object (`faq.items[2].a`, …) with its value. */
function flatten(value: unknown, path = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) value.forEach((item, i) => flatten(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) flatten(item, path ? `${path}.${key}` : key, out);
  else out.set(path, value);
  return out;
}

it.each(LANGS)('%s has every text English has, and none is empty', (lang) => {
  const english = flatten(copies.en);
  const other = flatten(copies[lang]);
  expect([...other.keys()].sort()).toEqual([...english.keys()].sort());
  for (const [path, text] of other) {
    expect(typeof text, path).toBe('string');
    expect(String(text).trim(), path).not.toBe('');
  }
});

it('uses the subjects the spec gives', () => {
  expect(copies.en.mail).toEqual({
    athlete: 'Athlete – join Fitness League',
    gym: 'Gym – register',
    organizer: 'Organizer – host an event',
    contact: 'Contact',
  });
});
