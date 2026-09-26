import { base32Decode, base32Encode, hotp, newTotpSecret, totp, verifyTotp } from './totp';

describe('TOTP (RFC 4226 / 6238)', () => {
  const rfcSecret = Buffer.from('12345678901234567890');

  it('matches the RFC 4226 HOTP test vectors', () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(rfcSecret, c))).toEqual(['755224', '287082', '359152', '969429', '520489']);
  });

  it('matches the RFC 6238 SHA-1 vectors (8 digits)', () => {
    const b32 = base32Encode(rfcSecret);
    expect(totp(b32, new Date(59_000), 8)).toBe('94287082');
    expect(totp(b32, new Date(1_111_111_109_000), 8)).toBe('07081804');
    expect(totp(b32, new Date(20_000_000_000_000), 8)).toBe('65353130');
  });

  it('round-trips base32', () => {
    const s = newTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts one step of clock drift, not more', () => {
    const s = newTotpSecret();
    const now = new Date('2026-09-26T12:00:10Z');
    expect(verifyTotp(s, totp(s, now), now)).toBe(true);
    expect(verifyTotp(s, totp(s, new Date(now.getTime() - 30_000)), now)).toBe(true);
    expect(verifyTotp(s, totp(s, new Date(now.getTime() - 90_000)), now)).toBe(false);
    expect(verifyTotp(s, 'abcdef', now)).toBe(false);
  });
});
