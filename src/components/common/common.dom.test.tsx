// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { ErrorBoundary } from './ErrorBoundary';
import { DataTable } from './DataTable';
import { RecordLink } from './bits';

afterEach(() => cleanup());

function Boom(): React.ReactNode {
  throw new Error('kaboom in a route');
}

describe('error boundary', () => {
  it('shows a recoverable message instead of blanking the screen', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/could not be displayed/i)).toBeTruthy();
    expect(within(alert).getByText('kaboom in a route')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
    spy.mockRestore();
  });

  it('renders children normally when nothing throws', () => {
    render(<ErrorBoundary><p>All good</p></ErrorBoundary>);
    expect(screen.getByText('All good')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recovers when the reset key changes, so navigating away clears the error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="/broken"><Boom /></ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    rerender(<ErrorBoundary resetKey="/healthy"><p>Recovered</p></ErrorBoundary>);
    expect(screen.getByText('Recovered')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    spy.mockRestore();
  });
});

interface Row { id: string; name: string }
const rows: Row[] = [{ id: 'R-1', name: 'First' }, { id: 'R-2', name: 'Second' }];
const columns: ColumnDef<Row, unknown>[] = [
  { id: 'id', header: 'ID', accessorKey: 'id', cell: ({ row }) => <RecordLink to={`/x/${row.original.id}`}>{row.original.id}</RecordLink> },
  { id: 'name', header: 'Name', accessorKey: 'name' },
];

describe('data table row semantics', () => {
  it('keeps native row semantics rather than turning rows into buttons', () => {
    render(
      <MemoryRouter>
        <DataTable tableId="t1" columns={columns} data={rows} onRowClick={() => {}} />
      </MemoryRouter>,
    );
    const bodyRows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(bodyRows).toHaveLength(2);
    for (const r of bodyRows) {
      expect(r.getAttribute('role')).toBeNull();
      expect(r.getAttribute('tabindex')).toBeNull();
    }
  });

  it('still offers a keyboard-reachable link into each record', () => {
    render(
      <MemoryRouter>
        <DataTable tableId="t2" columns={columns} data={rows} onRowClick={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /R-1/ }).getAttribute('href')).toBe('/x/R-1');
    expect(screen.getByRole('link', { name: /R-2/ }).getAttribute('href')).toBe('/x/R-2');
  });

  it('still opens a record on row click for mouse users', () => {
    const onRowClick = vi.fn();
    render(
      <MemoryRouter>
        <DataTable tableId="t3" columns={columns} data={rows} onRowClick={onRowClick} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByRole('row')[1]);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('marks sortable headers with aria-sort and toggles it', () => {
    render(
      <MemoryRouter>
        <DataTable tableId="t4" columns={columns} data={rows} />
      </MemoryRouter>,
    );
    const header = screen.getByRole('columnheader', { name: /Name/ });
    expect(header.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });
});
