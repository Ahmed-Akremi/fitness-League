/** Files under public/, shared by every language. `og` is used by index.html. */
export const media = {
  hero: '/media/hero.webp',
  heroSmall: '/media/hero-800.webp',
  og: '/media/og.jpg',
  athletes: '/media/athletes.webp',
  gyms: '/media/gyms.webp',
  organizers: '/media/organizers.webp',
  logo: '/media/logo.png',
  favicon: '/favicon.png',
  tutorial: '/media/tutorial.mp4',
  screens: {
    home: '/media/screen-home.webp',
    league: '/media/screen-league.webp',
    train: '/media/screen-train.webp',
    competitions: '/media/screen-competitions.webp',
    gym: '/media/screen-gym.webp',
  },
} as const;
