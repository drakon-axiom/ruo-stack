// Option lists shared by onboarding + branding. Values must match the
// sales_channel enum in 0001_schema.sql.

export const SALES_CHANNELS = [
  { value: 'woocommerce', label: 'WooCommerce' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'wix', label: 'Wix' },
  { value: 'social', label: 'Social media' },
  { value: 'manual', label: 'Manual / phone orders' },
  { value: 'custom', label: 'Custom / other' },
] as const;

export const EXPERIENCE_LEVELS = [
  { value: 'new', label: 'New to selling supplements' },
  { value: 'some', label: 'Some experience' },
  { value: 'experienced', label: 'Experienced — already have customers' },
] as const;

export const BRAND_ASSETS_BUCKET = 'brand-assets';
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
