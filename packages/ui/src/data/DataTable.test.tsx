import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './DataTable.js';

interface Row {
  id: string;
  name: string;
  city: string;
  charge: string;
}

const ROWS: Row[] = [
  { id: '1', name: 'M. Reyes', city: 'Austin, TX', charge: '$128.00' },
  { id: '2', name: 'J. Chen', city: 'Portland, OR', charge: '$96.00' },
];

const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Recipient', cell: (r) => r.name, priority: 'primary' },
  { key: 'city', header: 'Destination', cell: (r) => r.city, priority: 'meta' },
  { key: 'charge', header: 'Charge', cell: (r) => r.charge, align: 'right', mono: true },
];

/** Drives the md breakpoint DataTable reads through useMediaQuery. */
function setDesktop(isDesktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('DataTable', () => {
  beforeEach(() => setDesktop(true));

  it('renders a real table with a caption and column scopes on desktop', () => {
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByRole('table', { name: 'Recent orders' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Recipient' })).toHaveAttribute('scope', 'col');
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 body rows
  });

  it('renders cards instead of a table below md', () => {
    setDesktop(false);
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('M. Reyes')).toBeInTheDocument();
    // Non-primary, non-meta columns become label/value pairs per card.
    expect(screen.getAllByText('Charge')).toHaveLength(2);
  });

  it('keeps the table on mobile when mode is scroll', () => {
    setDesktop(false);
    render(
      <DataTable caption="Ledger" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} mode="scroll" />,
    );
    expect(screen.getByRole('table', { name: 'Ledger' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', () => {
    render(
      <DataTable
        caption="Recent orders"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<div>No orders yet</div>}
      />,
    );
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a loading status instead of rows while loading', () => {
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('fires onRowClick on click', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="Recent orders"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    await userEvent.click(screen.getByText('M. Reyes'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('makes clickable rows keyboard reachable', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="Recent orders"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });
});
