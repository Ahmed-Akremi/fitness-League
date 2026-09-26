import { HealthDataCipher } from './health-data-cipher';

const k = (id: string, fill: number) => ({ id, key: Buffer.alloc(32, fill) });

describe('HealthDataCipher', () => {
  it('round-trips values and never stores the plaintext', () => {
    const c = new HealthDataCipher([k('k1', 1)]);
    const blob = c.encryptNumber(82.4);
    expect(blob.toString('latin1')).not.toContain('82.4');
    expect(c.decryptNumber(blob)).toBe(82.4);
  });

  it('uses a fresh IV every time', () => {
    const c = new HealthDataCipher([k('k1', 1)]);
    expect(c.encrypt('70').equals(c.encrypt('70'))).toBe(false);
  });

  it('keeps old ciphertexts readable after rotation', () => {
    const old = new HealthDataCipher([k('k1', 1)]);
    const blob = old.encrypt('75');
    const rotated = new HealthDataCipher([k('k2', 2), k('k1', 1)]);
    expect(rotated.activeKeyId).toBe('k2');
    expect(rotated.decrypt(blob)).toBe('75');
  });

  it('detects tampering', () => {
    const c = new HealthDataCipher([k('k1', 1)]);
    const blob = c.encrypt('75');
    blob[blob.length - 1] ^= 0xff;
    expect(() => c.decrypt(blob)).toThrow();
  });
});
