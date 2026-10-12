import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { copies } from '../content';
import { mailto } from '../links';
import { AudienceCtas } from './Cta';
import { LangSwitch } from './LangSwitch';
import { Reveal } from './Reveal';
import { StoreBadges } from './StoreBadges';

it('audience buttons email the team with their own subject', () => {
  const t = copies.fr;
  render(<AudienceCtas t={t} />);
  expect(screen.getByRole('link', { name: t.audienceCta.athlete })).toHaveAttribute('href', mailto(t.mail.athlete));
  expect(screen.getByRole('link', { name: t.audienceCta.gym })).toHaveAttribute('href', mailto(t.mail.gym));
  expect(screen.getByRole('link', { name: t.audienceCta.organizer })).toHaveAttribute('href', mailto(t.mail.organizer));
});

it('store badges say "coming soon" until a store link exists', () => {
  const t = copies.fr;
  const { rerender } = render(<StoreBadges t={t} stores={{ appStore: '', googlePlay: '' }} />);
  expect(screen.getAllByText(t.stores.soon)).toHaveLength(2);
  expect(screen.queryAllByRole('link')).toHaveLength(0);

  rerender(<StoreBadges t={t} stores={{ appStore: 'https://apps.apple.com/app/id1', googlePlay: '' }} />);
  expect(screen.getByRole('link', { name: /App Store/ })).toHaveAttribute('href', 'https://apps.apple.com/app/id1');
  expect(screen.getAllByText(t.stores.soon)).toHaveLength(1);
});

it('the language switch marks the current language and reports a choice', async () => {
  const onLang = vi.fn();
  render(<LangSwitch lang="fr" onLang={onLang} label="Langue" />);
  expect(screen.getByRole('group', { name: 'Langue' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(screen.getByRole('button', { name: 'العربية' }));
  expect(onLang).toHaveBeenCalledWith('ar');
});

describe('Reveal', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows its content at once where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Reveal><p>Hello</p></Reveal>);
    expect(screen.getByText('Hello').parentElement).toHaveClass('reveal', 'is-visible');
  });

  it('shows its content at once when the visitor asks for reduced motion', () => {
    vi.stubGlobal('IntersectionObserver', class {});
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    render(<Reveal><p>Hello</p></Reveal>);
    expect(screen.getByText('Hello').parentElement).toHaveClass('is-visible');
  });

  it('otherwise waits until it scrolls into view', () => {
    let notify: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    render(<Reveal><p>Hello</p></Reveal>);
    const box = screen.getByText('Hello').parentElement!;
    expect(box).not.toHaveClass('is-visible');
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(box).toHaveClass('is-visible');
    expect(disconnect).toHaveBeenCalled();
  });
});
