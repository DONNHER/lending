import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Printer, Star, X } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../../lib/api';
import { formatDateTime, formatPHP } from '../../lib/productAssets';
import {
  exportCooperativeReportExcel,
  exportCooperativeReportPdf,
  type CooperativeReportData,
  type ReportTabView,
} from '../../lib/reportExport';
import type { ReportPeriod } from '../../lib/reportPeriods';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/StateViews';
import { useAppStore } from '../../stores/app-store';
import { DEFAULT_LEDGER_OPTIONS, filterLedger, ReportLedger, type LedgerColumn } from './ReportLedger';
import { printReport } from './printReport';
import { readReportFavorites, writeReportFavorites, type ReportPreset } from './reportPreferences';

const PERIOD_OPTIONS: Array<{ id: ReportPeriod; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'annually', label: 'Annually' },
];

const REPORT_TABS: Array<{ id: ReportTabView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'pos', label: 'POS Reports' },
  { id: 'loans', label: 'Loan Reports' },
];

type SaleRow = CooperativeReportData['pos_report']['recent_sales'][number];
type LoanRow = CooperativeReportData['loans_report']['loans'][number];

const saleColumns: LedgerColumn<SaleRow>[] = [
  { key: 'sale', label: 'Sale #', value: (sale) => sale.sale_number },
  { key: 'cashier', label: 'Cashier', value: (sale) => sale.cashier_name },
  { key: 'method', label: 'Payment method', value: (sale) => describeSegment(sale.payment_method) },
  { key: 'channel', label: 'Channel', value: (sale) => describeSegment(sale.source) },
  { key: 'status', label: 'Status', value: (sale) => describeSegment(sale.status) },
  { key: 'total', label: 'Total', value: (sale) => sale.total, render: (sale) => formatPHP(sale.total), numeric: true },
  { key: 'time', label: 'Timestamp', value: (sale) => sale.created_at, render: (sale) => formatDateTime(sale.created_at) },
];

const loanColumns: LedgerColumn<LoanRow>[] = [
  { key: 'loan', label: 'Loan #', value: (loan) => loan.loan_number },
  { key: 'member', label: 'Member', value: (loan) => `${loan.shareholder_name} ${loan.membership_number}` },
  { key: 'term', label: 'Term (months)', value: (loan) => loan.term_months, numeric: true },
  { key: 'status', label: 'Status', value: (loan) => describeSegment(loan.status) },
  { key: 'principal', label: 'Principal', value: (loan) => loan.principal, render: (loan) => formatPHP(loan.principal), numeric: true },
  { key: 'paid', label: 'Paid', value: (loan) => loan.total_paid, render: (loan) => formatPHP(loan.total_paid), numeric: true },
  { key: 'balance', label: 'Balance', value: (loan) => loan.outstanding_balance, render: (loan) => formatPHP(loan.outstanding_balance), numeric: true },
];

