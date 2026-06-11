/**
 * Email seam. Under Supabase, BRAND auth emails (confirm/reset) are sent by
 * Supabase Auth — NOT this adapter. This covers admin invites/resets (option a)
 * and future non-auth transactional mail (notifications, announcements).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}
