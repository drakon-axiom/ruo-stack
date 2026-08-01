import type { EmailAdapter, EmailMessage } from '@ruostack/shared';

/**
 * Production EmailAdapter — sends via the Resend HTTP API.
 *
 * Deliberately dependency-free: one `fetch` POST, so the email seam adds no SDK
 * to the tree. Covers admin invites/resets (option a) and non-auth transactional
 * mail (dunning notices). Brand auth emails (confirm/reset) are sent by Supabase
 * Auth, NOT this adapter.
 *
 * Failure policy: `send` THROWS on a non-2xx. Callers decide whether an email is
 * critical (admin invite — surface it) or best-effort (dunning — already wrapped
 * in `.catch()`).
 */
export interface ResendEmailAdapterConfig {
  /** Resend API key (`re_…`). */
  apiKey: string;
  /** RFC-5322 from address, e.g. `RUOStack <no-reply@ruostack.io>`. The domain must be verified in Resend. */
  from: string;
  /** Injection seam for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const ENDPOINT = 'https://api.resend.com/emails';

export class ResendEmailAdapter implements EmailAdapter {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ResendEmailAdapterConfig) {
    this.apiKey = config.apiKey;
    this.from = config.from;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!res.ok) {
      // Resend returns a JSON error body; include it (truncated) so the cause is
      // in the log without dumping an unbounded response.
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed (${res.status} ${res.statusText}): ${body.slice(0, 500)}`);
    }
  }
}
