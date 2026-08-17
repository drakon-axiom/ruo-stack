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

describe('DataTable selection', () => {
  beforeEach(() => setDesktop(true));

  const selectable = (over: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) => (
    <DataTable
      caption="Recent orders"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      selectable
      selectedKeys={new Set<string>()}
      onSelectionChange={() => {}}
      selectionLabel={(r) => `Select ${r.name}`}
      {...over}
    />
  );

  it('adds no selection column unless asked', () => {
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(COLUMNS.length);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders a header checkbox and one per row when selectable', () => {
    render(selectable());
    expect(screen.getAllByRole('columnheader')).toHaveLength(COLUMNS.length + 1);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select M. Reyes' })).toBeInTheDocument();
  });

  it('reports the row key when a row is selected', async () => {
    const onSelectionChange = vi.fn();
    render(selectable({ onSelectionChange }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select M. Reyes' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });

  it('deselects a row that was already selected', async () => {
    const onSelectionChange = vi.fn();
    render(selectable({ selectedKeys: new Set(['1', '2']), onSelectionChange }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select M. Reyes' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['2']));
  });

  // The row is itself clickable (it opens the edit drawer). Selecting must not
  // also navigate, or the checkbox is unusable.
  it('does not fire onRowClick when the checkbox is clicked', async () => {
    const onRowClick = vi.fn();
    render(selectable({ onRowClick, onSelectionChange: () => {} }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select M. Reyes' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('selects every rendered row from the header checkbox', async () => {
    const onSelectionChange = vi.fn();
    render(selectable({ onSelectionChange }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1', '2']));
  });

  it('clears the selection from the header checkbox when all are selected', async () => {
    const onSelectionChange = vi.fn();
    render(selectable({ selectedKeys: new Set(['1', '2']), onSelectionChange }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });

  it('marks the header checkbox mixed on a partial selection', () => {
    render(selectable({ selectedKeys: new Set(['1']) }));
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
  });

  it('offers selection in card mode too', async () => {
    setDesktop(false);
    const onSelectionChange = vi.fn();
    render(selectable({ onSelectionChange }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select M. Reyes' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });
});
