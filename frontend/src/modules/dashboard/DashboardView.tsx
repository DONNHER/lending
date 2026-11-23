import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Landmark,
  PackageCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';
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
import { useAppStore } from '../../stores/app-store';
import type { InventoryMovement } from '../../types/domain';
import { ErrorState, LoadingSkeleton } from '../../components/ui/StateViews';

interface ReportsOverview {
  kpis: {
    total_revenue: number;
    sales_count: number;
    inventory_value: number;
    inventory_base_kg: number;
    verified_share_capital: number;
    loan_portfolio_principal: number;
    loan_count: number;
    pending_docs: number;
    pending_loan_apps: number;
    open_sync_conflicts: number;
  };
  sales_by_category: Array<{ category: string; revenue: number }>;
  stock_by_category: Array<{ category: string; quantity_base: number; cost_value: number }>;
}

export function DashboardView() {
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const offlineOutbox = useAppStore((s) => s.offlineOutbox);

  const reportQuery = useQuery({
    queryKey: ['reports-overview'],
    queryFn: async () => (await apiRequest<ReportsOverview>('/reports/overview')).data,
  });

  const movementsQuery = useQuery({
    queryKey: ['inventory-movements'],
    queryFn: async () => (await apiRequest<InventoryMovement[]>('/inventory/movements')).data,
  });

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <LoadingSkeleton rows={1} />
          <LoadingSkeleton rows={1} />
          <LoadingSkeleton rows={1} />
          <LoadingSkeleton rows={1} />
        </div>
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  if (reportQuery.isError) {
    return (
      <ErrorState
        message={(reportQuery.error as Error).message}
        onRetry={() => reportQuery.refetch()}
      />
    );
  }

  const data = reportQuery.data!;
  const { kpis } = data;

  return (
    <div className="space-y-6">
      {/* Primary KPI Strip */}
      <section aria-label="Cooperative key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>POS & Shop Revenue</span>
            <ShoppingCart className="h-4 w-4 text-[#15803D]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
            {formatPHP(kpis.total_revenue)}
          </div>
          <div className="mt-1 text-xs text-[#64748B] tabular-nums">
            {kpis.sales_count} completed {kpis.sales_count === 1 ? 'transaction' : 'transactions'}
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>Warehouse Valuation</span>
            <PackageCheck className="h-4 w-4 text-[#15803D]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
            {formatPHP(kpis.inventory_value)}
          </div>
          <div className="mt-1 text-xs text-[#64748B] tabular-nums">
            {kpis.inventory_base_kg.toLocaleString()} kg base stock on hand
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>Verified Share Capital</span>
            <Users className="h-4 w-4 text-[#15803D]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
            {formatPHP(kpis.verified_share_capital)}
          </div>
          <div className="mt-1 text-xs text-[#64748B]">
            {kpis.pending_docs} document reviews pending
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>Loan Portfolio Principal</span>
            <Landmark className="h-4 w-4 text-[#15803D]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
            {formatPHP(kpis.loan_portfolio_principal)}
          </div>
          <div className="mt-1 text-xs text-[#64748B]">
            {kpis.loan_count} {kpis.loan_count === 1 ? 'loan' : 'loans'} · {kpis.pending_loan_apps}{' '}
            {kpis.pending_loan_apps === 1 ? 'application' : 'applications'} awaiting review
          </div>
        </div>
      </section>

      {/* Action Queues & Quick Workspace Routes */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={() => setActiveWorkspace('shareholders')}
          className="flex items-center justify-between rounded-xl border border-[#E2E8E4] bg-white p-4 text-left transition-colors hover:border-[#15803D]"
        >
          <div>
            <div className="text-xs font-medium text-[#64748B]">Membership Verification</div>
            <div className="mt-1 font-display text-base font-semibold text-[#0F172A]">
              {kpis.pending_docs} Pending Document Review{kpis.pending_docs === 1 ? '' : 's'}
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-[#15803D]" />
        </button>

        <button
          type="button"
          onClick={() => setActiveWorkspace('loans')}
          className="flex items-center justify-between rounded-xl border border-[#E2E8E4] bg-white p-4 text-left transition-colors hover:border-[#15803D]"
        >
          <div>
            <div className="text-xs font-medium text-[#64748B]">Credit Underwriting</div>
            <div className="mt-1 font-display text-base font-semibold text-[#0F172A]">
              {kpis.pending_loan_apps} Loan Application{kpis.pending_loan_apps === 1 ? '' : 's'}
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-[#15803D]" />
        </button>

        <button
          type="button"
          onClick={() => setActiveWorkspace('pos')}
          className="flex items-center justify-between rounded-xl border border-[#E2E8E4] bg-white p-4 text-left transition-colors hover:border-[#15803D]"
        >
          <div>
            <div className="text-xs font-medium text-[#64748B]">POS & Sync Outbox</div>
            <div className="mt-1 font-display text-base font-semibold text-[#0F172A]">
              {offlineOutbox.length} Local Outbox · {kpis.open_sync_conflicts} Conflicts
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-[#15803D]" />
        </button>
      </section>

      {/* Analytics Row */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Stock Value by Category (PHP)
            </h2>
            <p className="text-xs text-[#64748B]">
              Warehouse cost valuation calculated from base-unit kilogram balances
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.stock_by_category} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8E4" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip
                  formatter={(value) => formatPHP(Number(value || 0))}
                  contentStyle={{ borderRadius: 8, borderColor: '#E2E8E4', fontSize: 12 }}
                />
                <Bar dataKey="cost_value" name="Stock Cost Value" fill="#15803D" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Sales Revenue by Category (PHP)
            </h2>
            <p className="text-xs text-[#64748B]">
              Aggregated from POS sales, fulfilled pre-orders, and offline sync batches
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.sales_by_category} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8E4" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip
                  formatter={(value) => formatPHP(Number(value || 0))}
                  contentStyle={{ borderRadius: 8, borderColor: '#E2E8E4', fontSize: 12 }}
                />
                <Bar dataKey="revenue" name="Revenue" fill="#166534" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Recent Inventory Ledger */}
      <section className="rounded-xl border border-[#E2E8E4] bg-white">
        <div className="flex items-center justify-between border-b border-[#E2E8E4] px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Recent Inventory Ledger Movements
            </h2>
            <p className="text-xs text-[#64748B]">
              Immutable base-unit stock movements across sales, receipts, returns, and adjustments
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveWorkspace('inventory')}
            className="rounded-lg border border-[#E2E8E4] px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] whitespace-nowrap"
          >
            Open Ledger
          </button>
        </div>

        <div className="overflow-x-auto">
          {movementsQuery.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={4} />
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-xs font-medium text-[#475569]">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3 text-right">Base Qty</th>
                  <th className="px-5 py-3">Notes</th>
                  <th className="px-5 py-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E4]">
                {(movementsQuery.data || []).slice(0, 6).map((mov) => (
                  <tr key={mov.id} className="hover:bg-[#F7F9F8]/60">
                    <td className="px-5 py-3 font-medium text-[#0F172A]">
                      {mov.product_name}
                      <span className="ml-2 font-mono text-xs text-[#64748B]">{mov.product_sku}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[#475569] capitalize">
                      {mov.movement_type.replace('_', ' ')}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-mono text-xs font-medium tabular-nums ${
                        mov.quantity_base >= 0 ? 'text-[#15803D]' : 'text-[#B45309]'
                      }`}
                    >
                      {mov.quantity_base >= 0 ? `+${mov.quantity_base}` : mov.quantity_base}{' '}
                      {mov.base_unit || 'kg'}
                    </td>
                    <td className="px-5 py-3 text-xs text-[#475569]">{mov.notes || '—'}</td>
                    <td className="px-5 py-3 text-right font-mono text-xs text-[#64748B] tabular-nums">
                      {formatDateTime(mov.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
