export interface Credit {
  /** File name under public/media. */
  file: string;
  photographer: string;
  /** The photo's Unsplash page. */
  source: string;
}

/** Unsplash License: free for commercial use; credit given anyway. Keep CREDITS.md in step. */
export const credits: Credit[] = [
  { file: 'hero.webp', photographer: 'Rodrigo Rodrigues | WOLF Λ R T', source: 'https://unsplash.com/photos/woman-lifting-a-heavy-barbell-in-a-gym-78E-sY8mVsM' },
  { file: 'athletes.webp', photographer: 'Meghan Holmes', source: 'https://unsplash.com/photos/people-performing-box-jumps-workout-wy_L8W0zcpI' },
  { file: 'gyms.webp', photographer: 'Vitaly Gariev', source: 'https://unsplash.com/photos/man-and-woman-exercising-with-battle-ropes-fnLjFrBjHm8' },
  { file: 'organizers.webp', photographer: 'Putri Ardhia', source: 'https://unsplash.com/photos/woman-checks-scores-at-a-weightlifting-competition-81FJsFw2ocM' },
];
