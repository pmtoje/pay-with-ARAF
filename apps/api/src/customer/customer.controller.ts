import { Body, Controller, Get, HttpCode, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { Ctx, Customer, Public, type AuthedRequest } from '../auth/auth.guard';
import { JourneyService } from './journey.service';
import { StatementsService } from './statements.service';
import { EligibilityService } from '../credit/eligibility.service';
import { OperationsService } from '../operations/operations.service';
import { ArafService } from '../araf/araf.service';

/** Hosted customer checkout API. The checkout session id in the path must match the browser session. */
@Controller('api/checkout/sessions/:sessionId')
export class CustomerController {
  constructor(
    private readonly journey: JourneyService,
    private readonly statements: StatementsService,
    private readonly eligibility: EligibilityService,
    private readonly ops: OperationsService,
    private readonly araf: ArafService,
  ) {}

  private appId(req: AuthedRequest) {
    return req.customer!.applicationId;
  }

  @Get()
  @Public()
  summary(@Param('sessionId') sessionId: string) {
    return this.journey.summary(sessionId);
  }

  @Post('open')
  @HttpCode(200)
  @Public()
  open(@Param('sessionId') sessionId: string, @Ctx() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    return this.journey.open(sessionId, req, res);
  }

  @Get('consents')
  @Public()
  consents() {
    return { consents: this.journey.consentCatalogue() };
  }

  @Get('state')
  @Customer(false)
  async state(@Ctx() req: AuthedRequest) {
    // Opportunistically advance asynchronous steps the customer is waiting on.
    if (req.customer!.authenticated) {
      await this.statements.pollApplicationAnalysis(this.appId(req), req.correlationId).catch((e) => console.error('[state] analysis poll failed', (e as Error).message, (e as Error).stack?.split('\n').slice(0, 4).join(' | ')));
      await this.ops.verifyMandate(this.appId(req), req.actor, req.correlationId).catch(() => undefined);
    }
    return this.journey.view(this.appId(req), req);
  }

  @Post('consents')
  @HttpCode(200)
  @Customer(false)
  submitConsents(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.submitConsents(this.appId(req), body, req);
  }

  @Post('identity')
  @HttpCode(200)
  @Customer(false)
  identity(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.submitIdentity(this.appId(req), body, req);
  }

  @Post('identity/otp')
  @HttpCode(200)
  @Customer(false)
  identityOtp(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.verifyIdentityOtp(this.appId(req), body, req);
  }

  @Post('resume')
  @HttpCode(200)
  @Customer(false)
  resume(@Ctx() req: AuthedRequest) {
    return this.journey.requestResumeOtp(this.appId(req), req);
  }

  @Post('resume/verify')
  @HttpCode(200)
  @Customer(false)
  resumeVerify(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.verifyResumeOtp(this.appId(req), body, req);
  }

  @Post('credit-check')
  @HttpCode(200)
  @Customer()
  async credit(@Ctx() req: AuthedRequest) {
    await this.journey.runCreditCheck(this.appId(req), req);
    return this.journey.view(this.appId(req), req);
  }

  @Post('enhanced-info')
  @HttpCode(200)
  @Customer()
  enhanced(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.submitEnhancedInfo(this.appId(req), body, req);
  }

  @Get('accounts')
  @Customer()
  accounts(@Ctx() req: AuthedRequest) {
    return this.journey.listAccounts(this.appId(req), req);
  }

  @Post('accounts/select')
  @HttpCode(200)
  @Customer()
  selectAccount(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.selectAccount(this.appId(req), body, req);
  }

  @Post('account-opening/start')
  @HttpCode(200)
  @Customer()
  startAccountOpening(@Ctx() req: AuthedRequest) {
    return this.journey.startAccountOpening(this.appId(req), req);
  }

  @Post('account-opening/complete')
  @HttpCode(200)
  @Customer()
  completeAccountOpening(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.completeAccountOpening(this.appId(req), body, req);
  }

  @Post('income-profile')
  @HttpCode(200)
  @Customer()
  incomeProfile(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.journey.setIncomeProfile(this.appId(req), body, req);
  }

  @Post('statements/altbank')
  @HttpCode(200)
  @Customer()
  altbank(@Ctx() req: AuthedRequest) {
    return this.statements.fromAltBank(this.appId(req), req);
  }

  @Post('statements/mono/session')
  @HttpCode(200)
  @Customer()
  monoSession(@Ctx() req: AuthedRequest) {
    return this.statements.createMonoSession(this.appId(req), req);
  }

  @Post('statements/mono/exchange')
  @HttpCode(200)
  @Customer()
  monoExchange(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.statements.exchangeMono(this.appId(req), body, req);
  }

  @Post('statements/pdf')
  @HttpCode(200)
  @Customer()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } }))
  pdf(@UploadedFile() file: Express.Multer.File | undefined, @Ctx() req: AuthedRequest) {
    return this.statements.uploadPdf(this.appId(req), file, req);
  }

  @Get('offers')
  @Customer()
  offers(@Ctx() req: AuthedRequest) {
    return this.eligibility.offerOptions(this.appId(req));
  }

  @Post('equity')
  @HttpCode(200)
  @Customer()
  setEquity(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.eligibility.setEquity(this.appId(req), body, req);
  }

  @Post('offers/select')
  @HttpCode(200)
  @Customer()
  selectOffer(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.eligibility.selectTenor(this.appId(req), body, req);
  }

  @Post('offers/accept')
  @HttpCode(200)
  @Customer()
  accept(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.eligibility.acceptOffer(this.appId(req), body, req);
  }

  @Get('offers/:offerId/summary.pdf')
  @Customer()
  async offerPdf(@Param('offerId') offerId: string, @Ctx() req: AuthedRequest, @Res() res: Response) {
    const pdf = await this.eligibility.offerSummaryPdf(this.appId(req), offerId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="araf-offer-summary.pdf"`);
    res.send(pdf);
  }

  @Post('information')
  @HttpCode(200)
  @Customer()
  async information(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    const { note } = z.object({ note: z.string().min(3).max(1000) }).strict().parse(body);
    await this.araf.customerProvidesInfo(this.appId(req), note, req.actor);
    return this.journey.view(this.appId(req), req);
  }

  @Get('documents/:documentId.pdf')
  @Customer()
  async document(@Param('documentId') documentId: string, @Ctx() req: AuthedRequest, @Res() res: Response) {
    const pdf = await this.ops.documentPdf(this.appId(req), documentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="araf-document.pdf"`);
    res.send(pdf);
  }

  @Post('documents/otp')
  @HttpCode(200)
  @Customer()
  documentsOtp(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    const { purpose } = z.object({ purpose: z.enum(['DOCUMENT_SIGNING', 'SALE_CONTRACT']) }).strict().parse(body);
    return this.ops.requestSigningOtp(this.appId(req), purpose, req);
  }

  @Post('documents/sign')
  @HttpCode(200)
  @Customer()
  sign(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.signDocuments(this.appId(req), body, req);
  }

  @Post('mandate/start')
  @HttpCode(200)
  @Customer()
  mandate(@Ctx() req: AuthedRequest) {
    return this.ops.startMandate(this.appId(req), req);
  }

  @Post('mandate/verify')
  @HttpCode(200)
  @Customer()
  async mandateVerify(@Ctx() req: AuthedRequest) {
    await this.ops.verifyMandate(this.appId(req), req.actor, req.correlationId);
    return this.journey.view(this.appId(req), req);
  }

  @Post('sale-contract/sign')
  @HttpCode(200)
  @Customer()
  saleContract(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.signSaleContract(this.appId(req), body, req);
  }

  @Post('delivery/confirm')
  @HttpCode(200)
  @Customer()
  confirmDelivery(@Ctx() req: AuthedRequest) {
    return this.ops.customerConfirmDelivery(this.appId(req), req);
  }

  @Post('cancel')
  @HttpCode(200)
  @Customer()
  cancel(@Ctx() req: AuthedRequest) {
    if (!req.customer?.authenticated) throw new AppError('SESSION_EXPIRED');
    return this.journey.cancelByCustomer(this.appId(req), req);
  }
}
