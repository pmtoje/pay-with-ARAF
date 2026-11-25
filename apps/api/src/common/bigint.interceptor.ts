import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';

/**
 * Converts bigint monetary values (integer kobo) in HTTP responses to JSON numbers, refusing
 * any value outside the exactly-representable range. Internal serialisation (encryption,
 * outbox, simulators) keeps exact bigints via explicit replacers.
 */
export function toWire(value: unknown, depth = 0): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Unsafe monetary value');
    return Number(value);
  }
  if (depth > 20 || value === null || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((v) => toWire(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toWire(v, depth + 1);
  return out;
}

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((data) => toWire(data)));
  }
}
