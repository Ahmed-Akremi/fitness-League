import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertKey, StorageService } from './storage.service';

const MIME_BY_EXT: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

/** Development driver: files under `rootDir`, served by MediaController. */
export class LocalStorage extends StorageService {
  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string,
  ) {
    super();
  }

  async put(key: string, bytes: Buffer, _mime?: string): Promise<void> {
    assertKey(key);
    const path = join(this.rootDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  url(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await rm(join(this.rootDir, key), { force: true });
  }

  async read(key: string): Promise<{ bytes: Buffer; mime: string } | null> {
    try {
      assertKey(key);
      const bytes = await readFile(join(this.rootDir, key));
      return { bytes, mime: MIME_BY_EXT[key.split('.').pop() ?? ''] ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }
}
