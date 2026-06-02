import Link from 'next/link';

const FEATURES = [
  'Full supplement catalog access',
  'Wholesale pricing on every product',
  'White-label & custom branding',
  'Lot-tracked, US-based fulfillment',
  'Direct-to-customer shipping',
  'Real-time analytics dashboard',
  'COA catalog access',
  'Auto-sync with WooCommerce / Shopify / Wix',
  'Branded packaging & fulfillment',
  'Priority US-based support',
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="text-3xl font-bold">Simple, month-to-month pricing</h1>
      <div className="mx-auto mt-10 max-w-md rounded-2xl border p-8 text-left shadow-sm">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold">$97</span>
          <span className="text-gray-500">/mo</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">Cancel anytime. No contract.</p>
        <ul className="mt-6 space-y-2 text-sm">
          {FEATURES.map((f) => (
            <li key={f} className="flex gap-2">
              <span className="text-brand">✓</span>
              {f}
            </li>
          ))}
        </ul>
        <Link
          href="/login?next=/onboarding"
          className="mt-8 block rounded bg-brand py-3 text-center font-medium text-white"
        >
          Get started
        </Link>
      </div>
    </main>
  );
}
