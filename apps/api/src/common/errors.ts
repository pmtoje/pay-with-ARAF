import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERRORS, type ErrorCode } from '@araf/types';
import { InvalidTransitionError } from '@araf/business-rules';
import { IntegrationNotConfiguredError } from '@araf/integrations';
import { Prisma } from '@araf/database';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? ERRORS[code].message);
  }
  get status() {
    return ERRORS[this.code].status;
  }
}

export const fail = (code: ErrorCode, details?: Record<string, unknown>, message?: string): never => {
  throw new AppError(code, details, message);
};

/**
 * Single error envelope:
 *   { "error": { "code", "message", "retryable", "details"?, "correlation_id" } }
 * Never exposes stack traces, SQL errors or internal architecture.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { correlationId?: string }>();
    const correlationId = req.correlationId ?? 'unknown';
    let code: ErrorCode = 'INTERNAL_ERROR';
    let details: Record<string, unknown> | undefined;
    let message: string | undefined;

    if (exception instanceof AppError) {
      code = exception.code;
      details = exception.details;
      message = exception.message;
    } else if (exception instanceof ZodError) {
      code = 'VALIDATION_FAILED';
      details = { fields: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    } else if (exception instanceof InvalidTransitionError) {
      code = 'INVALID_STATE';
    } else if (exception instanceof IntegrationNotConfiguredError) {
      code = 'INTEGRATION_NOT_CONFIGURED';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      code = 'CONFLICT';
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      code = status === 404 ? 'NOT_FOUND' : status === 413 ? 'PDF_TOO_LARGE' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMITED' : status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';
    }
    const def = ERRORS[code];
    if (def.status >= 500) {
      this.logger.error(JSON.stringify({ msg: 'request_failed', code, correlationId, error: (exception as Error)?.message?.slice(0, 300), name: (exception as Error)?.name }));
    }
    res.status(def.status).json({
      error: { code, message: message ?? def.message, retryable: def.retryable, ...(details ? { details } : {}), correlation_id: correlationId },
    });
  }
}
