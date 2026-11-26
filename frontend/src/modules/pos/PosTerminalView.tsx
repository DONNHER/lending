import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Minus,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
  Search,
  Sliders,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { useTranslate } from '../../lib/language';
import { convertToBaseUnit, roundCurrency, validateStockAvailability } from '../../lib/domainRules';
import { createPosSaleId, isPosConnectionError, loadPosCatalog, savePosCatalog } from '../../lib/posOffline';
import { fetchOnlinePosCatalog } from '../../lib/posCatalog';
import {
  classifyScannedCode,
  connectSerialBarcodeScanner,
  connectSerialThermalPrinter,
  connectUsbThermalPrinter,
  findLocalBarcodeMatch,
  isRapidScannerBurst,
  pickDefaultProductUnit,
  playScannerBeep,
  type ConnectedThermalPrinter,
} from '../../lib/posHardware';
import { formatDateTime, formatPHP, resolveProductImage } from '../../lib/productAssets';
import { useAppStore } from '../../stores/app-store';
import { usePosStore } from '../../stores/pos-store';
import type { OfflineSyncEventPayload, Order, Product, Sale } from '../../types/domain';
import {
  PosHardwareModal,
  type PosHardwareSettings,
} from '../../components/pos/PosHardwareModal';
import {
  ThermalReceipt80mmSheet,
  ThermalReceiptModal,
} from '../../components/pos/ThermalReceipt80mm';
import { ConfirmDialog, type ConfirmDetailRow } from '../../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';

const HARDWARE_STORAGE_KEY = 'argivit-pos-hardware-v1';

const DEFAULT_HARDWARE_SETTINGS: PosHardwareSettings = {
  hidWedgeArmed: true,
  scannerSound: true,
  serialBaudRate: 9600,
};

function loadHardwareSettings(): PosHardwareSettings {
  try {
    const raw = localStorage.getItem(HARDWARE_STORAGE_KEY);
    if (!raw) return DEFAULT_HARDWARE_SETTINGS;
    return { ...DEFAULT_HARDWARE_SETTINGS, ...(JSON.parse(raw) as Partial<PosHardwareSettings>) };
  } catch {
    return DEFAULT_HARDWARE_SETTINGS;
  }
}

type PendingPosConfirm =
  | { kind: 'checkout' }
  | { kind: 'fulfill'; order: Order }
  | { kind: 'return'; sale: Sale; reason: string };

interface PosTerminalViewProps {
  isSyncing: boolean;
  syncMessage: { tone: 'green' | 'amber' | 'red'; text: string } | null;
}

