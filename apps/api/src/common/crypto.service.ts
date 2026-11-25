import { Inject, Injectable } from '@nestjs/common';
import { FieldEncryptor, blindIndex, hmacSha256Hex } from '@araf/security';
import { CONFIG, type AppConfig } from '../config';

@Injectable()
export class CryptoService {
  readonly encryptor: FieldEncryptor;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.encryptor = new FieldEncryptor(config.ENCRYPTION_KEYS, config.ENCRYPTION_ACTIVE_KEY);
  }

  encrypt(value: string, context: string): string {
    return this.encryptor.encrypt(value, context);
  }

  decrypt(value: string, context: string): string {
    return this.encryptor.decrypt(value, context);
  }

  encryptJson(value: unknown, context: string): string {
    return this.encrypt(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `__big:${v}` : v)), context);
  }

  decryptJson<T>(value: string, context: string): T {
    return JSON.parse(this.decrypt(value, context), (_k, v) => (typeof v === 'string' && v.startsWith('__big:') ? BigInt(v.slice(6)) : v)) as T;
  }

  bvnIndex(bvn: string): string {
    return blindIndex(this.config.BLIND_INDEX_KEY, `bvn:${bvn}`);
  }

  tokenHash(token: string): string {
    return hmacSha256Hex(this.config.STATE_TOKEN_KEY, `token:${token}`);
  }
}
