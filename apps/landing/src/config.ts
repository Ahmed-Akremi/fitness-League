/** What the owner edits before going public. An empty string means "not available yet". */
export interface SiteConfig {
  contactEmail: string;
  /** International format, e.g. '+216 20 123 456'. Empty: the WhatsApp button is hidden. */
  whatsapp: string;
  /** Store page URLs. Empty: the badge reads "Coming soon". */
  stores: { appStore: string; googlePlay: string };
}

export const config: SiteConfig = {
  contactEmail: 'ahmedakremi42@gmail.com',
  whatsapp: '',
  stores: { appStore: '', googlePlay: '' },
};
