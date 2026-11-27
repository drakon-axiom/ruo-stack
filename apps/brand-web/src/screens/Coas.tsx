import { classifyLegacyCoa } from '@ruostack/shared';
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

// Legacy references remain visible without asserting laboratory verification.
export function Coas() {
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    let active = true; setError(false); setProducts(null);
    api<{ products: Product[] }>('/api/brand/catalog').then((r) => { if (active) setProducts(r.products); }).catch(() => { if (active) { setError(true); setProducts([]); } });
    return () => { active = false; };
  }, [attempt]);

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
        <Badge tone="neutral">
          Legacy reference
        </Badge>
      ),
    },
    {
      key: 'cert',
      header: 'Certificate',
      align: 'right',
      cell: (p) => classifyLegacyCoa(p.coaId).kind !== 'url' ? <span>{p.coaId}</span> : (
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
        subtitle="Available certificates and legacy references. A reference alone is not verification."
      />

      <DataTable
        caption="Certificates of analysis by product"
        columns={columns}
        rows={withCoa}
        rowKey={(p) => p.id}
        loading={products === null}
        empty={error ? <EmptyState title="Could not load COAs" action={<Button onClick={() => setAttempt(a => a + 1)}>Retry</Button>} /> :
          <EmptyState
            title="No COAs available yet"
            hint="Documents and references appear here when added to the catalog."
          />
        }
      />
    </>
  );
}
