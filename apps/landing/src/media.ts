/** Files under public/, shared by every language. `og` is used by index.html. */
export const media = {
  hero: '/media/hero.webp',
  heroSmall: '/media/hero-800.webp',
  og: '/media/og.jpg',
  athletes: '/media/athletes.webp',
  gyms: '/media/gyms.webp',
  organizers: '/media/organizers.webp',
  logo: '/media/logo.svg',
  /** Apple touch icon, used by index.html. */
  logoPng: '/media/logo.png',
  faviconSvg: '/favicon.svg',
  favicon: '/favicon.png',
  tutorial: '/media/tutorial.mp4',
  /** Text-free poster drawn from the logo: the app's competition screens show a demo event with a date and a fee. */
  videoPoster: '/media/video-poster.webp',
  screens: {
    home: '/media/screen-home.webp',
    league: '/media/screen-league.webp',
    train: '/media/screen-train.webp',
    gym: '/media/screen-gym.webp',
  },
} as const;
