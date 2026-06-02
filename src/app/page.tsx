import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <nav className="flex items-center justify-between pb-12">
        <span className="text-xl font-bold text-brand">ruo-stack</span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/catalog" className="hover:underline">Catalog</Link>
          <Link href="/pricing" className="hover:underline">Pricing</Link>
          <Link href="/login" className="rounded bg-brand px-3 py-1.5 text-white">Sign in</Link>
          <ThemeToggle />
        </div>
      </nav>

      <section className="py-12">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Sell supplements under your own brand.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          ruo-stack is a white-label fulfillment platform. You run your storefront;
          we handle inventory, lot-tracked labeling, packaging, and shipping direct
          to your customers. You never touch product.
        </p>
        <div className="mt-8 flex gap-4">
          <Link href="/pricing" className="rounded bg-brand px-5 py-3 font-medium text-white">
            Start selling
          </Link>
          <Link href="/catalog" className="rounded border px-5 py-3 font-medium">
            Browse catalog
          </Link>
        </div>
      </section>

      <section className="grid gap-6 py-12 sm:grid-cols-3">
        {[
          ['Prepaid wallet', 'Fund a USD wallet. Each fulfilled order debits wholesale cost + shipping — no surprises.'],
          ['Lot-tracked fulfillment', 'Every order is traced to a specific lot with COA and expiry for full chain-of-custody.'],
          ['Store sync', 'Connect WooCommerce, Shopify, or Wix — orders sync automatically and tracking pushes back.'],
        ].map(([title, body]) => (
          <div key={title} className="rounded-lg border p-5">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t pt-8 text-xs text-muted-foreground">
        These statements have not been evaluated by the FDA. Products are not intended to
        diagnose, treat, cure, or prevent any disease.
      </footer>
    </main>
  );
}
