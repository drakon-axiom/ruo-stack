import { describe, expect, it } from 'vitest';
import {
  AnnouncementCreateSchema,
  announcementDisplayState,
  isAnnouncementVisible,
  type AnnouncementVisibility,
} from '@ruostack/shared';

const NOW = new Date('2026-07-31T12:00:00Z');
const BRAND = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const base: AnnouncementVisibility = {
  audience: 'all_brands',
  brandId: null,
  status: 'published',
  publishAt: null,
  expiresAt: null,
};
const withA = (over: Partial<AnnouncementVisibility>): AnnouncementVisibility => ({ ...base, ...over });

describe('isAnnouncementVisible', () => {
  it('shows a published all-brands announcement with no dates', () => {
    expect(isAnnouncementVisible(base, BRAND, NOW)).toBe(true);
  });

  it('hides drafts and archived announcements', () => {
    expect(isAnnouncementVisible(withA({ status: 'draft' }), BRAND, NOW)).toBe(false);
    expect(isAnnouncementVisible(withA({ status: 'archived' }), BRAND, NOW)).toBe(false);
  });

  it('hides one scheduled for the future, shows it once publishAt has passed', () => {
    const future = withA({ publishAt: '2026-08-01T00:00:00Z' });
    expect(isAnnouncementVisible(future, BRAND, NOW)).toBe(false);
    expect(isAnnouncementVisible(future, BRAND, new Date('2026-08-01T00:00:01Z'))).toBe(true);
  });

  it('hides an expired one, and treats expiry as exclusive at the boundary', () => {
    expect(isAnnouncementVisible(withA({ expiresAt: '2026-07-30T00:00:00Z' }), BRAND, NOW)).toBe(false);
    // expiresAt == now → already expired (the SQL policy uses expires_at > now).
    expect(isAnnouncementVisible(withA({ expiresAt: NOW.toISOString() }), BRAND, NOW)).toBe(false);
    expect(isAnnouncementVisible(withA({ expiresAt: '2026-08-30T00:00:00Z' }), BRAND, NOW)).toBe(true);
  });

  it('scopes a single_brand announcement to its own brand', () => {
    const targeted = withA({ audience: 'single_brand', brandId: BRAND });
    expect(isAnnouncementVisible(targeted, BRAND, NOW)).toBe(true);
    expect(isAnnouncementVisible(targeted, OTHER, NOW)).toBe(false);
  });

  it('fails CLOSED for the reserved `segment` audience', () => {
    // Until segment targeting is defined, a segment row must reach nobody —
    // never everybody.
    expect(isAnnouncementVisible(withA({ audience: 'segment' }), BRAND, NOW)).toBe(false);
  });

  it('accepts Date objects as well as ISO strings', () => {
    expect(isAnnouncementVisible(withA({ publishAt: new Date('2026-07-01T00:00:00Z') }), BRAND, NOW)).toBe(true);
    expect(isAnnouncementVisible(withA({ publishAt: new Date('2026-12-01T00:00:00Z') }), BRAND, NOW)).toBe(false);
  });
});

describe('announcementDisplayState', () => {
  it('derives the states the admin tabs filter on', () => {
    expect(announcementDisplayState({ status: 'draft', publishAt: null, expiresAt: null }, NOW)).toBe('draft');
    expect(announcementDisplayState({ status: 'archived', publishAt: null, expiresAt: null }, NOW)).toBe('archived');
    expect(announcementDisplayState({ status: 'published', publishAt: '2026-08-05T00:00:00Z', expiresAt: null }, NOW)).toBe('scheduled');
    expect(announcementDisplayState({ status: 'published', publishAt: null, expiresAt: '2026-07-01T00:00:00Z' }, NOW)).toBe('expired');
    expect(announcementDisplayState({ status: 'published', publishAt: null, expiresAt: null }, NOW)).toBe('live');
  });
});

describe('AnnouncementCreateSchema', () => {
  it('requires brand_id for a single_brand announcement', () => {
    const r = AnnouncementCreateSchema.safeParse({ audience: 'single_brand', title: 't', body: 'b' });
    expect(r.success).toBe(false);
  });

  it('rejects a brand_id on an all_brands announcement', () => {
    const r = AnnouncementCreateSchema.safeParse({ audience: 'all_brands', brand_id: BRAND, title: 't', body: 'b' });
    expect(r.success).toBe(false);
  });

  it('rejects the reserved segment audience', () => {
    const r = AnnouncementCreateSchema.safeParse({ audience: 'segment', title: 't', body: 'b' });
    expect(r.success).toBe(false);
  });

  it('accepts a well-formed all-brands announcement and defaults the type', () => {
    const r = AnnouncementCreateSchema.safeParse({ title: 'Restock', body: 'BPC-157 is back' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.audience).toBe('all_brands');
      expect(r.data.type).toBe('announcement');
    }
  });
});
