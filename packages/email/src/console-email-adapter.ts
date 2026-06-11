import type { EmailAdapter, EmailMessage } from '@ruostack/shared';

/**
 * Dev EmailAdapter — prints the message instead of sending. Covers admin
 * invites/resets (option a) and future non-auth transactional mail. Brand auth
 * emails (confirm/reset) are sent by Supabase Auth, NOT this adapter.
 *
 * Phase 1+: swap for an SES/Resend/Postmark adapter behind the same interface.
 */
export class ConsoleEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      [
        '──────────── EMAIL (console adapter) ────────────',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '─────────────────────────────────────────────────',
      ].join('\n'),
    );
  }
}
