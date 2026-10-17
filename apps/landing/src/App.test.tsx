import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { FinalCta } from './components/FinalCta';
import { copies, LANGS, STORAGE_KEY, type Lang } from './content';
import { mailto } from './links';
import { media } from './media';

beforeEach(() => {
  localStorage.clear();
  if (!document.querySelector('meta[name="description"]')) {
    const meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
});

function openIn(lang: Lang) {
  window.history.replaceState(null, '', `/?lang=${lang}`);
  return render(<App />);
}

it('opens in the language of the address and lays Arabic out right to left', () => {
  openIn('ar');
  expect(document.documentElement).toHaveAttribute('lang', 'ar');
  expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  expect(document.title).toBe(copies.ar.meta.title);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copies.ar.hero.title);
});

it('switching language updates the page, the address and the stored choice', async () => {
  openIn('ar');
  await userEvent.click(screen.getAllByRole('button', { name: 'English' })[0]);
  expect(document.documentElement).toHaveAttribute('lang', 'en');
  expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  expect(new URLSearchParams(window.location.search).get('lang')).toBe('en');
  expect(localStorage.getItem(STORAGE_KEY)).toBe('en');
  expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', copies.en.meta.description);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copies.en.hero.title);
});

it.each(LANGS)('every image and the video have a text alternative in %s', (lang) => {
  const { container } = openIn(lang);
  const images = [...container.querySelectorAll('img')];
  expect(images.length).toBeGreaterThanOrEqual(10);
  for (const img of images) {
    expect(img.hasAttribute('alt'), img.src).toBe(true);
    // The logo sits in a link that already says "Fitness League": its alt is empty on purpose.
    if (!img.closest('.brand')) expect(img.alt.trim(), img.src).not.toBe('');
  }
  expect(container.querySelector('video')).toHaveAttribute('aria-label', copies[lang].competitions.videoLabel);
});

it('every button writes to the team with the subject of its audience', () => {
  openIn('en');
  const t = copies.en;
  const href = (name: string) => screen.getAllByRole('link', { name })[0].getAttribute('href');
  expect(href(t.audienceCta.athlete)).toMatch(/^mailto:ahmedakremi42@gmail\.com\?subject=/);
  expect(href(t.audienceCta.athlete)).toBe(mailto(t.mail.athlete));
  expect(href(t.athletes.cta)).toBe(mailto(t.mail.athlete));
  expect(href(t.competitions.cta)).toBe(mailto(t.mail.athlete));
  expect(href(t.audienceCta.gym)).toBe(mailto(t.mail.gym));
  expect(href(t.gyms.cta)).toBe(mailto(t.mail.gym));
  expect(href(t.audienceCta.organizer)).toBe(mailto(t.mail.organizer));
  expect(href(t.organizers.cta)).toBe(mailto(t.mail.organizer));
  expect(href(t.nav.contact)).toBe(mailto(t.mail.contact));
});

it('the FAQ opens one answer at a time', async () => {
  openIn('en');
  const [first, second] = copies.en.faq.items;
  const q1 = screen.getByRole('button', { name: first.q });
  const q2 = screen.getByRole('button', { name: second.q });
  expect(q1).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(first.a)).toBeVisible();

  await userEvent.click(q2);
  expect(q2).toHaveAttribute('aria-expanded', 'true');
  expect(q1).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(first.a)).not.toBeVisible();

  await userEvent.click(q2);
  expect(q2).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(second.a)).not.toBeVisible();
});

it('the phone menu closes with Escape and after choosing a link', async () => {
  openIn('en');
  const t = copies.en;
  const toggle = screen.getByRole('button', { name: t.nav.menu });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveAccessibleName(t.nav.closeMenu);

  await userEvent.keyboard('{Escape}');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(toggle);
  await userEvent.click(within(document.getElementById('site-menu')!).getByRole('link', { name: t.nav.faq }));
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

it('the video downloads nothing before play and offers a link when it cannot play', () => {
  const { container } = openIn('fr');
  const video = container.querySelector('video')!;
  expect(video).toHaveAttribute('preload', 'none');
  expect(video.querySelector('source')).toHaveAttribute('src', media.tutorial);
  expect(within(video).getByRole('link', { name: copies.fr.competitions.videoDownload })).toHaveAttribute('href', media.tutorial);
});

it('keeps the email address left to right on the Arabic page', () => {
  openIn('ar');
  expect(screen.getByText('ahmedakremi42@gmail.com').closest('bdi')).toHaveAttribute('dir', 'ltr');
});

it('shows WhatsApp only once a number is configured', () => {
  const t = copies.en;
  const { rerender } = render(<FinalCta t={t} whatsapp="" />);
  expect(screen.queryByRole('link', { name: t.whatsapp.label })).toBeNull();
  rerender(<FinalCta t={t} whatsapp="+216 20 123 456" />);
  expect(screen.getByRole('link', { name: t.whatsapp.label })).toHaveAttribute('href', 'https://wa.me/21620123456?text=Hello%20Fitness%20League!');
});

it('shows no demo event: the competitions-list screenshot (date, city, fee) is nowhere on the page', () => {
  const { container } = openIn('en');
  expect(container.querySelector('[src*="screen-competitions"], [poster*="screen-competitions"]')).toBeNull();
});

it('replaces a video that fails to load with the text and the download link', () => {
  const { container } = openIn('en');
  const c = copies.en.competitions;
  fireEvent.error(container.querySelector('video source')!);
  expect(container.querySelector('video')).toBeNull();
  expect(screen.getByText(c.videoFallback, { exact: false })).toBeVisible();
  expect(screen.getByRole('link', { name: c.videoDownload })).toHaveAttribute('href', media.tutorial);
});

it('puts the phone menu next in keyboard order and gives focus back on Escape', async () => {
  openIn('en');
  const t = copies.en;
  const toggle = screen.getByRole('button', { name: t.nav.menu });
  await userEvent.click(toggle);
  await userEvent.tab();
  expect(document.activeElement).toHaveAccessibleName(t.nav.athletes);
  await userEvent.keyboard('{Escape}');
  expect(toggle).toHaveFocus();
});
