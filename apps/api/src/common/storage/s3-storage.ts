import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertKey, StorageService } from './storage.service';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

/** Production driver: S3 or MinIO (path-style). Objects are public-read through MEDIA_PUBLIC_BASE_URL (CDN). */
export class S3Storage extends StorageService {
  private readonly client: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    super();
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: !!opts.endpoint,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, bytes: Buffer, mime: string): Promise<void> {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: bytes, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }));
  }

  url(key: string): string {
    return `${this.opts.publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async read(): Promise<null> {
    return null;
  }
}
