import * as React from 'react';
import {
  type ColumnDef, type SortingState, type VisibilityState,
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { cn } from '@/lib/cn';

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Free-text search string; matching is done by each column's accessor. */
  globalFilter?: string;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onRowClick?: (row: TData) => void;
  /** Stable key used to persist column visibility for this table. */
  tableId: string;
  initialSorting?: SortingState;
  initialHidden?: string[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  pageSize?: number;
  /** Extra controls rendered on the toolbar row, right-aligned. */
  toolbar?: React.ReactNode;
  /** Controls beside the record count, left-aligned — e.g. an Active / Archived switch. */
  leading?: React.ReactNode;
  getRowId?: (row: TData) => string;
  rowClassName?: (row: TData) => string | undefined;
}

const VIS_KEY = (id: string) => `mrcrm.columns.${id}`;

export function DataTable<TData>({
  columns, data, globalFilter = '', isLoading, error, onRetry, onRowClick, tableId,
  initialSorting = [], initialHidden = [], emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your filters or search terms.', emptyAction,
  pageSize = 25, toolbar, leading, getRowId, rowClassName,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    try {
      const stored = localStorage.getItem(VIS_KEY(tableId));
      if (stored) return JSON.parse(stored) as VisibilityState;
    } catch { /* ignore */ }
    return Object.fromEntries(initialHidden.map((c) => [c, false]));
  });
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize });

  React.useEffect(() => {
    try {
      localStorage.setItem(VIS_KEY(tableId), JSON.stringify(columnVisibility));
    } catch { /* ignore */ }
  }, [columnVisibility, tableId]);

  // Reset to the first page whenever the result set changes underneath us.
  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [globalFilter, data.length]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, globalFilter, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId,
    globalFilterFn: 'includesString',
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: size } = table.getState().pagination;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-muted-foreground tabular" aria-live="polite">
            {isLoading ? 'Loading records…' : `${total.toLocaleString()} record${total === 1 ? '' : 's'}`}
          </p>
          {leading}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(v) => column.toggleVisibility(Boolean(v))}
                  onSelect={(e) => e.preventDefault()}
                >
                  {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead className="bg-surface-2">
            <tr>
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : sortable ? 'none' : undefined}
                    className="border-b border-border px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === 'asc' ? <ArrowUp className="h-3 w-3" />
                          : dir === 'desc' ? <ArrowDown className="h-3 w-3" />
                          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                  {table.getVisibleLeafColumns().map((c) => (
                    <td key={c.id} className="px-3 py-3">
                      <Skeleton className="h-4 w-[70%]" />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && error && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-12 text-center">
                  <p className="text-sm font-medium text-danger">Could not load records</p>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{error.message}</p>
                  {onRetry && (
                    <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                      Try again
                    </Button>
                  )}
                </td>
              </tr>
            )}

            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-14 text-center">
                  <Inbox className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
                  <p className="text-sm font-medium">{emptyTitle}</p>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{emptyDescription}</p>
                  {emptyAction && <div className="mt-3">{emptyAction}</div>}
                </td>
              </tr>
            )}

            {!isLoading && !error && rows.map((row) => (
              // Row click is a mouse convenience only. The row keeps its native
              // `row` semantics — giving a <tr> role="button" would strip the table
              // structure screen readers rely on. Keyboard users reach the record
              // through the link in the row's first cell.
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  'border-b border-border last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-muted',
                  rowClassName?.(row.original),
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2.5 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <label htmlFor={`${tableId}-page-size`} className="sr-only">Rows per page</label>
          <span>Rows per page</span>
          <select
            id={`${tableId}-page-size`}
            value={size}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-surface px-2 text-[13px]"
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground tabular">
            Page {total === 0 ? 0 : pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