export function PosTerminalView({ isSyncing, syncMessage }: PosTerminalViewProps) {
  const queryClient = useQueryClient();
  const t = useTranslate();
  const {
    offlineMode,
    setOfflineMode,
    terminalId,
    offlineOutbox,
    enqueueOfflineEvent,
    session,
  } = useAppStore();

  const {
    cart,
    paymentMethod: selectedPaymentMethod,
    scannedOrder,
    lastReceipt,
    addToCart,
    updateQty,
    removeLine,
    clearCart,
    setPaymentMethod,
    setScannedOrder,
    setLastReceipt,
    getTotal,
  } = usePosStore();

  const paymentMethod = offlineMode ? 'cash' : selectedPaymentMethod;
  const cashierName = session?.user.name ?? 'POS Cashier';
  const selectedTab = useAppStore((s) => s.subTabs.pos);
  const tab = offlineMode ? 'register' : selectedTab;
  const setWorkspaceSubTab = useAppStore((s) => s.setWorkspaceSubTab);
  const setTab = (next: 'register' | 'sales') => setWorkspaceSubTab('pos', next);
  const [searchInput, setSearchInput] = useState('AGR');
  const [debouncedQuery, setDebouncedQuery] = useState('AGR');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null);
  const [returnReason, setReturnReason] = useState('Damaged packaging on delivery');
  const [returningSale, setReturningSale] = useState<Sale | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingPosConfirm | null>(null);

  // Wired 1D Barcode Scanner & 80mm Thermal Printer states
  const [hardwareSettings, setHardwareSettings] = useState<PosHardwareSettings>(loadHardwareSettings);
  const [hardwareModalOpen, setHardwareModalOpen] = useState(false);
  const [connectedPrinter, setConnectedPrinter] = useState<ConnectedThermalPrinter | null>(null);
  const [serialScannerHandle, setSerialScannerHandle] = useState<{ close: () => Promise<void> } | null>(null);
  const [isHardwareBusy, setIsHardwareBusy] = useState(false);
  const [previewReceiptSale, setPreviewReceiptSale] = useState<Sale | null>(null);
  const checkoutAttempt = useRef<{ cart: typeof cart; id: string } | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const hidBufferRef = useRef<{ chars: string; times: number[]; lastAt: number }>({
    chars: '',
    times: [],
    lastAt: 0,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 180);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Cached active catalog for instant 1D barcode resolution (online + offline POS mode)
  const catalogCacheQuery = useQuery({
    queryKey: ['pos-catalog-cache'],
    enabled: !offlineMode,
    initialData: loadPosCatalog,
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const products = await fetchOnlinePosCatalog(signal);
      await savePosCatalog(products);
      return products;
    },
  });

  const queuedStock = new Map<string, number>();
  for (const event of offlineOutbox) {
    if (event.terminal_id !== terminalId) continue;
    for (const item of event.payload.items) {
      queuedStock.set(item.product_id, (queuedStock.get(item.product_id) ?? 0) + item.quantity_base);
    }
  }
  const catalog = catalogCacheQuery.data ?? [];
  const offlineResults = offlineMode && debouncedQuery
    ? catalog.filter((p) => p.status === 'active' && (
        p.barcode === debouncedQuery || p.sku.toLowerCase().startsWith(debouncedQuery.toLowerCase()) ||
        p.name.toLowerCase().includes(debouncedQuery.toLowerCase())
      )).slice(0, 10)
    : [];

  // Indexed search endpoint: never loads entire catalog into UI list
  const searchQuery = useQuery({
    queryKey: ['pos-product-search', debouncedQuery],
    enabled: !offlineMode && debouncedQuery.length >= 1,
    queryFn: async () => {
      const res = await apiRequest<Product[]>(
        `/products/search?q=${encodeURIComponent(debouncedQuery)}&per_page=10`
      );
      return res.data;
    },
  });

  const salesQuery = useQuery({
    queryKey: ['pos-sales'],
    enabled: !offlineMode && tab === 'sales',
    queryFn: async () => (await apiRequest<Sale[]>('/pos/sales')).data,
  });

  const updateHardwareSettings = useCallback((patch: Partial<PosHardwareSettings>) => {
    setHardwareSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(HARDWARE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota issues
      }
      return next;
    });
  }, []);

  const checkoutMutation = useMutation({
    networkMode: 'always',
    mutationFn: async (event: OfflineSyncEventPayload) => {
      if (!offlineMode) {
        try {
          const response = await apiRequest<Sale>('/pos/checkout', {
            method: 'POST',
            signal: AbortSignal.timeout(6500),
            body: JSON.stringify({
              terminal_id: terminalId,
              client_sale_id: event.payload.sale_id,
              payment_method: event.payload.payment_method,
              items: event.payload.items.map(({ product_id, unit_id, quantity }) => ({ product_id, unit_id, quantity })),
            }),
          });
          return { sale: response.data, queued: false };
        } catch (error) {
          if (!isPosConnectionError(error) && !(error instanceof ApiError && [502, 503, 504].includes(error.status))) throw error;
          setOfflineMode(true);
          if (event.payload.payment_method !== 'cash') throw new Error(t('Server unavailable. Reconnect to finish this non-cash transaction.'));
        }
      }

      const requested = new Map(queuedStock);
      for (const item of event.payload.items) {
        const product = catalog.find((p) => p.id === item.product_id && p.status === 'active');
        const quantity = (requested.get(item.product_id) ?? 0) + item.quantity_base;
        if (!product || !validateStockAvailability(quantity, product.stock_base).ok) {
          throw new Error(t('There isn’t enough stock in the saved catalog for {product}.', { product: item.product_name }));
        }
        requested.set(item.product_id, quantity);
      }
      try {
        await enqueueOfflineEvent(event);
      } catch {
        throw new Error(t('The register could not save the sale. The cart is still open.'));
      }
      const saleId = event.payload.sale_id;
      const sale: Sale = {
        id: saleId,
        sale_number: `SALE-${saleId.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
        cashier_id: event.cashier_id ?? '',
        cashier_name: cashierName,
        terminal_id: terminalId,
        total: event.payload.total,
        payment_method: 'cash',
        status: 'completed',
        source: 'offline_sync',
        created_at: event.occurred_at,
        items: event.payload.items.map((item, index) => ({ ...item, id: `loc-${index}`, sale_id: saleId })),
      };
      return { sale, queued: true };
    },
    onSuccess: ({ sale, queued }) => {
      checkoutAttempt.current = null;
      setPendingConfirm(null);
      clearCart();
      setLastReceipt(sale);
      if (sale.payment_method === 'cash') setPreviewReceiptSale(sale);
      if (queued) {
        setFeedback({ tone: 'amber', text: t('Cash sale saved on this computer. It will sync when the server is reachable.') });
      } else {
        setFeedback({ tone: 'green', text: t('Sale {sale} completed.', { sale: sale.sale_number }) });
        for (const key of ['pos-product-search', 'pos-catalog-cache', 'pos-sales', 'reports-overview']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({
        tone: 'red',
        text: err instanceof Error ? err.message : t('Checkout failed.'),
      });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (token: string) => {
      const res = await apiRequest<Order>(`/pos/orders/scan/${encodeURIComponent(token.trim())}`);
      return res.data;
    },
    onSuccess: (order) => {
      setScannedOrder(order);
      setFeedback({
        tone: 'green',
        text: t('Loaded pre-order {order} ({member}).', { order: order.order_number, member: order.shareholder_name ?? '' }),
      });
    },
    onError: (err) => {
      setScannedOrder(null);
      setFeedback({
        tone: 'red',
        text: err instanceof ApiError ? err.message : t('Unable to find pre-order token.'),
      });
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest<Sale>(`/pos/orders/${orderId}/fulfill`, {
        method: 'POST',
        body: JSON.stringify({ terminal_id: terminalId, payment_method: paymentMethod }),
      });
      return res.data;
    },
    onSuccess: (sale) => {
      setPendingConfirm(null);
      setScannedOrder(null);
      setTokenInput('');
      setLastReceipt(sale);
      setPreviewReceiptSale(sale);
      setFeedback({ tone: 'green', text: t('Pre-order fulfilled as POS sale {sale}.', { sale: sale.sale_number }) });
      queryClient.invalidateQueries({ queryKey: ['pos-product-search'] });
      queryClient.invalidateQueries({ queryKey: ['pos-catalog-cache'] });
      queryClient.invalidateQueries({ queryKey: ['pos-sales'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({
        tone: 'red',
        text: err instanceof ApiError ? err.message : t('Unable to fulfill pre-order.'),
      });
    },
  });

  const returnMutation = useMutation({
    mutationFn: async (sale: Sale) => {
      const res = await apiRequest<{ id: string; refund_total: number }>('/pos/returns', {
        method: 'POST',
        body: JSON.stringify({
          sale_id: sale.id,
          reason: returnReason,
          items: sale.items.map((i) => ({ sale_item_id: i.id, quantity: i.quantity })),
        }),
      });
      return res.data;
    },
    onSuccess: (res) => {
      setPendingConfirm(null);
      setReturningSale(null);
      setFeedback({
        tone: 'green',
        text: t('Return processed ({total} refunded and stock restored).', { total: formatPHP(res.refund_total) }),
      });
      queryClient.invalidateQueries({ queryKey: ['pos-sales'] });
      queryClient.invalidateQueries({ queryKey: ['pos-product-search'] });
      queryClient.invalidateQueries({ queryKey: ['pos-catalog-cache'] });
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({
        tone: 'red',
        text: err instanceof ApiError ? err.message : t('Return failed.'),
      });
    },
  });

  function handleCheckout() {
    if (cart.length === 0 || !session || checkoutMutation.isPending) return;
    const items = cart.map((line) => ({
      ...line,
      quantity_base: convertToBaseUnit(line.quantity, line.conversion_factor),
      line_total: roundCurrency(line.quantity * line.unit_price),
    }));
    if (items.some((item) => item.quantity_base <= 0)) {
      setPendingConfirm(null);
      setFeedback({ tone: 'red', text: t('Each item must have a positive quantity at the supported precision.') });
      return;
    }
    const saleId = checkoutAttempt.current?.cart === cart ? checkoutAttempt.current.id : createPosSaleId();
    checkoutAttempt.current = { cart, id: saleId };
    setFeedback(null);
    checkoutMutation.mutate({
      event_id: saleId,
      event_type: 'pos.sale.completed',
      terminal_id: terminalId,
      cashier_id: session.user.id,
      occurred_at: new Date().toISOString(),
      payload: {
        sale_id: saleId,
        payment_method: paymentMethod,
        items,
        total: roundCurrency(items.reduce((sum, item) => sum + item.line_total, 0)),
      },
    });
  }

  function handleConfirmAction() {
    if (!pendingConfirm) return;
    switch (pendingConfirm.kind) {
      case 'checkout':
        handleCheckout();
        break;
      case 'fulfill':
        if (offlineMode) {
          setPendingConfirm(null);
          setFeedback({ tone: 'amber', text: t('Reconnect to fulfill pre-orders.') });
          break;
        }
        fulfillMutation.mutate(pendingConfirm.order.id);
        break;
      case 'return':
        if (offlineMode) {
          setPendingConfirm(null);
          setFeedback({ tone: 'amber', text: t('Reconnect to process returns.') });
          break;
        }
        returnMutation.mutate(pendingConfirm.sale);
        break;
    }
  }

  const posConfirmConfig: {
    title: string;
    description: string;
    details: ConfirmDetailRow[];
    confirmLabel: string;
    tone: 'green' | 'amber' | 'red';
  } | null = pendingConfirm
    ? (() => {
        switch (pendingConfirm.kind) {
          case 'checkout':
            return {
              title: offlineMode ? t('Confirm Offline Cash Sale') : t('Confirm POS Checkout Sale'),
              description: offlineMode
                ? t('Save this transaction to the local offline outbox queue for later synchronization.')
                : t('Complete this sale, record payment, and deduct stock from central warehouse balances.'),
              details: [
                { label: t('Line Items'), value: t('{count} line(s)', { count: cart.length }) },
                { label: t('Payment Method'), value: t(paymentMethod === 'bank_transfer' ? 'bank transfer' : paymentMethod).toUpperCase() },
                { label: t('Total Due'), value: formatPHP(getTotal()) },
              ],
              confirmLabel: offlineMode ? t('Save Offline Sale') : t('Complete Sale'),
              tone: offlineMode ? 'amber' : 'green',
            };
          case 'fulfill':
            return {
              title: t('Confirm Pre-Order Fulfillment'),
              description:
                t('Convert this confirmed shareholder pre-order into a completed POS sale and deduct stock.'),
              details: [
                { label: t('Order Number'), value: pendingConfirm.order.order_number },
                { label: t('Token'), value: pendingConfirm.order.token_code },
                { label: t('Payment Method'), value: t(paymentMethod === 'bank_transfer' ? 'bank transfer' : paymentMethod).toUpperCase() },
                { label: t('Total'), value: formatPHP(pendingConfirm.order.total) },
              ],
              confirmLabel: t('Fulfill & Deduct Stock'),
              tone: 'green',
            };
          case 'return':
            return {
              title: t('Confirm Sale Return & Refund'),
              description:
                t('Refund this sale and restore the sold base-unit quantities back into inventory.'),
              details: [
                { label: t('Sale Number'), value: pendingConfirm.sale.sale_number },
                { label: t('Refund Total'), value: formatPHP(pendingConfirm.sale.total) },
                { label: t('Reason'), value: pendingConfirm.reason },
              ],
              confirmLabel: t('Confirm Refund'),
              tone: 'red',
            };
        }
      })()
    : null;

  const processScannedBarcode = useCallback(
    async (rawCode: string) => {
      const classified = classifyScannedCode(rawCode);
      if (!classified) return;

      if (classified.kind === 'order_token') {
        setTokenInput(classified.normalized);
        if (hardwareSettings.scannerSound) playScannerBeep(true);
        if (offlineMode) {
          setFeedback({ tone: 'amber', text: t('Reconnect to look up pre-orders.') });
          return;
        }
        scanMutation.mutate(classified.normalized);
        return;
      }

      const code = classified.normalized;
      const localPool = catalogCacheQuery.data ?? [];
      let matched = findLocalBarcodeMatch(localPool, code);

      if (!matched && !offlineMode) {
        try {
          const res = await apiRequest<Product[]>(
            `/products/search?q=${encodeURIComponent(code)}&per_page=5`
          );
          matched = findLocalBarcodeMatch(res.data, code);
        } catch {
          matched = null;
        }
      }

      if (!matched) {
        if (hardwareSettings.scannerSound) playScannerBeep(false);
        setFeedback({
          tone: 'red',
          text: t('No active product matched scanned 1D barcode "{code}".', { code }),
        });
        return;
      }

      const unit = pickDefaultProductUnit(matched);
      if (!unit) {
        if (hardwareSettings.scannerSound) playScannerBeep(false);
        setFeedback({
          tone: 'red',
          text: t('{product} has no selling unit configured.', { product: matched.name }),
        });
        return;
      }

      addToCart({
        product_id: matched.id,
        product_name: matched.name,
        sku: matched.sku,
        unit_id: unit.id,
        unit_name: unit.unit_name,
        conversion_factor: unit.conversion_factor,
        unit_price: unit.selling_price,
      });
      if (hardwareSettings.scannerSound) playScannerBeep(true);
      setFeedback({
        tone: 'green',
        text: t('1D Scan: Added 1 × {unit} {product} ({code}).', { unit: unit.unit_name, product: matched.name, code: matched.barcode || matched.sku }),
      });
    },
    [
      addToCart,
      catalogCacheQuery.data,
      hardwareSettings.scannerSound,
      offlineMode,
      t,
      scanMutation,
    ]
  );

  // Global USB HID Keyboard Wedge listener for wired 1D barcode scanners
  useEffect(() => {
    if (tab !== 'register' || !hardwareSettings.hidWedgeArmed) return;

    function onWindowKeyDown(e: KeyboardEvent) {
      if (pendingConfirm || hardwareModalOpen || previewReceiptSale) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isFocusedBarcodeBox = target === barcodeInputRef.current;
      if (isFocusedBarcodeBox) return;

      const isEditable =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (isEditable) return;

      const now = performance.now();
      if (now - hidBufferRef.current.lastAt > 90) {
        hidBufferRef.current = { chars: '', times: [], lastAt: now };
      }

      if (e.key === 'Enter') {
        const buf = hidBufferRef.current;
        if (buf.chars.length >= 4 && isRapidScannerBurst(buf.times)) {
          e.preventDefault();
          const scanned = buf.chars;
          hidBufferRef.current = { chars: '', times: [], lastAt: 0 };
          void processScannedBarcode(scanned);
        } else {
          hidBufferRef.current = { chars: '', times: [], lastAt: 0 };
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        hidBufferRef.current.chars += e.key;
        hidBufferRef.current.times.push(now);
        hidBufferRef.current.lastAt = now;
      }
    }

    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [
    hardwareModalOpen,
    hardwareSettings.hidWedgeArmed,
    pendingConfirm,
    previewReceiptSale,
    processScannedBarcode,
    tab,
  ]);

  useEffect(() => {
    return () => {
      if (serialScannerHandle) {
        void serialScannerHandle.close();
      }
    };
  }, [serialScannerHandle]);

  function handleBarcodeFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    const code = barcodeInput;
    setBarcodeInput('');
    void processScannedBarcode(code);
    barcodeInputRef.current?.focus();
  }

  function handleScanSubmit(e: FormEvent) {
    e.preventDefault();
    if (offlineMode) {
      setFeedback({ tone: 'amber', text: t('Reconnect to look up pre-orders.') });
      return;
    }
    if (!tokenInput.trim()) return;
    scanMutation.mutate(tokenInput);
  }

  async function handleConnectUsbPrinter() {
    setIsHardwareBusy(true);
    try {
      const printer = await connectUsbThermalPrinter();
      setConnectedPrinter(printer);
      setFeedback({ tone: 'green', text: `Paired ${printer.label} for direct 80mm ESC/POS printing.` });
    } catch (err) {
      setFeedback({
        tone: 'red',
        text: err instanceof Error ? err.message : 'Unable to pair USB 80mm printer.',
      });
    } finally {
      setIsHardwareBusy(false);
    }
  }

  async function handleConnectSerialPrinter() {
    setIsHardwareBusy(true);
    try {
      const printer = await connectSerialThermalPrinter(hardwareSettings.serialBaudRate);
      setConnectedPrinter(printer);
      setFeedback({ tone: 'green', text: `Paired ${printer.label} for direct 80mm ESC/POS printing.` });
    } catch (err) {
      setFeedback({
        tone: 'red',
        text: err instanceof Error ? err.message : 'Unable to pair Serial 80mm printer.',
      });
    } finally {
      setIsHardwareBusy(false);
    }
  }

  async function handleConnectSerialScanner() {
    setIsHardwareBusy(true);
    try {
      const handle = await connectSerialBarcodeScanner(
        (code) => {
          void processScannedBarcode(code);
        },
        () => {
          setSerialScannerHandle(null);
        }
      );
      setSerialScannerHandle(handle);
      setFeedback({ tone: 'green', text: 'Serial 1D barcode scanner connected.' });
    } catch (err) {
      setFeedback({
        tone: 'red',
        text: err instanceof Error ? err.message : 'Unable to connect serial scanner.',
      });
    } finally {
      setIsHardwareBusy(false);
    }
  }

  function handlePreviewReceipt() {
    const sampleSale: Sale = lastReceipt || {
      id: 'test-80mm',
      sale_number: 'TEST-80MM-0001',
      cashier_id: 'test',
      cashier_name: cashierName,
      terminal_id: terminalId,
      total: 1250,
      payment_method: 'cash',
      status: 'completed',
      source: 'online_pos',
      created_at: new Date().toISOString(),
      items: [
        {
          id: 'test-item-1',
          sale_id: 'test-80mm',
          product_id: 'prod-1',
          product_name: 'Complete Fertilizer NPK 14-14-14',
          sku: 'AGR-FERT-001',
          quantity: 1,
          unit_id: 'u-1',
          unit_name: 'sack (50 kg)',
          conversion_factor: 50,
          quantity_base: 50,
          unit_price: 1250,
          line_total: 1250,
        },
      ],
    };
    setHardwareModalOpen(false);
    setPreviewReceiptSale(sampleSale);
  }

  return (
    <div className="space-y-5">
      {/* POS Top Utility Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8E4] bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('register')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === 'register'
                ? 'bg-[#15803D] text-white'
                : 'bg-[#F7F9F8] text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            {t('Checkout Register')}
          </button>
          <button
            type="button"
            onClick={() => setTab('sales')}
            disabled={offlineMode}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === 'sales'
                ? 'bg-[#15803D] text-white'
                : 'bg-[#F7F9F8] text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            {t('Sales & Returns')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-xs text-[#475569]">{terminalId}</span>

          <button
            type="button"
            onClick={() => setHardwareModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] transition-colors hover:border-[#15803D] hover:text-[#15803D] whitespace-nowrap"
          >
            <ScanBarcode className="h-3.5 w-3.5 text-[#15803D]" />
            <span>{t('1D Scanner & 80mm Printer')}</span>
          </button>

          <span
            role="status"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              offlineMode ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {offlineMode ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
            {t(offlineMode ? 'Offline · Cash only' : 'Online')}
          </span>
          {offlineOutbox.length > 0 && (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              {isSyncing && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {offlineOutbox.length} {t(isSyncing ? 'syncing' : 'pending sync')}
            </span>
          )}
        </div>
      </div>

      {syncMessage && (
        <p role="status" className={`rounded-lg border px-4 py-2 text-sm ${
          syncMessage.tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' :
          syncMessage.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900'
        }`}>{syncMessage.text}</p>
      )}
      {offlineMode && !catalogCacheQuery.data && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {t('Connect once to download the product catalog before taking offline sales.')}
        </p>
      )}
      {feedback ? (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'green'
              ? 'border-emerald-200 bg-emerald-50 text-[#14532D]'
              : feedback.tone === 'amber'
              ? 'border-amber-200 bg-amber-50 text-[#92400E]'
              : 'border-red-200 bg-red-50 text-[#991B1B]'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-medium underline whitespace-nowrap"
          >
            {t('Dismiss')}
          </button>
        </div>
      ) : null}

      {tab === 'register' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_316px]">
          {/* Left Column: Indexed Product Search + Pre-Order Token Scanner */}
          <div className="min-w-0 space-y-5">
            {/* Wired 1D Barcode Scanner Input Card */}
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ScanBarcode className="h-4 w-4 text-[#15803D]" />
                  <div>
                    <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                      {t('Wired 1D Barcode Scanner')}
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      {t('Scan 1D product barcode (e.g. 480001001001) or pickup token (ARG-ORD-...) to auto-add to cart')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateHardwareSettings({ hidWedgeArmed: !hardwareSettings.hidWedgeArmed })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                    hardwareSettings.hidWedgeArmed
                      ? 'border-emerald-200 bg-emerald-50 text-[#15803D]'
                      : 'border-[#CBD5E1] bg-[#F7F9F8] text-[#475569]'
                  }`}
                >
                  <Sliders className="h-3 w-3" />
                  {t(hardwareSettings.hidWedgeArmed ? 'USB HID Wedge: Armed' : 'Input Focus Only')}
                </button>
              </div>

              <form onSubmit={handleBarcodeFormSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <ScanBarcode className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#64748B]" />
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    aria-label={t('Wired 1D barcode scanner input')}
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder={t('Focus here or pull wired 1D scanner trigger (480001001001)...')}
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white py-2 pl-9 pr-3 font-mono text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-[#15803D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534] whitespace-nowrap shrink-0"
                >
                  {t('Scan / Add')}
                </button>
              </form>
            </div>

            {/* Indexed Search Card */}
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-[#0F172A]">
                    {t('Product & Barcode Search')}
                  </h2>
                  <p className="text-xs text-[#64748B]">
                    {t('Indexed lookup by SKU prefix, exact barcode, or product name (max 10 results)')}
                  </p>
                </div>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-[#64748B]" />
                <input
                  type="search"
                  aria-label={t('Search POS products by name, SKU, or barcode')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('Search SKU (AGR-FERT), barcode (480001001001), or product name...')}
                  className="w-full rounded-lg border border-[#CBD5E1] bg-white py-2 pl-10 pr-4 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                />
              </div>

              {/* 4 Standard UI States: Empty query, Loading, Error, Empty results, Success */}
              {debouncedQuery.length === 0 ? (
                <EmptyState
                  title={t('Start typing to search catalog')}
                  description={t('Enter at least 1 character of a product name, SKU prefix, or scan a barcode.')}
                />
              ) : !offlineMode && searchQuery.isLoading ? (
                <LoadingSkeleton rows={3} />
              ) : !offlineMode && searchQuery.isError ? (
                <ErrorState
                  message={(searchQuery.error as Error).message}
                  onRetry={() => searchQuery.refetch()}
                />
              ) : (offlineMode ? offlineResults : searchQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title={t('No matching products')}
                  description={t('No active inventory items matched "{query}". Try searching "AGR", "Fertilizer", or "Seeds".', { query: debouncedQuery })}
                />
              ) : (
                <div className="grid max-h-[640px] grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-2.5 overflow-y-auto pr-0.5">
                  {(offlineMode ? offlineResults : searchQuery.data ?? []).map((product) => (
                    <div
                      key={product.id}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8E4] bg-white p-3 transition-colors hover:border-[#CBD5E1]"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <div className="h-16 w-10 shrink-0 overflow-hidden rounded-md border border-[#E2E8E4] bg-[#EEF3F0]">
                          <img
                            src={resolveProductImage(product.image_url)}
                            alt={product.name}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-xs font-semibold leading-snug text-[#0F172A]">
                            {product.name}
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-[#64748B]">
                            {product.sku}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] font-medium text-[#334155] tabular-nums">
                            {Math.max(0, product.stock_base - (offlineMode ? queuedStock.get(product.id) ?? 0 : 0)).toLocaleString()} {product.base_unit}
                          </div>
                          {product.barcode ? (
                            <div className="truncate font-mono text-[10px] text-[#94A3B8]">
                              {product.barcode}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 border-t border-[#F1F5F9] pt-2">
                        {product.units.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              addToCart({
                                product_id: product.id,
                                product_name: product.name,
                                sku: product.sku,
                                unit_id: u.id,
                                unit_name: u.unit_name,
                                conversion_factor: u.conversion_factor,
                                unit_price: u.selling_price,
                              })
                            }
                            className="inline-flex w-full items-center justify-between gap-1 rounded-md border border-[#CBD5E1] bg-[#F7F9F8] px-2 py-1.5 text-[11px] font-medium text-[#0F172A] hover:border-[#15803D] hover:bg-[#F0FDF4] whitespace-nowrap"
                          >
                            <span className="inline-flex min-w-0 items-center gap-1 truncate">
                              <Plus className="h-3 w-3 shrink-0 text-[#15803D]" />
                              <span className="truncate">{u.unit_name}</span>
                            </span>
                            <span className="shrink-0 font-mono font-semibold text-[#15803D] tabular-nums">
                              {formatPHP(u.selling_price)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pre-Order Token Scanner */}
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A]">
                  {t('Online Pre-Order Token Fulfillment')}
                </h2>
                <p className="text-xs text-[#64748B]">
                  {t('Scan or enter a shareholder pickup token (e.g. ARG-ORD-8821) to convert an online pre-order into a POS sale')}
                </p>
              </div>

              <form onSubmit={handleScanSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <QrCode className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#64748B]" />
                  <input
                    type="text"
                    aria-label={t('Pre-order fulfillment token')}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={t('Enter token code (e.g. ARG-ORD-8821)')}
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white py-2 pl-9 pr-3 font-mono text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                  />
                </div>
                <button
                  type="submit"
                  disabled={scanMutation.isPending}
                  className="rounded-lg border border-[#15803D] bg-white px-4 py-2 text-xs font-medium text-[#15803D] hover:bg-[#F0FDF4] whitespace-nowrap shrink-0"
                >
                  {scanMutation.isPending ? t('Checking...') : t('Retrieve Order')}
                </button>
              </form>

              {scannedOrder ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-semibold text-[#0F172A]">
                        {scannedOrder.order_number} · {scannedOrder.token_code}
                      </div>
                      <div className="text-xs text-[#475569]">
                        {t('Shareholder')}: {scannedOrder.shareholder_name} ({scannedOrder.membership_number})
                      </div>
                    </div>
                    <div className="font-mono text-base font-bold text-[#15803D] tabular-nums">
                      {formatPHP(scannedOrder.total)}
                    </div>
                  </div>
                  <div className="divide-y divide-emerald-200/70 border-t border-emerald-200 pt-2 text-xs">
                    {scannedOrder.items.map((item) => (
                      <div key={item.id} className="flex justify-between py-1.5">
                        <span>
                          {item.product_name} · {item.quantity} × {item.unit_name}
                        </span>
                        <span className="font-mono tabular-nums">{formatPHP(item.line_total)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setScannedOrder(null)}
                      className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155]"
                    >
                      {t('Clear')}
                    </button>
                    <button
                      type="button"
                      disabled={fulfillMutation.isPending}
                      onClick={() => setPendingConfirm({ kind: 'fulfill', order: scannedOrder })}
                      className="rounded-lg bg-[#15803D] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#166534]"
                    >
                      {fulfillMutation.isPending ? t('Fulfilling...') : t('Fulfill & Deduct Stock')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right Column: POS Checkout Cart & Receipt */}
          <div className="space-y-5">
            <div className="rounded-xl border border-[#E2E8E4] bg-white p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#E2E8E4] pb-3">
                <h2 className="font-display text-base font-semibold text-[#0F172A]">
                  {t('Current Transaction')}
                </h2>
                {cart.length > 0 ? (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="text-xs font-medium text-[#DC2626] hover:underline"
                  >
                    {t('Clear Cart')}
                  </button>
                ) : null}
              </div>

              {cart.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#64748B]">
                  {t('Select a product unit on the left to begin checkout.')}
                </p>
              ) : (
                <div className="divide-y divide-[#E2E8E4]">
                  {cart.map((line) => (
                    <div key={`${line.product_id}-${line.unit_id}`} className="py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#0F172A]">{line.product_name}</div>
                          <div className="font-mono text-xs text-[#64748B]">
                            {line.unit_name} · {line.conversion_factor} kg/unit ·{' '}
                            {formatPHP(line.unit_price)}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={t('Remove {product}', { product: line.product_name })}
                          onClick={() => removeLine(line.product_id, line.unit_id)}
                          className="rounded p-1 text-[#64748B] hover:bg-red-50 hover:text-[#DC2626]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="inline-flex items-center rounded-lg border border-[#CBD5E1]">
                          <button
                            type="button"
                            aria-label={t('Decrease quantity for {product}', { product: line.product_name })}
                            onClick={() => updateQty(line.product_id, line.unit_id, line.quantity - 1)}
                            className="px-2.5 py-1 text-[#334155] hover:bg-[#F7F9F8]"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="px-3 font-mono text-xs font-semibold tabular-nums">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={t('Increase quantity for {product}', { product: line.product_name })}
                            onClick={() => updateQty(line.product_id, line.unit_id, line.quantity + 1)}
                            className="px-2.5 py-1 text-[#334155] hover:bg-[#F7F9F8]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="text-right">
                          <div className="font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                            {formatPHP(line.quantity * line.unit_price)}
                          </div>
                          <div className="font-mono text-[11px] text-[#64748B] tabular-nums">
                            -{convertToBaseUnit(line.quantity, line.conversion_factor)} kg base
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-[#E2E8E4] pt-4 space-y-4">
                <div>
                  <span className="block text-xs font-medium text-[#475569] mb-1.5">
                    {t('Payment Method')}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['cash', 'gcash', 'bank_transfer'] as const).map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        disabled={offlineMode && method !== 'cash'}
                        className={`rounded-lg border px-1.5 py-2 text-xs font-medium capitalize transition-colors whitespace-nowrap disabled:opacity-40 ${
                          paymentMethod === method
                            ? 'border-[#15803D] bg-[#F0FDF4] text-[#15803D]'
                            : 'border-[#E2E8E4] bg-white text-[#475569] hover:bg-[#F7F9F8]'
                        }`}
                      >
                        {t(method === 'bank_transfer' ? 'bank transfer' : method)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-[#475569]">{t('Total Due')}</span>
                  <span className="font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                    {formatPHP(getTotal())}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={cart.length === 0 || checkoutMutation.isPending}
                  onClick={() => setPendingConfirm({ kind: 'checkout' })}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#15803D] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#166534] disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    {checkoutMutation.isPending
                      ? t('Posting Transaction...')
                      : offlineMode
                      ? t('Save Cash Sale')
                      : t('Complete Sale')}
                  </span>
                </button>
              </div>
            </div>

            {lastReceipt ? (
              <div className="rounded-xl border border-[#E2E8E4] bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-display text-sm font-semibold text-[#0F172A]">
                    <Receipt className="h-4 w-4 text-[#15803D]" />
                    <span>{t('80mm Thermal Receipt')}</span>
                  </div>
                  <StatusLabel
                    tone={lastReceipt.source === 'offline_sync' ? 'amber' : 'green'}
                    label={lastReceipt.source === 'offline_sync' ? t('Offline Receipt') : t('Posted')}
                  />
                </div>

                <div className="overflow-x-auto rounded-lg bg-[#F7F9F8] p-2">
                  <ThermalReceipt80mmSheet sale={lastReceipt} cashierName={cashierName} />
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setPreviewReceiptSale(lastReceipt)}
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                  >
                    {t('Preview Receipt')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        /* Sales & Returns History Tab */
        <div className="rounded-xl border border-[#E2E8E4] bg-white">
          <div className="border-b border-[#E2E8E4] px-5 py-4">
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              {t('POS Sales & Returns Ledger')}
            </h2>
            <p className="text-xs text-[#64748B]">
              {t('Process returns to refund customers and restore base-unit inventory balances')}
            </p>
          </div>

          {salesQuery.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={4} />
            </div>
          ) : salesQuery.isError ? (
            <div className="p-5">
              <ErrorState
                message={(salesQuery.error as Error).message}
                onRetry={() => salesQuery.refetch()}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-xs font-medium text-[#475569]">
                  <tr>
                    <th className="px-5 py-3">{t('Sale #')}</th>
                    <th className="px-5 py-3">{t('Source')}</th>
                    <th className="px-5 py-3">{t('Items')}</th>
                    <th className="px-5 py-3">{t('Status')}</th>
                    <th className="px-5 py-3 text-right">{t('Total')}</th>
                    <th className="px-5 py-3 text-right">{t('Date')}</th>
                    <th className="px-5 py-3 text-right">{t('Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E4]">
                  {(salesQuery.data || []).map((sale) => (
                    <tr key={sale.id} className="hover:bg-[#F7F9F8]/60">
                      <td className="px-5 py-3 font-mono text-xs font-semibold text-[#0F172A]">
                        {sale.sale_number}
                      </td>
                      <td className="px-5 py-3 text-xs text-[#475569] capitalize">
                        {sale.source.replace('_', ' ')}
                      </td>
                      <td className="px-5 py-3 text-xs text-[#475569]">
                        {sale.items
                          .map((i) => `${i.quantity}× ${i.unit_name} ${i.product_name}`)
                          .join(', ')}
                      </td>
                      <td className="px-5 py-3">
                        <StatusLabel
                          tone={sale.status === 'completed' ? 'green' : 'amber'}
                          label={t(sale.status)}
                        />
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                        {formatPHP(sale.total)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-[#64748B] tabular-nums">
                        {formatDateTime(sale.created_at)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewReceiptSale(sale)}
                            className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D]"
                          >
                            <Receipt className="h-3 w-3" />
                            {t('80mm Receipt')}
                          </button>
                          {sale.status === 'completed' ? (
                            <button
                              type="button"
                              onClick={() => setReturningSale(sale)}
                              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2.5 py-1 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8]"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {t('Return')}
                            </button>
                          ) : (
                            <span className="text-xs text-[#94A3B8]">{t('Returned')}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {returningSale ? (
            <div className="border-t border-[#E2E8E4] bg-[#F7F9F8] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                  {t('Confirm Return for {sale} ({total})', { sale: returningSale.sale_number, total: formatPHP(returningSale.total) })}
                </h3>
                <button
                  type="button"
                  onClick={() => setReturningSale(null)}
                  className="text-xs text-[#64748B] hover:text-[#0F172A]"
                >
                  {t('Cancel')}
                </button>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder={t('Reason for return')}
                  className="flex-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={returnMutation.isPending}
                  onClick={() =>
                    setPendingConfirm({ kind: 'return', sale: returningSale, reason: returnReason })
                  }
                  className="rounded-lg bg-[#DC2626] px-4 py-2 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap"
                >
                  {returnMutation.isPending ? t('Processing...') : t('Confirm Refund & Restore Stock')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(posConfirmConfig)}
        title={posConfirmConfig?.title || ''}
        description={posConfirmConfig?.description || ''}
        details={posConfirmConfig?.details || []}
        confirmLabel={posConfirmConfig?.confirmLabel}
        cancelLabel={t('Cancel')}
        tone={posConfirmConfig?.tone}
        isPending={
          checkoutMutation.isPending ||
          fulfillMutation.isPending ||
          returnMutation.isPending
        }
        onConfirm={handleConfirmAction}
        onCancel={() => setPendingConfirm(null)}
      />

      <PosHardwareModal
        open={hardwareModalOpen}
        settings={hardwareSettings}
        connectedPrinter={connectedPrinter}
        serialScannerConnected={Boolean(serialScannerHandle)}
        isBusy={isHardwareBusy}
        onUpdateSettings={updateHardwareSettings}
        onConnectUsbPrinter={handleConnectUsbPrinter}
        onConnectSerialPrinter={handleConnectSerialPrinter}
        onDisconnectPrinter={() => setConnectedPrinter(null)}
        onConnectSerialScanner={handleConnectSerialScanner}
        onDisconnectSerialScanner={() => {
          void serialScannerHandle?.close();
          setSerialScannerHandle(null);
        }}
        onPreviewReceipt={handlePreviewReceipt}
        onClose={() => setHardwareModalOpen(false)}
      />

      <ThermalReceiptModal
        sale={previewReceiptSale}
        cashierName={cashierName}
        onClose={() => setPreviewReceiptSale(null)}
      />
    </div>
  );
}