function describeSegment(value: string): string {
  const words = value.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describePreset(preset: ReportPreset): string {
  return [
    REPORT_TABS.find((tab) => tab.id === preset.tab)?.label,
    PERIOD_OPTIONS.find((period) => period.id === preset.period)?.label,
    preset.segment && describeSegment(preset.segment),
    preset.ledger.search && `${preset.searchColumn || 'All columns'} “${preset.ledger.search}”`,
    preset.ledger.sort && `sort ${preset.ledger.sort} ${preset.ledger.descending ? '↓' : '↑'}`,
  ].filter(Boolean).join(' · ');
}

function buildPrintLedger<T>(id: string, columns: LedgerColumn<T>[], rows: T[]) {
  return {
    id,
    headers: columns.map((column) => column.label),
    rows: rows.map((row) => columns.map((column) => {
      const formatted = column.render?.(row);
      return typeof formatted === 'string' ? formatted : column.value(row);
    })),
  };
}

function ChartSegments({ label, values, selected, onSelect }: {
  label: string;
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div data-report-control role="group" aria-label={label} className="mb-3 flex flex-wrap gap-1.5">
      {['', ...values].map((value) => (
        <button key={value} type="button" aria-pressed={selected === value} onClick={() => onSelect(value)}
          className={`rounded-full border px-2.5 py-1 text-xs ${selected === value ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-300 text-slate-700 hover:border-emerald-700'}`}>
          {value ? describeSegment(value) : 'All'}
        </button>
      ))}
    </div>
  );
}

export function ReportsView() {
  const userId = useAppStore((state) => state.session?.user.id);

  return userId ? <ReportWorkspace key={userId} userId={userId} /> : null;
}

function ReportWorkspace({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [reportTab, setReportTab] = useState<ReportTabView>('overview');
  const [period, setPeriod] = useState<ReportPeriod>('monthly');
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [segment, setSegment] = useState('');
  const [ledger, setLedger] = useState(DEFAULT_LEDGER_OPTIONS);
  const [searchColumn, setSearchColumn] = useState('');
  const [favorites, setFavorites] = useState(() => readReportFavorites(userId));
  const printableContent = useRef<HTMLDivElement>(null);

  const reportQuery = useQuery({
    queryKey: ['reports-overview', period],
    queryFn: async () =>
      (await apiRequest<CooperativeReportData>(`/reports/overview?period=${period}`)).data,
  });

  if (reportQuery.isLoading) return <LoadingSkeleton rows={6} />;
  if (reportQuery.isError) {
    return (
      <ErrorState
        message={(reportQuery.error as Error).message}
        onRetry={() => reportQuery.refetch()}
      />
    );
  }

  const data = reportQuery.data!;
  const saleRows = reportTab === 'pos'
    ? filterLedger(data.pos_report.recent_sales.filter((sale) => !segment || sale.payment_method === segment), saleColumns, ledger, searchColumn)
    : data.pos_report.recent_sales;
  const loanRows = reportTab === 'loans'
    ? filterLedger(data.loans_report.loans.filter((loan) => !segment || loan.status === segment), loanColumns, ledger, searchColumn)
    : data.loans_report.loans;
  const preset = { tab: reportTab, period, segment, searchColumn, ledger };
  const selectedFavorite = favorites.findIndex((favorite) => JSON.stringify(favorite) === JSON.stringify(preset));
  const reportTitle = REPORT_TABS.find((tab) => tab.id === reportTab)!.label;
  const reportLabel = [
    data.period_label,
    segment && describeSegment(segment),
    ledger.search && `Search “${ledger.search}”`,
  ].filter(Boolean).join(' · ');
  const currentReportData = {
    ...data,
    period_label: reportLabel,
    pos_report: { ...data.pos_report, recent_sales: saleRows },
    loans_report: { ...data.loans_report, loans: loanRows },
  };

  function switchTab(tab: ReportTabView) {
    setReportTab(tab);
    setSegment('');
    setLedger(DEFAULT_LEDGER_OPTIONS);
    setSearchColumn('');
  }

  function restoreFavorite(favorite: ReportPreset) {
    setReportTab(favorite.tab);
    setPeriod(favorite.period);
    setSegment(favorite.segment);
    setSearchColumn(favorite.searchColumn);
    setLedger(favorite.ledger);
  }

  function updateFavorites(next: ReportPreset[]) {
    if (writeReportFavorites(userId, next)) {
      setFavorites(next);
    } else {
      setExportMessage('The browser could not save report favorites.');
    }
  }

  function handlePrint() {
    const content = printableContent.current;
    if (!content) return;
    const printRows = reportTab === 'pos' ? buildPrintLedger('sales-ledger', saleColumns, saleRows)
      : reportTab === 'loans' ? buildPrintLedger('loans-ledger', loanColumns, loanRows) : null;
    if (!printReport(content, `${reportTitle} · Agrivit Store`, reportLabel, printRows)) {
      setExportMessage('Allow pop-ups for this site to open the print view.');
    }
  }

  async function logExport(format: 'xlsx' | 'pdf') {
    const rowCount =
      reportTab === 'pos'
        ? saleRows.length
        : reportTab === 'loans'
        ? loanRows.length
        : data.stock_by_category.length + data.pos_report.recent_sales.length;

    try {
      await apiRequest('/reports/export-logs', {
        method: 'POST',
        body: JSON.stringify({
          export_type: `cooperative_${reportTab}_report`,
          format,
          period,
          row_count: rowCount,
          filters: {
            segment, search: ledger.search, search_column: searchColumn,
            sort: ledger.sort, descending: ledger.descending,
          },
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['admin-governance'] });
    } catch {
      // Export file download already completed client-side
    }
  }

  async function handleExportExcel() {
    const filename = exportCooperativeReportExcel(currentReportData, reportTab);
    setExportMessage(`Exported Excel workbook: ${filename}`);
    await logExport('xlsx');
  }

  async function handleExportPdf() {
    const filename = exportCooperativeReportPdf(currentReportData, reportTab);
    setExportMessage(`Exported PDF report: ${filename}`);
    await logExport('pdf');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#0F172A]">
            Cooperative Financial & Inventory Reports
          </h2>
          <p className="text-xs text-[#64748B]">
            Real-time aggregation across POS sales, warehouse base units, share capital, and loans ·{' '}
            <span className="font-medium text-[#334155]">{data.period_label}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Report period"
            className="flex items-center gap-1 rounded-lg border border-[#E2E8E4] bg-white p-1"
          >
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={period === opt.id}
                onClick={() => setPeriod(opt.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  period === opt.id
                    ? 'bg-[#15803D] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-medium text-[#0F172A] hover:border-[#15803D] hover:text-[#15803D] whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-[#15803D]" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#166534] whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Export PDF</span>
          </button>

          <button type="button" onClick={handlePrint} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium hover:border-emerald-700 hover:text-emerald-900">
            <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print report
          </button>
        </div>
      </div>

      {/* Report Domain Toggle (Overview | POS Reports | Loan Reports) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Report sections"
          className="flex items-center gap-1 rounded-lg border border-[#E2E8E4] bg-white p-1"
        >
          {REPORT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={reportTab === t.id}
              onClick={() => { if (reportTab !== t.id) switchTab(t.id); }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                reportTab === t.id
                  ? 'bg-[#15803D] text-white'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <span className="font-mono text-xs text-[#64748B] tabular-nums">
          Window: {data.start_iso.slice(0, 10)} → {data.end_iso.slice(0, 10)}
        </span>
      </div>

      <section aria-label="Favorite report configurations" className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E2E8E4] bg-white p-3">
        <button
          type="button"
          aria-pressed={selectedFavorite >= 0}
          onClick={() => updateFavorites(selectedFavorite < 0 ? [...favorites, preset] : favorites.filter((_, index) => index !== selectedFavorite))}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:border-emerald-700"
        >
          <Star className={`h-3.5 w-3.5 ${selectedFavorite >= 0 ? 'fill-amber-300 text-amber-700' : ''}`} aria-hidden="true" />
          {selectedFavorite >= 0 ? 'Remove favorite' : 'Save as favorite'}
        </button>
        {favorites.map((favorite, index) => (
          <div key={JSON.stringify(favorite)} className="inline-flex max-w-full rounded-md bg-emerald-50 text-xs text-emerald-900">
            <button type="button" onClick={() => restoreFavorite(favorite)} className="min-w-0 truncate rounded-l-md px-2.5 py-1.5 text-left font-medium hover:bg-emerald-100">
              {describePreset(favorite)}
            </button>
            <button
              type="button"
              aria-label={`Remove favorite ${describePreset(favorite)}`}
              onClick={() => updateFavorites(favorites.filter((_, position) => position !== index))}
              className="rounded-r-md px-1.5 hover:bg-emerald-100"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        ))}
      </section>

      {exportMessage ? (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-[#14532D]"
        >
          <span>{exportMessage}</span>
          <button type="button" onClick={() => setExportMessage(null)} className="underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <div ref={printableContent}>
      {/* OVERVIEW REPORT TAB */}
      {reportTab === 'overview' ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Total POS & Pre-Order Revenue</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {formatPHP(data.kpis.total_revenue)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
                {data.kpis.sales_count} completed sale(s) in period
              </div>
              <button data-report-control type="button" onClick={() => switchTab('pos')} className="mt-2 text-xs font-semibold text-emerald-800 underline">View sales report</button>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Warehouse Cost Value</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {formatPHP(data.kpis.inventory_value)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
                {data.kpis.inventory_base_kg.toLocaleString()} base kg on hand
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Verified Share Capital Pool</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#15803D] tabular-nums">
                {formatPHP(data.kpis.verified_share_capital)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B]">
                Member cooperative equity reserve
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Cumulative Loan Principal</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {formatPHP(data.kpis.loan_portfolio_principal)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
                {data.kpis.loan_count} loan account(s) in period
              </div>
              <button data-report-control type="button" onClick={() => switchTab('loans')} className="mt-2 text-xs font-semibold text-emerald-800 underline">View loan report</button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <h3 className="mb-4 font-display text-sm font-semibold text-[#0F172A]">
                Base Stock Quantity by Category (kg)
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.stock_by_category}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8E4" />
                    <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#E2E8E4', fontSize: 12 }} />
                    <Bar dataKey="quantity_base" name="Stock (kg)" fill="#15803D" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <h3 className="mb-4 font-display text-sm font-semibold text-[#0F172A]">
                Revenue Distribution by Category (PHP)
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.sales_by_category}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8E4" />
                    <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip
                      formatter={(value) => formatPHP(Number(value || 0))}
                      contentStyle={{ borderRadius: 8, borderColor: '#E2E8E4', fontSize: 12 }}
                    />
                    <Bar dataKey="revenue" name="Revenue (PHP)" fill="#166534" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* POS REPORTS TAB */}
      {reportTab === 'pos' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">POS Sales Revenue</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#15803D] tabular-nums">
                {formatPHP(data.pos_report.total_revenue)}
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Completed Transactions</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {data.pos_report.sales_count}
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Average Ticket Size</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {formatPHP(data.pos_report.average_ticket)}
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Pre-Order Pickups Fulfilled</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {data.pos_report.preorder_fulfillments}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <h3 className="mb-4 font-display text-sm font-semibold text-[#0F172A]">
                POS Revenue by Payment Method (PHP)
              </h3>
              <ChartSegments label="Drill down by payment method" values={data.pos_report.by_payment_method.map((item) => item.payment_method)} selected={segment} onSelect={setSegment} />
              {data.pos_report.by_payment_method.length === 0 ? (
                <EmptyState
                  title="No POS revenue in this period"
                  description="Switch to Monthly or Annual view, or complete a POS checkout to populate this chart."
                />
              ) : (
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.pos_report.by_payment_method}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8E4" />
                      <XAxis dataKey="payment_method" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip
                        formatter={(value) => formatPHP(Number(value || 0))}
                        contentStyle={{ borderRadius: 8, borderColor: '#E2E8E4', fontSize: 12 }}
                      />
                      <Bar dataKey="revenue" name="Revenue (PHP)" fill="#15803D" radius={[6, 6, 0, 0]}
                        onClick={(_, index) => setSegment(data.pos_report.by_payment_method[index]?.payment_method ?? '')} className="cursor-pointer" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
              <div className="border-b border-[#E2E8E4] px-5 py-3.5">
                <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                  Top Selling Products ({period})
                </h3>
              </div>
              {data.pos_report.top_products.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No item sales recorded"
                    description="No line items fell inside this reporting window."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                      <tr>
                        <th className="px-4 py-2.5">Product</th>
                        <th className="px-4 py-2.5 text-right">Base Sold (kg)</th>
                        <th className="px-4 py-2.5 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8E4]">
                      {data.pos_report.top_products.map((item) => (
                        <tr key={item.sku}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-[#0F172A]">{item.product_name}</div>
                            <div className="font-mono text-[11px] text-[#64748B]">{item.sku}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {item.quantity_base.toLocaleString()} kg
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#15803D] tabular-nums">
                            {formatPHP(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <ReportLedger
            key={period + segment}
            id="sales-ledger"
            title="POS Sales Ledger"
            rows={saleRows}
            columns={saleColumns}
            scopeNote={data.pos_report.sales_count > data.pos_report.recent_sales.length ? `Showing matches from the ${data.pos_report.recent_sales.length} most recent sales in this period.` : undefined}
            options={ledger}
            searchColumn={searchColumn}
            onSearchColumn={setSearchColumn}
            onOptions={setLedger}
          />
        </div>
      ) : null}

      {/* LOAN REPORTS TAB */}
      {reportTab === 'loans' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Principal ({period})</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {formatPHP(data.loans_report.total_principal)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
                {data.loans_report.total_loans} account(s)
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Total Flat Interest</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {formatPHP(data.loans_report.total_interest)}
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Repayments Collected</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#15803D] tabular-nums">
                {formatPHP(data.loans_report.total_collected)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
                {data.loans_report.fully_paid_loans} fully paid
              </div>
            </div>
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div className="text-xs text-[#64748B]">Outstanding Balance</div>
              <div className="mt-1.5 font-mono text-xl font-bold text-[#B45309] tabular-nums">
                {formatPHP(data.loans_report.total_outstanding)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
                {data.loans_report.active_loans} active · {data.loans_report.overdue_loans} overdue
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
            <h3 className="mb-4 font-display text-sm font-semibold text-[#0F172A]">
              Loan Principal by Status (PHP)
            </h3>
            <ChartSegments label="Drill down by loan status" values={data.loans_report.by_status.map((item) => item.status)} selected={segment} onSelect={setSegment} />
            {data.loans_report.by_status.length === 0 ? (
              <EmptyState
                title="No loan accounts in selected period"
                description="Switch to Annual or Monthly period to inspect cooperative loan accounts."
              />
            ) : (
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.loans_report.by_status}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8E4" />
                    <XAxis dataKey="status" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip
                      formatter={(value) => formatPHP(Number(value || 0))}
                      contentStyle={{ borderRadius: 8, borderColor: '#E2E8E4', fontSize: 12 }}
                    />
                    <Bar dataKey="principal" name="Principal (PHP)" fill="#15803D" radius={[6, 6, 0, 0]}
                      onClick={(_, index) => setSegment(data.loans_report.by_status[index]?.status ?? '')} className="cursor-pointer" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <ReportLedger
            key={period + segment}
            id="loans-ledger"
            title="Cooperative Loan Portfolio Ledger"
            rows={loanRows}
            columns={loanColumns}
            options={ledger}
            searchColumn={searchColumn}
            onSearchColumn={setSearchColumn}
            onOptions={setLedger}
          />
        </div>
      ) : null}
      </div>
    </div>
  );
}
