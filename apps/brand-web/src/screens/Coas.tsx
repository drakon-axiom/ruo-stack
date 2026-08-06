import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Check,
  DataTable,
  EmptyState,
  PageHeader,
  buttonClass,
  type Column,
} from '@ruostack/ui';
import { api } from '../lib/api.js';

interface Product {
  id: string;
  name: string;
  dose?: string | null;
  unit?: string | null;
  coaId?: string | null;
}

function CopyLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <Button variant="ghost" size="sm" icon={copied ? Check : undefined} onClick={copy}>
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

// Certificates of Analysis — third-party batch testing, set by the operator per
// product (CatalogProduct.coaId). Brands can view + share these with customers.
export function Coas() {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    api<{ products: Product[] }>('/api/brand/catalog').then((r) => setProducts(r.products));
  }, []);

  const withCoa = (products ?? []).filter((p) => p.coaId);

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      priority: 'primary',
      cell: (p) => `${p.name}${p.dose ? ` · ${p.dose}${p.unit ?? ''}` : ''}`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: () => (
        <Badge tone="success">
          <Check aria-hidden className="h-3 w-3" />
          Third-party verified
        </Badge>
      ),
    },
    {
      key: 'cert',
      header: 'Certificate',
      align: 'right',
      cell: (p) => (
        <div className="flex items-center justify-end gap-2">
          <a
            className={buttonClass('ghost', 'sm')}
            href={p.coaId!}
            target="_blank"
            rel="noreferrer"
          >
            View
          </a>
          <CopyLink value={p.coaId!} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Certificates of Analysis"
        subtitle="Every product is independently third-party verified. Share these COAs with your customers for transparency."
      />

      <DataTable
        caption="Certificates of analysis by product"
        columns={columns}
        rows={withCoa}
        rowKey={(p) => p.id}
        loading={products === null}
        empty={
          <EmptyState
            title="No COAs available yet"
            hint="Certificates appear here as products are batch-tested. Check back soon."
          />
        }
      />
    </>
  );
}
