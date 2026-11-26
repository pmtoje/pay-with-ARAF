import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { SANDBOX_IDENTITIES } from '@araf/integrations';
import { hmacSha256Hex } from '@araf/security';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ProvidersService } from '../common/providers.service';
import { Ctx, Customer, Public, Staff, type AuthedRequest } from '../auth/auth.guard';
import { JourneyService } from '../customer/journey.service';

/**
 * SANDBOX-ONLY endpoints that stand in for external systems' hosted pages (account opening,
 * Mono Connect, Remita authorisation) and expose the sandbox message inbox. Every handler
 * returns 404 unless sandbox tools are enabled (never in production).
 */
@Controller('api/sandbox')
export class SandboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly journey: JourneyService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private guard() {
    if (!this.config.sandboxToolsEnabled) throw new AppError('NOT_FOUND');
  }

  @Get('scenarios')
  @Public()
  scenarios() {
    this.guard();
    return SANDBOX_IDENTITIES.map((i) => ({ scenario: i.scenario, title: i.title, description: i.description, bvn: i.bvn, date_of_birth: i.dateOfBirth, suggested_path: i.suggestedPath }));
  }

  /** Sandbox SMS inbox for the customer's own application (requires the checkout browser session). */
  @Get('checkout/:sessionId/inbox')
  @Customer(false)
  async inbox(@Ctx() req: AuthedRequest) {
    this.guard();
    const rows = await this.prisma.sandboxMessage.findMany({ where: { applicationId: req.customer!.applicationId }, orderBy: { createdAt: 'desc' }, take: 10 });
    return rows.map((r) => ({ channel: r.channel, destination: r.destination.replace(/\d(?=\d{3})/g, '•'), body: r.body, at: r.createdAt }));
  }

  @Get('inbox')
  @Staff()
  async staffInbox(@Query('destination') destination?: string) {
    this.guard();
    const rows = await this.prisma.sandboxMessage.findMany({ where: { destination: destination || undefined }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ id: r.id, channel: r.channel, destination: r.destination, body: r.body, at: r.createdAt }));
  }

  // ---- Simulated account opening platform -----------------------------------------

  @Get('account-opening/:ref')
  @Public()
  async aoInfo(@Param('ref') ref: string) {
    this.guard();
    const rec = await this.providers.simStore.get<{ status: string; name: string; prefill?: { email?: string; phone?: string; address?: { line1: string; city: string; state: string } } }>('ACCOUNT_OPENING', ref);
    if (!rec) throw new AppError('NOT_FOUND');
    // Sandbox stand-in only: shows which fields arrived pre-filled from the merchant.
    return { status: rec.status, name: rec.name, prefilled: rec.prefill ?? {} };
  }

  @Post('account-opening/:ref/complete')
  @HttpCode(200)
  @Public()
  async aoComplete(@Param('ref') ref: string, @Ctx() req: AuthedRequest) {
    this.guard();
    const done = await this.providers.sandbox.accountOpening.completeSimulated(ref);
    if (!done) throw new AppError('NOT_FOUND');
    // Simulate the platform's signed server-to-server callback, exercising the real verification path.
    const body = Buffer.from(JSON.stringify({ correlation_ref: ref, status: 'COMPLETED' }));
    await this.journey.accountOpeningCallback(body, hmacSha256Hex(this.config.INTERNAL_CALLBACK_SECRET, body), { type: 'PROVIDER', id: 'account-opening-sim', label: 'Account opening (sandbox)', correlationId: req.correlationId });
    return { return_url: done.returnUrl };
  }

  @Post('account-opening/:ref/abandon')
  @HttpCode(200)
  @Public()
  async aoAbandon(@Param('ref') ref: string) {
    this.guard();
    const rec = await this.providers.sandbox.accountOpening.abandonSimulated(ref);
    if (!rec) throw new AppError('NOT_FOUND');
    return { return_url: rec.returnUrl };
  }

  // ---- Simulated Mono Connect -----------------------------------------------------------

  @Get('mono/:sessionRef')
  @Public()
  async monoInfo(@Param('sessionRef') sessionRef: string) {
    this.guard();
    const rec = await this.providers.simStore.get<{ status: string }>('MONO_SESSION', sessionRef);
    if (!rec) throw new AppError('NOT_FOUND');
    return { status: rec.status, institutions: ['Lagoon Bank (sandbox)', 'Harmattan Bank (sandbox)', 'Savannah MFB (sandbox)'] };
  }

  @Post('mono/:sessionRef/authorize')
  @HttpCode(200)
  @Public()
  async monoAuthorize(@Param('sessionRef') sessionRef: string, @Body() body: unknown) {
    this.guard();
    const input = z.object({ institution: z.string().min(2).max(80), outcome: z.enum(['SUCCESS', 'FAILURE']) }).strict().parse(body);
    const res = await this.providers.sandbox.mono.authorizeSimulated(sessionRef, input.institution, input.outcome);
    if (!res) throw new AppError('NOT_FOUND');
    return { redirect_url: res.redirectUrl, code: res.code };
  }

  // ---- Simulated Remita mandate authorisation ------------------------------------------

  @Get('remita/:ref')
  @Public()
  async remitaInfo(@Param('ref') ref: string) {
    this.guard();
    const rec = await this.providers.simStore.get<{ status: string }>('REMITA_MANDATE', ref);
    if (!rec) throw new AppError('NOT_FOUND');
    return { status: rec.status };
  }

  @Post('remita/:ref/authorize')
  @HttpCode(200)
  @Public()
  async remitaAuthorize(@Param('ref') ref: string, @Body() body: unknown) {
    this.guard();
    const { approve } = z.object({ approve: z.boolean() }).strict().parse(body);
    const res = await this.providers.sandbox.remita.authorizeSimulated(ref, approve);
    if (!res) throw new AppError('NOT_FOUND');
    return { return_url: res.returnUrl };
  }
}

@Controller('api/callbacks')
export class CallbacksController {
  constructor(
    private readonly journey: JourneyService,
    @Inject('ARAF_SERVICE') private readonly araf: { callback(raw: Buffer | undefined, sig: string | undefined, timestamp?: string): Promise<unknown> },
  ) {}

  /** Authenticated (HMAC-SHA256 over the raw body) status events from the ARAF workflow. */
  @Post('araf')
  @HttpCode(200)
  @Public()
  arafEvent(@Req() req: AuthedRequest) {
    return this.araf.callback(req.rawBody, req.headers['x-araf-signature'] as string | undefined, req.headers['x-araf-timestamp'] as string | undefined);
  }

  /** Authenticated callback from the Bank's account opening platform. */
  @Post('account-opening')
  @HttpCode(200)
  @Public()
  accountOpening(@Req() req: AuthedRequest) {
    return this.journey.accountOpeningCallback(req.rawBody, req.headers['x-araf-signature'] as string | undefined, { type: 'PROVIDER', id: 'account-opening', label: 'Account opening platform', correlationId: req.correlationId });
  }
}
