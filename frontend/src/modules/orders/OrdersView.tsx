import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, QrCode, XCircle } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDateTime, formatPHP } from '../../lib/productAssets';
import { canAccessWorkspace, useAppStore } from '../../stores/app-store';
import { usePosStore } from '../../stores/pos-store';
import type { Order } from '../../types/domain';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';

export function OrdersView() {
  const queryClient = useQueryClient();
  const { session, setActiveWorkspace, subTabs, setWorkspaceSubTab } = useAppStore();
  const setScannedOrder = usePosStore((s) => s.setScannedOrder);
  const filter = subTabs.orders;
  const setFilter = (next: 'all' | 'confirmed' | 'fulfilled' | 'cancelled') =>
    setWorkspaceSubTab('orders', next);

  const isStaff = session?.user.role !== 'shareholder';
  const [confirmCancelOrder, setConfirmCancelOrder] = useState<Order | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['orders', isStaff ? 'all' : 'me'],
    queryFn: async () => {
      const endpoint = isStaff ? '/orders' : '/orders/me';
      return (await apiRequest<Order[]>(endpoint)).data;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) =>
      apiRequest(`/orders/${orderId}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setConfirmCancelOrder(null);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: () => {
      setConfirmCancelOrder(null);
    },
  });

  if (ordersQuery.isLoading) return <LoadingSkeleton rows={4} />;
  if (ordersQuery.isError) {
    return (
      <ErrorState
        message={(ordersQuery.error as Error).message}
        onRetry={() => ordersQuery.refetch()}
      />
    );
  }

  const orders = ordersQuery.data || [];
  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#0F172A]">
            {isStaff ? 'Cooperative Pre-Orders Queue' : 'My Online Pre-Orders'}
          </h2>
          <p className="text-xs text-[#64748B]">
            Online pre-orders remain separate records until fulfilled by a POS cashier
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[#E2E8E4] bg-white p-1">
          {(['all', 'confirmed', 'fulfilled', 'cancelled'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                filter === status
                  ? 'bg-[#15803D] text-white'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No pre-orders found"
          description="Pre-orders placed in the Online Shop will appear here with their fulfillment token."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-[#0F172A]">
                      {order.order_number}
                    </span>
                    <StatusLabel
                      tone={
                        order.status === 'fulfilled'
                          ? 'green'
                          : order.status === 'confirmed'
                          ? 'amber'
                          : 'neutral'
                      }
                      label={order.status}
                    />
                  </div>
                  <div className="mt-1 text-xs text-[#64748B]">
                    {order.shareholder_name ? `${order.shareholder_name} · ` : ''}
                    Created {formatDateTime(order.created_at)}
                    {order.notes ? ` · ${order.notes}` : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] bg-[#F7F9F8] px-3 py-1.5 font-mono text-xs font-semibold text-[#0F172A]">
                    <QrCode className="h-3.5 w-3.5 text-[#15803D]" />
                    <span>{order.token_code}</span>
                  </div>
                  <div className="font-mono text-base font-bold text-[#0F172A] tabular-nums">
                    {formatPHP(order.total)}
                  </div>
                </div>
              </div>

              <div className="divide-y divide-[#E2E8E4] border-t border-[#E2E8E4] pt-2 text-xs">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-1.5">
                    <span className="text-[#334155]">
                      {item.product_name} · {item.quantity} × {item.unit_name} ({item.conversion_factor}x base)
                    </span>
                    <span className="font-mono text-[#0F172A] tabular-nums">
                      {formatPHP(item.line_total)}
                    </span>
                  </div>
                ))}
              </div>

              {order.status === 'confirmed' ? (
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={cancelMutation.isPending}
                    onClick={() => setConfirmCancelOrder(order)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-red-50 hover:text-[#DC2626]"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel Order
                  </button>
                  {session && canAccessWorkspace(session.user.role, 'pos') ? (
                    <button
                      type="button"
                      onClick={() => {
                        setScannedOrder(order);
                        setActiveWorkspace('pos');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#166534]"
                    >
                      <span>Fulfill in POS</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmCancelOrder)}
        title="Confirm Order Cancellation"
        description="Cancelling this pre-order will invalidate its pickup token so it cannot be fulfilled at POS."
        details={
          confirmCancelOrder
            ? [
                { label: 'Order Number', value: confirmCancelOrder.order_number },
                { label: 'Pickup Token', value: confirmCancelOrder.token_code },
                { label: 'Order Total', value: formatPHP(confirmCancelOrder.total) },
              ]
            : []
        }
        confirmLabel="Cancel Order"
        tone="red"
        isPending={cancelMutation.isPending}
        onConfirm={() => confirmCancelOrder && cancelMutation.mutate(confirmCancelOrder.id)}
        onCancel={() => setConfirmCancelOrder(null)}
      />
    </div>
  );
}
