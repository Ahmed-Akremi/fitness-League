/** Object storage for user media. Keys are slash-separated, contain a content hash, and are never reused. */
export abstract class StorageService {
  abstract put(key: string, bytes: Buffer, mime: string): Promise<void>;
  abstract url(key: string): string;
  abstract delete(key: string): Promise<void>;
  /** Local driver only (served by /media); S3 objects are served by the bucket/CDN. */
  abstract read(key: string): Promise<{ bytes: Buffer; mime: string } | null>;
}

const KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

export function assertKey(key: string): void {
  if (!KEY.test(key) || key.includes('..') || key.includes('//')) throw new Error('Invalid storage key');
}
