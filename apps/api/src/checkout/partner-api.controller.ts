import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { IdempotencyService } from '../common/core.services';
import { ApiKey, Ctx, type AuthedRequest } from '../auth/auth.guard';
import { CheckoutService } from './checkout.service';
import { OperationsService } from '../operations/operations.service';
import { WebhooksService } from '../webhooks/webhooks.service';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), status: z.string().max(40).optional(), type: z.string().max(60).optional() });

/**
 * Public partner API (v1). Authenticated with secret keys; every query is scoped to the
 * key's partner AND environment, so identifiers from other tenants resolve to 404.
 */
@Controller('api/v1')
export class PartnerApiController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly ops: OperationsService,
    private readonly idempotency: IdempotencyService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Post('checkout/sessions')
  @ApiKey('checkout:write')
  async createSession(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Ctx() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    if (!key) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'Idempotency-Key', message: 'Idempotency-Key header is required' }] });
    const result = await this.idempotency.run(`checkout:${req.api!.partnerId}`, key, body, () => this.checkout.createSession(req.api!, body, req.actor));
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get('checkout/sessions/:id')
  @ApiKey('checkout:read')
  getSession(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.checkout.getSession(req.api!, id);
  }

  @Get('applications/:reference')
  @ApiKey('applications:read')
  getApplication(@Param('reference') reference: string, @Ctx() req: AuthedRequest) {
    return this.checkout.getApplication(req.api!.partnerId, req.api!.environment, reference);
  }

  @Get('orders/:reference')
  @ApiKey('orders:read')
  getOrder(@Param('reference') reference: string, @Ctx() req: AuthedRequest) {
    return this.checkout.getOrder(req.api!.partnerId, req.api!.environment, reference);
  }

  @Get('releases/:reference')
  @ApiKey('orders:read')
  getRelease(@Param('reference') reference: string, @Ctx() req: AuthedRequest) {
    return this.checkout.getRelease(req.api!.partnerId, req.api!.environment, reference);
  }

  @Post('orders/:reference/equity')
  @HttpCode(200)
  @ApiKey('orders:write')
  confirmEquity(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.confirmEquity(req.api!.partnerId, req.api!.environment, reference, body, req.actor);
  }

  @Post('orders/:reference/fulfil')
  @HttpCode(200)
  @ApiKey('orders:write')
  fulfil(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.fulfil(req.api!.partnerId, req.api!.environment, reference, body, req.actor);
  }

  @Post('orders/:reference/deliver')
  @HttpCode(200)
  @ApiKey('orders:write')
  deliver(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.deliver(req.api!.partnerId, req.api!.environment, reference, body, req.actor);
  }

  @Post('orders/:reference/cancel')
  @HttpCode(200)
  @ApiKey('orders:write')
  cancel(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.cancelOrder(req.api!.partnerId, req.api!.environment, reference, body, req.actor);
  }

  @Post('orders/:reference/return')
  @HttpCode(200)
  @ApiKey('orders:write')
  returnOrder(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.requestReturn(req.api!.partnerId, req.api!.environment, reference, body, req.actor);
  }

  @Get('settlements')
  @ApiKey('settlements:read')
  settlements(@Query() q: unknown, @Ctx() req: AuthedRequest) {
    return this.checkout.listSettlements(req.api!.partnerId, req.api!.environment, listQuery.parse(q));
  }

  @Get('webhook-events')
  @ApiKey('webhooks:read')
  events(@Query() q: unknown, @Ctx() req: AuthedRequest) {
    return this.checkout.listWebhookEvents(req.api!.partnerId, req.api!.environment, listQuery.parse(q));
  }

  @Post('webhook-events/:id/retry')
  @HttpCode(202)
  @ApiKey('webhooks:write')
  async retry(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    const n = await this.webhooks.retryEvent(req.api!.partnerId, req.api!.environment, id);
    if (n < 0) throw new AppError('NOT_FOUND');
    return { queued_deliveries: n };
  }
}
