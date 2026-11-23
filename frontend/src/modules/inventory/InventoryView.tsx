import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  History,
  PackagePlus,
  Printer,
  ScanBarcode,
  SlidersHorizontal,
} from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { formatDateTime, formatPHP } from '../../lib/productAssets';
import { useAppStore } from '../../stores/app-store';
import type { Category, InventoryMovement, Product, Supplier } from '../../types/domain';
import { ProductImportExportPanel } from '../../components/inventory/ProductImportExportPanel';
import { Code128BarcodeSvg } from '../../components/pos/ThermalReceipt80mm';
import { ConfirmDialog, type ConfirmDetailRow } from '../../components/ui/ConfirmDialog';
import { ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';

type PendingInventoryTx =
  | { kind: 'receipt' }
  | { kind: 'adjust' }
  | { kind: 'create' };

const INVENTORY_PAGE_SIZE = 8;

export function InventoryView() {
  const queryClient = useQueryClient();
  const role = useAppStore((s) => s.session?.user.role);
  const canEdit = role === 'admin' || role === 'manager';

  const rawTab = useAppStore((s) => s.subTabs.inventory);
  const setWorkspaceSubTab = useAppStore((s) => s.setWorkspaceSubTab);
  const tab: 'balances' | 'movements' | 'receipt' | 'adjust' | 'create' | 'import-export' =
    !canEdit &&
    (rawTab === 'receipt' || rawTab === 'adjust' || rawTab === 'create' || rawTab === 'import-export')
      ? 'balances'
      : rawTab;
  const setTab = (next: 'balances' | 'movements' | 'receipt' | 'adjust' | 'create' | 'import-export') =>
    setWorkspaceSubTab('inventory', next);
  const [balancePage, setBalancePage] = useState(1);
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingInventoryTx | null>(null);

  // Stock Receipt form state
  const [rcptSupplierId, setRcptSupplierId] = useState('sup-1');
  const [rcptProductId, setRcptProductId] = useState('prod-1');
  const [rcptUnitId, setRcptUnitId] = useState('');
  const [rcptQty, setRcptQty] = useState('10');
  const [rcptNotes, setRcptNotes] = useState('');

  // Adjustment form state
  const [adjProductId, setAdjProductId] = useState('prod-1');
  const [adjDirection, setAdjDirection] = useState<'increase' | 'decrease'>('increase');
  const [adjQtyBase, setAdjQtyBase] = useState('25');
  const [adjNotes, setAdjNotes] = useState('');

  // Create Product form state
  const [newName, setNewName] = useState('');
  const [newSku, setNewSku] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [labelProduct, setLabelProduct] = useState<Product | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [newCatId, setNewCatId] = useState('cat-fert');
  const [newDesc, setNewDesc] = useState('');
  const [newCost, setNewCost] = useState('22');
  const [newSackFactor, setNewSackFactor] = useState('50');
  const [newSackPrice, setNewSackPrice] = useState('1300');
  const [newKgPrice, setNewKgPrice] = useState('29');
  const [newOpeningStock, setNewOpeningStock] = useState('500');

  const balancesQuery = useQuery({
    queryKey: ['inventory-balances', balancePage],
    queryFn: async () =>
      apiRequest<Product[]>(
        `/inventory/balances?page=${balancePage}&per_page=${INVENTORY_PAGE_SIZE}`
      ),
  });

  const allProductsQuery = useQuery({
    queryKey: ['inventory-all-products'],
    enabled: tab === 'receipt' || tab === 'adjust' || tab === 'import-export',
    queryFn: async () => (await apiRequest<Product[]>('/products')).data,
  });

  const metaQuery = useQuery({
    queryKey: ['inventory-meta'],
    queryFn: async () =>
      (await apiRequest<{ categories: Category[]; suppliers: Supplier[] }>('/inventory/meta')).data,
  });

  const movementsQuery = useQuery({
    queryKey: ['inventory-movements'],
    enabled: tab === 'movements',
    queryFn: async () => (await apiRequest<InventoryMovement[]>('/inventory/movements')).data,
  });

  const receiptMutation = useMutation({
    mutationFn: async () => {
      const products = allProductsQuery.data || balancesQuery.data?.data || [];
      const prod = products.find((p) => p.id === rcptProductId);
      const unitId = rcptUnitId || prod?.units[0]?.id || '';
      return apiRequest('/inventory/receipts', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: rcptSupplierId,
          product_id: rcptProductId,
          unit_id: unitId,
          quantity: Number(rcptQty),
          notes: rcptNotes,
        }),
      });
    },
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      setRcptNotes('');
      setTab('balances');
      queryClient.invalidateQueries({ queryKey: ['inventory-balances'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Receipt failed.' });
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async () =>
      apiRequest('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          product_id: adjProductId,
          direction: adjDirection,
          quantity_base: Number(adjQtyBase),
          notes: adjNotes,
        }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      setAdjNotes('');
      setTab('movements');
      queryClient.invalidateQueries({ queryKey: ['inventory-balances'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Adjustment failed.' });
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async () =>
      apiRequest<Product>('/products', {
        method: 'POST',
        body: JSON.stringify({
          category_id: newCatId,
          sku: newSku,
          barcode: newBarcode.trim() || null,
          name: newName,
          description: newDesc,
          base_unit: 'kg',
          cost_price: Number(newCost),
          image_key: newCatId === 'cat-seed' ? 'seeds' : newCatId === 'cat-feed' ? 'feed' : 'fertilizer',
          initial_stock_base: Number(newOpeningStock),
          units: [
            {
              unit_name: `sack (${newSackFactor} kg)`,
              conversion_factor: Number(newSackFactor),
              selling_price: Number(newSackPrice),
              is_default: true,
            },
            {
              unit_name: 'kg',
              conversion_factor: 1,
              selling_price: Number(newKgPrice),
              is_default: false,
            },
          ],
        }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      setLabelProduct(res.data.barcode ? res.data : null);
      setNewName('');
      setNewSku('');
      setNewBarcode('');
      setNewDesc('');
      setTab('balances');
      queryClient.invalidateQueries({ queryKey: ['inventory-balances'] });
      queryClient.invalidateQueries({ queryKey: ['shop-products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-catalog-cache'] });
      queryClient.invalidateQueries({ queryKey: ['pos-product-search'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Failed to create product.' });
    },
  });

  function generateBarcode() {
    const digits = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('').toUpperCase();
    setNewBarcode(`AGV-${digits}`);
  }

  function printLabel() {
    if (!labelRef.current) return;
    const printWindow = window.open('', '_blank', 'popup,width=480,height=360');
    if (!printWindow) {
      setFeedback({ tone: 'red', text: 'Allow pop-ups in this browser to print the label.' });
      return;
    }
    printWindow.opener = null;
    const doc = printWindow.document;
    doc.title = 'Agrivet product label';
    const styles = doc.createElement('style');
    styles.textContent = '@page{margin:2mm} body{margin:0;color:#000;font:12px system-ui;text-align:center} svg{display:block;width:100%;max-width:65mm;height:13mm;margin:2mm auto}';
    doc.head.append(styles);
    doc.body.append(doc.importNode(labelRef.current, true));
    printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
    printWindow.focus();
    printWindow.print();
  }

  if (balancesQuery.isLoading) return <LoadingSkeleton rows={6} />;
  if (balancesQuery.isError) {
    return (
      <ErrorState
        message={(balancesQuery.error as Error).message}
        onRetry={() => balancesQuery.refetch()}
      />
    );
  }

  const pagedProducts = balancesQuery.data?.data || [];
  const balanceMeta = (balancesQuery.data?.meta as {
    page?: number;
    total?: number;
    total_pages?: number;
    has_more?: boolean;
  } | undefined) || {};
  const balanceTotal = typeof balanceMeta.total === 'number' ? balanceMeta.total : pagedProducts.length;
  const balanceTotalPages = typeof balanceMeta.total_pages === 'number' ? balanceMeta.total_pages : 1;
  const balanceHasMore = Boolean(balanceMeta.has_more);
  const products = allProductsQuery.data || pagedProducts;
  const selectedRcptProd = products.find((p) => p.id === rcptProductId) || products[0];

  function handleReceiptSubmit(e: FormEvent) {
    e.preventDefault();
    setPendingTx({ kind: 'receipt' });
  }

  function handleAdjustSubmit(e: FormEvent) {
    e.preventDefault();
    setPendingTx({ kind: 'adjust' });
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setPendingTx({ kind: 'create' });
  }

  const supplierName =
    (metaQuery.data?.suppliers || []).find((s) => s.id === rcptSupplierId)?.name || rcptSupplierId;
  const rcptUnitObj =
    selectedRcptProd?.units.find((u) => u.id === rcptUnitId) || selectedRcptProd?.units[0];
  const selectedAdjProd = products.find((p) => p.id === adjProductId) || products[0];
  const selectedCatName =
    (metaQuery.data?.categories || []).find((c) => c.id === newCatId)?.name || newCatId;

  let confirmConfig: {
    title: string;
    description: string;
    details: ConfirmDetailRow[];
    confirmLabel: string;
    tone: 'green' | 'amber' | 'red';
    onConfirm: () => void;
  } | null = null;

  if (pendingTx?.kind === 'receipt') {
    confirmConfig = {
      title: 'Confirm Stock Receipt',
      description: 'Post this incoming supplier delivery into the warehouse inventory ledger.',
      details: [
        { label: 'Supplier', value: supplierName },
        { label: 'Product', value: selectedRcptProd?.name || rcptProductId },
        {
          label: 'Quantity',
          value: `${rcptQty} ${rcptUnitObj?.unit_name || 'units'}`,
        },
        ...(rcptNotes ? [{ label: 'Waybill / Notes', value: rcptNotes }] : []),
      ],
      confirmLabel: 'Confirm & Post Receipt',
      tone: 'green',
      onConfirm: () => {
        receiptMutation.mutate(undefined, {
          onSettled: () => setPendingTx(null),
        });
      },
    };
  } else if (pendingTx?.kind === 'adjust') {
    confirmConfig = {
      title: 'Confirm Inventory Adjustment',
      description: 'Record an auditable stock variance adjustment in base kilograms.',
      details: [
        { label: 'Product', value: selectedAdjProd?.name || adjProductId },
        {
          label: 'Adjustment',
          value: `${adjDirection === 'increase' ? '+' : '-'}${adjQtyBase} ${selectedAdjProd?.base_unit || 'kg'}`,
        },
        { label: 'Audit Reason', value: adjNotes },
      ],
      confirmLabel: 'Confirm Adjustment',
      tone: 'amber',
      onConfirm: () => {
        adjustMutation.mutate(undefined, {
          onSettled: () => setPendingTx(null),
        });
      },
    };
  } else if (pendingTx?.kind === 'create') {
    confirmConfig = {
      title: 'Confirm New Product Creation',
      description: 'Add this dual-unit cooperative product to the catalog and warehouse balances.',
      details: [
        { label: 'Product', value: `${newName} (${newSku})` },
        { label: 'Category', value: selectedCatName },
        { label: 'Sack Price', value: `${formatPHP(Number(newSackPrice))} / ${newSackFactor} kg` },
        { label: 'Per kg Price', value: formatPHP(Number(newKgPrice)) },
        { label: 'Opening Stock', value: `${newOpeningStock} kg` },
      ],
      confirmLabel: 'Confirm & Create Product',
      tone: 'green',
      onConfirm: () => {
        createProductMutation.mutate(undefined, {
          onSettled: () => setPendingTx(null),
        });
      },
    };
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#E2E8E4] bg-white p-1">
          <button
            type="button"
            onClick={() => setTab('balances')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              tab === 'balances' ? 'bg-[#15803D] text-white' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            Stock Balances
          </button>
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              tab === 'movements' ? 'bg-[#15803D] text-white' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Ledger Movements
          </button>
          {canEdit ? (
            <>
              <button
                type="button"
                onClick={() => setTab('receipt')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  tab === 'receipt' ? 'bg-[#15803D] text-white' : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Receive Stock
              </button>
              <button
                type="button"
                onClick={() => setTab('adjust')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  tab === 'adjust' ? 'bg-[#15803D] text-white' : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Adjustment
              </button>
              <button
                type="button"
                onClick={() => setTab('create')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  tab === 'create' ? 'bg-[#15803D] text-white' : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <PackagePlus className="h-3.5 w-3.5" />
                New Product
              </button>
              <button
                type="button"
                onClick={() => setTab('import-export')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  tab === 'import-export'
                    ? 'bg-[#15803D] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Import / Export
              </button>
            </>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'green'
              ? 'border-emerald-200 bg-emerald-50 text-[#14532D]'
              : 'border-red-200 bg-red-50 text-[#991B1B]'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {tab === 'balances' && labelProduct?.barcode && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-white p-4">
          <div ref={labelRef} className="max-w-full text-center text-sm text-slate-900">
            <strong>{labelProduct.name}</strong>
            <Code128BarcodeSvg value={labelProduct.barcode} />
            <div className="font-mono text-xs">{labelProduct.barcode}</div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={printLabel} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
              <Printer className="h-4 w-4" /> Print barcode label
            </button>
            <button type="button" onClick={() => setLabelProduct(null)} className="text-sm text-slate-600 underline">Dismiss</button>
          </div>
        </section>
      )}

      {tab === 'balances' ? (
        <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
          <div className="border-b border-[#E2E8E4] px-5 py-4">
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Dual-Unit Warehouse Inventory
            </h2>
            <p className="text-xs text-[#64748B]">
              Central stock balances are stored in base kilograms (kg) and converted automatically across sack and kilogram selling units
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-xs font-medium text-[#475569]">
                <tr>
                  <th className="px-5 py-3">Product & SKU</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Selling Units</th>
                  <th className="px-5 py-3 text-right">Base Balance</th>
                  <th className="px-5 py-3 text-right">Cost / kg</th>
                  <th className="px-5 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E4]">
                {pagedProducts.map((p) => {
                  const lowStock = p.stock_base < 200;
                  return (
                    <tr key={p.id} className="hover:bg-[#F7F9F8]/60">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-[#0F172A]">{p.name}</div>
                        <div className="font-mono text-xs text-[#64748B]">
                          {p.sku} {p.barcode ? `· ${p.barcode}` : ''}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[#475569]">{p.category_name}</td>
                      <td className="px-5 py-3.5 text-xs text-[#334155]">
                        {p.units.map((u) => (
                          <div key={u.id} className="font-mono tabular-nums">
                            {u.unit_name} = {u.conversion_factor} {p.base_unit} · {formatPHP(u.selling_price)}
                          </div>
                        ))}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                        {p.stock_base.toLocaleString()} {p.base_unit}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-xs text-[#475569] tabular-nums">
                        {formatPHP(p.cost_price)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <StatusLabel
                          tone={lowStock ? 'amber' : 'green'}
                          label={lowStock ? 'Low Stock' : 'In Stock'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8E4] px-5 py-3">
            <div className="font-mono text-xs text-[#64748B] tabular-nums">
              Showing {balanceTotal === 0 ? 0 : (balancePage - 1) * INVENTORY_PAGE_SIZE + 1}–
              {(balancePage - 1) * INVENTORY_PAGE_SIZE + pagedProducts.length} of {balanceTotal} products
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={balancePage <= 1 || balancesQuery.isFetching}
                onClick={() => setBalancePage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Previous</span>
              </button>
              <span className="px-2 font-mono text-xs text-[#475569] tabular-nums">
                Page {balancePage} of {balanceTotalPages}
              </span>
              <button
                type="button"
                disabled={!balanceHasMore || balancesQuery.isFetching}
                onClick={() => setBalancePage((p) => p + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'movements' ? (
        <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
          <div className="border-b border-[#E2E8E4] px-5 py-4">
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Inventory Movements Ledger
            </h2>
            <p className="text-xs text-[#64748B]">
              Append-only audit log of all receipts, POS sales, offline sync batches, returns, and adjustments
            </p>
          </div>
          {movementsQuery.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={5} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-xs font-medium text-[#475569]">
                  <tr>
                    <th className="px-5 py-3">Product</th>
                    <th className="px-5 py-3">Movement</th>
                    <th className="px-5 py-3 text-right">Quantity</th>
                    <th className="px-5 py-3">Actor</th>
                    <th className="px-5 py-3">Notes</th>
                    <th className="px-5 py-3 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E4]">
                  {(movementsQuery.data || []).map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-3 font-medium text-[#0F172A]">{m.product_name}</td>
                      <td className="px-5 py-3 text-xs capitalize text-[#475569]">
                        {m.movement_type.replace('_', ' ')}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-mono text-xs font-semibold tabular-nums ${
                          m.quantity_base >= 0 ? 'text-[#15803D]' : 'text-[#B45309]'
                        }`}
                      >
                        {m.quantity_base >= 0 ? `+${m.quantity_base}` : m.quantity_base}{' '}
                        {m.base_unit || 'kg'}
                      </td>
                      <td className="px-5 py-3 text-xs text-[#475569]">{m.created_by_name}</td>
                      <td className="px-5 py-3 text-xs text-[#64748B]">{m.notes || '—'}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-[#64748B] tabular-nums">
                        {formatDateTime(m.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'receipt' && canEdit ? (
        <form
          onSubmit={handleReceiptSubmit}
          className="max-w-xl rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4"
        >
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Receive Supplier Stock
            </h2>
            <p className="text-xs text-[#64748B]">
              Incoming sacks or base units are automatically converted into warehouse kilogram balances
            </p>
          </div>

          <div>
            <label htmlFor="rcpt-supplier" className="block text-xs font-medium text-[#334155]">
              Supplier
            </label>
            <select
              id="rcpt-supplier"
              value={rcptSupplierId}
              onChange={(e) => setRcptSupplierId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm"
            >
              {(metaQuery.data?.suppliers || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rcpt-product" className="block text-xs font-medium text-[#334155]">
                Product
              </label>
              <select
                id="rcpt-product"
                value={rcptProductId}
                onChange={(e) => {
                  setRcptProductId(e.target.value);
                  setRcptUnitId('');
                }}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rcpt-unit" className="block text-xs font-medium text-[#334155]">
                Receiving Unit
              </label>
              <select
                id="rcpt-unit"
                value={rcptUnitId || selectedRcptProd?.units[0]?.id || ''}
                onChange={(e) => setRcptUnitId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm"
              >
                {(selectedRcptProd?.units || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unit_name} ({u.conversion_factor} kg)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="rcpt-qty" className="block text-xs font-medium text-[#334155]">
              Quantity
            </label>
            <input
              id="rcpt-qty"
              type="number"
              min="0.1"
              step="any"
              required
              value={rcptQty}
              onChange={(e) => setRcptQty(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
            />
          </div>

          <div>
            <label htmlFor="rcpt-notes" className="block text-xs font-medium text-[#334155]">
              Delivery Waybill / Notes
            </label>
            <input
              id="rcpt-notes"
              type="text"
              value={rcptNotes}
              onChange={(e) => setRcptNotes(e.target.value)}
              placeholder="Waybill #WB-4410"
              className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={receiptMutation.isPending}
            className="rounded-lg bg-[#15803D] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#166534] disabled:opacity-50"
          >
            {receiptMutation.isPending ? 'Posting Receipt...' : 'Post Stock Receipt'}
          </button>
        </form>
      ) : null}

      {tab === 'adjust' && canEdit ? (
        <form
          onSubmit={handleAdjustSubmit}
          className="max-w-xl rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4"
        >
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Auditable Inventory Adjustment
            </h2>
            <p className="text-xs text-[#64748B]">
              Record physical cycle-count variances or damaged bag write-offs in base kilograms
            </p>
          </div>

          <div>
            <label htmlFor="adj-prod" className="block text-xs font-medium text-[#334155]">
              Product
            </label>
            <select
              id="adj-prod"
              value={adjProductId}
              onChange={(e) => setAdjProductId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Current: {p.stock_base} {p.base_unit})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="adj-dir" className="block text-xs font-medium text-[#334155]">
                Adjustment Type
              </label>
              <select
                id="adj-dir"
                value={adjDirection}
                onChange={(e) => setAdjDirection(e.target.value as 'increase' | 'decrease')}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm"
              >
                <option value="increase">Increase (+ Base kg)</option>
                <option value="decrease">Decrease (- Base kg)</option>
              </select>
            </div>
            <div>
              <label htmlFor="adj-qty" className="block text-xs font-medium text-[#334155]">
                Quantity (Base kg)
              </label>
              <input
                id="adj-qty"
                type="number"
                min="0.1"
                step="any"
                required
                value={adjQtyBase}
                onChange={(e) => setAdjQtyBase(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="adj-reason" className="block text-xs font-medium text-[#334155]">
              Audit Reason
            </label>
            <input
              id="adj-reason"
              type="text"
              required
              value={adjNotes}
              onChange={(e) => setAdjNotes(e.target.value)}
              placeholder="Physical warehouse cycle count variance"
              className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={adjustMutation.isPending}
            className="rounded-lg bg-[#15803D] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#166534] disabled:opacity-50"
          >
            {adjustMutation.isPending ? 'Recording...' : 'Record Adjustment'}
          </button>
        </form>
      ) : null}

      {tab === 'create' && canEdit ? (
        <form
          onSubmit={handleCreateSubmit}
          className="max-w-2xl rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4"
        >
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Add Dual-Unit Cooperative Product
            </h2>
            <p className="text-xs text-[#64748B]">
              Define base kilogram tracking alongside bulk sack and retail per-kilogram selling prices
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="np-name" className="block text-xs font-medium text-[#334155]">
                Product Name
              </label>
              <input
                id="np-name"
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ammonium Sulfate 21-0-0"
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="np-cat" className="block text-xs font-medium text-[#334155]">
                Category
              </label>
              <select
                id="np-cat"
                value={newCatId}
                onChange={(e) => setNewCatId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm"
              >
                {(metaQuery.data?.categories || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="np-sku" className="block text-xs font-medium text-[#334155]">
                SKU
              </label>
              <input
                id="np-sku"
                type="text"
                required
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                placeholder="AGR-FERT-003"
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="np-barcode" className="block text-xs font-medium text-[#334155]">
                Product barcode
              </label>
              <input
                id="np-barcode"
                type="text"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setNewBarcode(e.currentTarget.value.trim());
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                pattern={'[\\x20-\\x7E]{3,32}'}
                aria-describedby="np-barcode-help"
                placeholder="Scan or enter barcode"
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
              <button
                type="button"
                onClick={generateBarcode}
                disabled={Boolean(newBarcode.trim())}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
              >
                <ScanBarcode className="h-4 w-4" /> Generate barcode
              </button>
              <p id="np-barcode-help" className="mt-1 text-xs text-slate-600">Focus the field to scan a supplier label. Generate a code for an unlabeled product.</p>
            </div>
            <div>
              <label htmlFor="np-cost" className="block text-xs font-medium text-[#334155]">
                Cost / kg (PHP)
              </label>
              <input
                id="np-cost"
                type="number"
                min="0"
                step="any"
                required
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="np-desc" className="block text-xs font-medium text-[#334155]">
              Description
            </label>
            <input
              id="np-desc"
              type="text"
              required
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Nitrogen-sulfur granular fertilizer for lowland rice paddies."
              className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="np-sfac" className="block text-xs font-medium text-[#334155]">
                Sack Weight (kg)
              </label>
              <input
                id="np-sfac"
                type="number"
                min="1"
                required
                value={newSackFactor}
                onChange={(e) => setNewSackFactor(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="np-sprice" className="block text-xs font-medium text-[#334155]">
                Sack Price (PHP)
              </label>
              <input
                id="np-sprice"
                type="number"
                min="1"
                required
                value={newSackPrice}
                onChange={(e) => setNewSackPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="np-kgprice" className="block text-xs font-medium text-[#334155]">
                Per kg Price (PHP)
              </label>
              <input
                id="np-kgprice"
                type="number"
                min="1"
                required
                value={newKgPrice}
                onChange={(e) => setNewKgPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="np-open" className="block text-xs font-medium text-[#334155]">
                Opening Stock (kg)
              </label>
              <input
                id="np-open"
                type="number"
                min="0"
                required
                value={newOpeningStock}
                onChange={(e) => setNewOpeningStock(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={createProductMutation.isPending}
            className="rounded-lg bg-[#15803D] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#166534] disabled:opacity-50"
          >
            {createProductMutation.isPending ? 'Creating Product...' : 'Create Product'}
          </button>
        </form>
      ) : null}

      {tab === 'import-export' && canEdit ? (
        <ProductImportExportPanel
          categories={metaQuery.data?.categories || []}
          allProducts={allProductsQuery.data || pagedProducts}
          onFeedback={setFeedback}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmConfig)}
        title={confirmConfig?.title || ''}
        description={confirmConfig?.description || ''}
        details={confirmConfig?.details || []}
        confirmLabel={confirmConfig?.confirmLabel}
        tone={confirmConfig?.tone || 'green'}
        isPending={
          receiptMutation.isPending || adjustMutation.isPending || createProductMutation.isPending
        }
        onCancel={() => setPendingTx(null)}
        onConfirm={() => confirmConfig?.onConfirm()}
      />
    </div>
  );
}
