import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card.js';
import { KpiTile } from './KpiTile.js';
import { StatusPill } from './StatusPill.js';
import { EmptyState } from './EmptyState.js';
import { SkeletonRows } from './Skeleton.js';

describe('surface primitives', () => {
  it('Card carries elevation 1 and the raised gradient', () => {
    // These two classes are what stop cards reading flat against the canvas.
    render(<Card data-testid="c">body</Card>);
    const el = screen.getByTestId('c');
    expect(el).toHaveClass('shadow-e1');
    expect(el).toHaveClass('bg-surface-raised');
  });

  it('KpiTile renders value and label', () => {
    render(<KpiTile label="Orders today" value={18} />);
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Orders today')).toBeInTheDocument();
  });

  it('KpiTile applies the warning tone to its figure', () => {
    render(<KpiTile label="Action required" value={2} tone="warning" />);
    expect(screen.getByText('2')).toHaveClass('text-warning');
  });

  it('KpiTile uses tabular numerals so columns of figures align', () => {
    render(<KpiTile label="Wallet" value="$4,120" />);
    expect(screen.getByText('$4,120')).toHaveClass('tabular-nums');
  });

  it('StatusPill humanises snake_case and picks a tone', () => {
    render(<StatusPill value="out_of_stock" />);
    expect(screen.getByText('out of stock')).toHaveClass('text-danger');
  });

  it('StatusPill falls back to a neutral tone for unknown values', () => {
    render(<StatusPill value="some_new_state" />);
    expect(screen.getByText('some new state')).toHaveClass('text-content-muted');
  });

  it('EmptyState renders title, hint and action', () => {
    render(
      <EmptyState title="No orders yet" hint="Create your first order." action={<button>New</button>} />,
    );
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first order.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('SkeletonRows exposes a loading status to assistive tech', () => {
    render(<SkeletonRows count={3} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
