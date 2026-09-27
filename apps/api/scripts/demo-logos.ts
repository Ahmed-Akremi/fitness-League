import sharp from 'sharp';

export type Motif = 'bolt' | 'wave' | 'hex' | 'peak' | 'ring' | 'bar';

const MOTIFS: Record<Motif, string> = {
  bolt: '<path d="M290 96 L196 262 H258 L218 400 L330 214 H266 Z" fill="FG"/>',
  wave: '<path d="M96 300 Q176 220 256 300 T416 300" stroke="FG" stroke-width="34" fill="none" stroke-linecap="round"/><path d="M96 220 Q176 140 256 220 T416 220" stroke="FG" stroke-width="18" fill="none" stroke-linecap="round" opacity=".6"/>',
  hex: '<path d="M256 92 L390 170 V326 L256 404 L122 326 V170 Z" stroke="FG" stroke-width="30" fill="none"/><path d="M256 170 L322 208 V284 L256 322 L190 284 V208 Z" fill="FG"/>',
  peak: '<path d="M96 372 L208 164 L268 262 L320 192 L416 372 Z" fill="FG"/>',
  ring: '<circle cx="256" cy="248" r="126" stroke="FG" stroke-width="34" fill="none"/><circle cx="256" cy="248" r="50" fill="FG"/>',
  bar: '<rect x="96" y="232" width="320" height="34" rx="10" fill="FG"/><rect x="118" y="172" width="42" height="154" rx="10" fill="FG"/><rect x="352" y="172" width="42" height="154" rx="10" fill="FG"/>',
};

/** Original, fictional logo: gradient tile, geometric motif, initials. No real brand. */
export async function renderLogoPng(name: string, [from, to]: [string, string], motif: Motif, fg = '#0E0F12'): Promise<Buffer> {
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="512" height="512" rx="120" fill="url(#g)"/>
    <g opacity=".92">${MOTIFS[motif].replaceAll('FG', fg)}</g>
    <text x="256" y="472" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="62" fill="${fg}" letter-spacing="8">${initials}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
