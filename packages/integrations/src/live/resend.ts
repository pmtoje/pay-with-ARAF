import { ProviderError, type CallContext, type NotificationProvider } from '../interfaces';

export interface ResendEmailProviderOptions {
  apiKey: string;
  /** A verified Resend sender, e.g. `no-reply@araf.ng` or `Pay with ARAF <no-reply@araf.ng>`. */
  from: string;
}

/**
 * Real email delivery through Resend. SMS is deliberately unsupported: the notification
 * router sends EMAIL here and keeps SMS on the configured fallback provider.
 */
export class ResendEmailProvider implements NotificationProvider {
  readonly name = 'Resend (email)';

  constructor(private readonly options: ResendEmailProviderOptions) {}

  async send(
    input: { channel: 'EMAIL' | 'SMS'; destination: string; subject: string; body: string; applicationReference?: string },
    _ctx: CallContext,
  ): Promise<{ providerRef: string }> {
    if (input.channel !== 'EMAIL') throw new ProviderError('Resend', 'REJECTED', 'Resend delivers email only');

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.options.from,
          to: [input.destination],
          subject: input.subject,
          text: input.body,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ProviderError('Resend', 'UNAVAILABLE', `network error: ${(e as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const code = res.status === 401 || res.status === 403 ? 'AUTHENTICATION_FAILED' : res.status === 429 ? 'UNAVAILABLE' : 'REJECTED';
      throw new ProviderError('Resend', code, `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerRef: data.id ?? `resend-${Date.now()}` };
  }
}

/** Route EMAIL to Resend, everything else (SMS) to the deployment's fallback provider. */
export class EmailRoutingNotificationProvider implements NotificationProvider {
  readonly name: string;

  constructor(
    private readonly email: NotificationProvider,
    private readonly fallback: NotificationProvider,
  ) {
    this.name = `Email: ${email.name}; other: ${fallback.name}`;
  }

  send(
    input: { channel: 'EMAIL' | 'SMS'; destination: string; subject: string; body: string; applicationReference?: string },
    ctx: CallContext,
  ): Promise<{ providerRef: string }> {
    return input.channel === 'EMAIL' ? this.email.send(input, ctx) : this.fallback.send(input, ctx);
  }
}
