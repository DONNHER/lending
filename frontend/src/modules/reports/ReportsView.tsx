import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText } from 'lucide-react';
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
import { EmptyState, ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';

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

export function ReportsView() {
  const queryClient = useQueryClient();
  const [reportTab, setReportTab] = useState<ReportTabView>('overview');
  const [period, setPeriod] = useState<ReportPeriod>('monthly');
  const [exportMessage, setExportMessage] = useState<string | null>(null);

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

  async function logExport(format: 'xlsx' | 'pdf') {
    const rowCount =
      reportTab === 'pos'
        ? data.pos_report.recent_sales.length
        : reportTab === 'loans'
        ? data.loans_report.loans.length
        : data.stock_by_category.length + data.pos_report.recent_sales.length;

    try {
      await apiRequest('/reports/export-logs', {
        method: 'POST',
        body: JSON.stringify({
          export_type: `cooperative_${reportTab}_report`,
          format,
          period,
          row_count: rowCount,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['admin-governance'] });
    } catch {
      // Export file download already completed client-side
    }
  }

  async function handleExportExcel() {
    const filename = exportCooperativeReportExcel(data, reportTab);
    setExportMessage(`Exported Excel workbook: ${filename}`);
    await logExport('xlsx');
  }

  async function handleExportPdf() {
    const filename = exportCooperativeReportPdf(data, reportTab);
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
              onClick={() => setReportTab(t.id)}
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
                      <Bar dataKey="revenue" name="Revenue (PHP)" fill="#15803D" radius={[6, 6, 0, 0]} />
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

          <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
            <div className="border-b border-[#E2E8E4] px-5 py-3.5">
              <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                POS Sales Ledger ({data.pos_report.recent_sales.length})
              </h3>
            </div>
            {data.pos_report.recent_sales.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No sales in selected window"
                  description="Try switching period between Daily, Weekly, Monthly, or Annually."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                    <tr>
                      <th className="px-4 py-2.5">Sale #</th>
                      <th className="px-4 py-2.5">Cashier</th>
                      <th className="px-4 py-2.5">Method</th>
                      <th className="px-4 py-2.5">Channel</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="px-4 py-2.5 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8E4]">
                    {data.pos_report.recent_sales.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5 font-mono font-semibold text-[#0F172A]">
                          {s.sale_number}
                        </td>
                        <td className="px-4 py-2.5 text-[#334155]">{s.cashier_name}</td>
                        <td className="px-4 py-2.5 uppercase text-[#475569]">{s.payment_method}</td>
                        <td className="px-4 py-2.5 capitalize text-[#475569]">
                          {s.source.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#0F172A] tabular-nums">
                          {formatPHP(s.total)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[#64748B] tabular-nums">
                          {formatDateTime(s.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
                    <Bar dataKey="principal" name="Principal (PHP)" fill="#15803D" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
            <div className="border-b border-[#E2E8E4] px-5 py-3.5">
              <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                Cooperative Loan Portfolio Ledger ({data.loans_report.loans.length})
              </h3>
            </div>
            {data.loans_report.loans.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No loans recorded in this timeframe"
                  description="Select Annually or Monthly to view cooperative loan portfolio entries."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                    <tr>
                      <th className="px-4 py-2.5">Loan #</th>
                      <th className="px-4 py-2.5">Member</th>
                      <th className="px-4 py-2.5">Term</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Principal</th>
                      <th className="px-4 py-2.5 text-right">Paid</th>
                      <th className="px-4 py-2.5 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8E4]">
                    {data.loans_report.loans.map((l) => (
                      <tr key={l.id}>
                        <td className="px-4 py-2.5 font-mono font-semibold text-[#0F172A]">
                          {l.loan_number}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-[#0F172A]">{l.shareholder_name}</div>
                          <div className="font-mono text-[11px] text-[#64748B]">
                            {l.membership_number}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{l.term_months} mos</td>
                        <td className="px-4 py-2.5">
                          <StatusLabel
                            tone={
                              l.status === 'fully_paid'
                                ? 'green'
                                : l.status === 'overdue'
                                ? 'red'
                                : 'amber'
                            }
                            label={l.status.replace('_', ' ')}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          {formatPHP(l.principal)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[#15803D] tabular-nums">
                          {formatPHP(l.total_paid)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#0F172A] tabular-nums">
                          {formatPHP(l.outstanding_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
