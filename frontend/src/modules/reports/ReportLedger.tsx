import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowDownUp, ArrowUp } from 'lucide-react';
import { EmptyState } from '../../components/ui/StateViews';

export interface LedgerColumn<T> {
  key: string;
  label: string;
  value: (row: T) => number | string;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
}

export interface LedgerOptions {
  search: string;
  sort: string;
  descending: boolean;
}

export const DEFAULT_LEDGER_OPTIONS: LedgerOptions = { search: '', sort: '', descending: false };

export function filterLedger<T>(rows: T[], columns: LedgerColumn<T>[], options: LedgerOptions, field = ''): T[] {
  const query = options.search.trim().toLowerCase();
  const matchedColumns = field ? columns.filter((column) => column.key === field) : columns;
  const visibleRows = query
    ? rows.filter((row) => matchedColumns.some((column) => String(column.value(row)).toLowerCase().includes(query)))
    : rows;
  const column = columns.find((item) => item.key === options.sort);
  if (!column) return visibleRows;

  return [...visibleRows].sort((left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    const difference = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true });
    return options.descending ? -difference : difference;
  });
}

interface ReportLedgerProps<T extends { id: string }> {
  id: string;
  title: string;
  rows: T[];
  columns: LedgerColumn<T>[];
  scopeNote?: string;
  options: LedgerOptions;
  searchColumn: string;
  onSearchColumn: (column: string) => void;
  onOptions: (options: LedgerOptions) => void;
}

export function ReportLedger<T extends { id: string }>({
  id, title, rows, columns, scopeNote, options, searchColumn, onSearchColumn, onOptions,
}: ReportLedgerProps<T>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;

  function sortBy(key: string) {
    onOptions({ ...options, sort: key, descending: options.sort === key && !options.descending });
    setPage(1);
  }

  return (
    <section id={id} className="scroll-mt-24 overflow-hidden rounded-xl border border-[#E2E8E4] bg-white" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8E4] px-5 py-3.5">
        <div>
          <h3 id={`${id}-title`} className="font-display text-sm font-semibold text-slate-900">{title} ({rows.length})</h3>
          {scopeNote && <p className="mt-1 text-xs text-slate-600">{scopeNote}</p>}
        </div>
        <div data-report-control className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Search ${title} column`}
            value={searchColumn}
            onChange={(event) => { onSearchColumn(event.target.value); setPage(1); }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">All columns</option>
            {columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
          <input
            type="search"
            aria-label={`Search ${title}`}
            placeholder="Search records"
            value={options.search}
            onChange={(event) => { onOptions({ ...options, search: event.target.value }); setPage(1); }}
            className="min-w-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-5"><EmptyState title="No matching records" description="Adjust the reporting period or the current filters." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-slate-700">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col" aria-sort={options.sort === column.key ? (options.descending ? 'descending' : 'ascending') : undefined} className={`px-4 py-2.5 ${column.numeric ? 'text-right' : ''}`}>
                    <button type="button" onClick={() => sortBy(column.key)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-emerald-800">
                      {column.label}
                      {options.sort !== column.key ? <ArrowDownUp className="h-3 w-3" /> : options.descending ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E4] text-slate-700">
              {rows.slice(start, start + pageSize).map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-2.5 ${column.numeric ? 'text-right font-mono tabular-nums' : ''}`}>
                      {column.render ? column.render(row) : column.value(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div data-report-control className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8E4] px-5 py-2.5 text-xs text-slate-700">
        <label className="flex items-center gap-2">
          Rows per page
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-md border border-slate-300 bg-white px-1.5 py-1">
            {[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-md border px-2 py-1 disabled:opacity-50">Previous</button>
          <span aria-live="polite">Page {currentPage} of {totalPages}</span>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-md border px-2 py-1 disabled:opacity-50">Next</button>
        </div>
      </div>
    </section>
  );
}
