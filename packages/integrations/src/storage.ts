import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { FieldEncryptor } from '@araf/security';
import type { DocumentStorageProvider } from './interfaces';

/**
 * Encrypted local document storage (development / sandbox).
 * Production must use the Bank's approved S3-compatible encrypted object storage.
 * Keys are generated server-side (never user-controlled) and path traversal is rejected.
 */
export class EncryptedFileStorage implements DocumentStorageProvider {
  readonly name = 'Encrypted local file storage';
  private readonly root: string;

  constructor(root: string, private readonly encryptor: FieldEncryptor) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!/^[A-Za-z0-9/_-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, this.encryptor.encryptBuffer(data), { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return this.encryptor.decryptBuffer(await readFile(this.pathFor(key)));
  }
}
