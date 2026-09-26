import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for health data (docs §3.1). Ciphertext layout: [keyIdLen:1][keyId][iv:12][tag:16][data].
 * Carrying the key id inside the blob lets old rows stay readable after a key rotation.
 */
export class HealthDataCipher {
  private readonly byId: Map<string, Buffer>;

  constructor(private readonly keys: { id: string; key: Buffer }[]) {
    if (!keys.length) throw new Error('At least one health-data key is required');
    this.byId = new Map(keys.map((k) => [k.id, k.key]));
  }

  get activeKeyId(): string {
    return this.keys[0]!.id;
  }

  encrypt(plain: string): Buffer {
    const { id, key } = this.keys[0]!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const idBuf = Buffer.from(id, 'utf8');
    return Buffer.concat([Buffer.from([idBuf.length]), idBuf, iv, cipher.getAuthTag(), data]);
  }

  decrypt(blob: Uint8Array): string {
    const buf = Buffer.from(blob);
    const idLen = buf[0]!;
    const id = buf.subarray(1, 1 + idLen).toString('utf8');
    const key = this.byId.get(id);
    if (!key) throw new Error(`Unknown health-data key id "${id}"`);
    const iv = buf.subarray(1 + idLen, 13 + idLen);
    const tag = buf.subarray(13 + idLen, 29 + idLen);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(29 + idLen)), decipher.final()]).toString('utf8');
  }

  encryptNumber(n: number): Buffer {
    return this.encrypt(String(n));
  }

  decryptNumber(blob: Uint8Array): number {
    return Number(this.decrypt(blob));
  }
}
