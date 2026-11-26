import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { sha256Hex } from '@araf/security';
import { AppError } from '../common/errors';
import { RateLimitService } from '../common/core.services';
import { toWire } from '../common/bigint.interceptor';
import type { AuthedRequest } from '../auth/auth.guard';

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DONE_TTL = 24 * 3600;
const PENDING_TTL = 120;

/**
 * Safe retries for the hosted checkout on slow or dropped connections.
 *
 * The browser sends an `Idempotency-Key` with every state-changing request and re-sends the SAME
 * key when it retries after a timeout or network error. If the first attempt already succeeded,
 * the stored response is replayed (`Idempotent-Replayed: true`) instead of running the action
 * twice; if it is still running, the retry gets 409 IDEMPOTENCY_IN_PROGRESS and tries again.
 * Keys are scoped to the browser session; reusing a key for a different request is refused.
 * If Redis is unavailable the action runs normally — the application state machine still
 * rejects duplicate transitions, so idempotency here is an improvement, never the only guard.
 */
@Injectable()
export class CustomerIdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: RateLimitService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = req.headers['idempotency-key'];
    const key = typeof header === 'string' ? header : null;
    if (req.method !== 'POST' || !req.customer || !key || !KEY_RE.test(key)) return next.handle();
    const file = (req as unknown as { file?: { originalname?: string; size?: number } }).file;
    const fingerprint = sha256Hex(`${req.method} ${req.originalUrl.split('?')[0]} ${JSON.stringify(req.body ?? {})} ${file ? `${file.originalname}:${file.size}` : ''}`);
    const redisKey = `idem:cx:${req.customer.sessionId}:${key}`;
    return from(this.store.kvGet(redisKey)).pipe(
      mergeMap((raw) => {
        if (raw) {
          const rec = JSON.parse(raw) as { state: 'pending' | 'done'; fp: string; status?: number; body?: unknown };
          if (rec.fp !== fingerprint) return throwError(() => new AppError('IDEMPOTENCY_KEY_REUSED'));
          if (rec.state === 'pending') return throwError(() => new AppError('IDEMPOTENCY_IN_PROGRESS'));
          res.status(rec.status ?? 200);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(rec.body);
        }
        return from(this.store.kvSetNx(redisKey, JSON.stringify({ state: 'pending', fp: fingerprint }), PENDING_TTL)).pipe(
          mergeMap((claimed) => {
            if (claimed === false) return throwError(() => new AppError('IDEMPOTENCY_IN_PROGRESS'));
            return next.handle().pipe(
              mergeMap((body) => from(this.store.kvSet(redisKey, JSON.stringify({ state: 'done', fp: fingerprint, status: res.statusCode, body: toWire(body) }), DONE_TTL)).pipe(mergeMap(() => of(body)))),
              // A failed attempt is not remembered: the customer can retry with the same key.
              catchError((e) => from(this.store.kvDel(redisKey)).pipe(mergeMap(() => throwError(() => e)))),
            );
          }),
        );
      }),
    );
  }
}
