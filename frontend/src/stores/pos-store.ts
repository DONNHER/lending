import { create } from 'zustand';
import { roundCurrency } from '../lib/domainRules';
import type { Order, Sale } from '../types/domain';

export interface PosCartLine {
  product_id: string;
  product_name: string;
  sku: string;
  unit_id: string;
  unit_name: string;
  conversion_factor: number;
  unit_price: number;
  quantity: number;
}

interface PosState {
  cart: PosCartLine[];
  paymentMethod: 'cash' | 'gcash' | 'bank_transfer';
  scannedOrder: Order | null;
  lastReceipt: Sale | null;
  addToCart: (line: Omit<PosCartLine, 'quantity'>, qty?: number) => void;
  updateQty: (productId: string, unitId: string, quantity: number) => void;
  removeLine: (productId: string, unitId: string) => void;
  clearCart: () => void;
  setPaymentMethod: (method: 'cash' | 'gcash' | 'bank_transfer') => void;
  setScannedOrder: (order: Order | null) => void;
  setLastReceipt: (sale: Sale | null) => void;
  getTotal: () => number;
}

export const usePosStore = create<PosState>((set, get) => ({
  cart: [],
  paymentMethod: 'cash',
  scannedOrder: null,
  lastReceipt: null,

  addToCart: (line, qty = 1) =>
    set((state) => {
      const idx = state.cart.findIndex(
        (i) => i.product_id === line.product_id && i.unit_id === line.unit_id
      );
      if (idx >= 0) {
        const next = [...state.cart];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return { cart: next };
      }
      return { cart: [...state.cart, { ...line, quantity: qty }] };
    }),

  updateQty: (productId, unitId, quantity) =>
    set((state) => {
      if (quantity <= 0) {
        return {
          cart: state.cart.filter(
            (i) => !(i.product_id === productId && i.unit_id === unitId)
          ),
        };
      }
      return {
        cart: state.cart.map((i) =>
          i.product_id === productId && i.unit_id === unitId ? { ...i, quantity } : i
        ),
      };
    }),

  removeLine: (productId, unitId) =>
    set((state) => ({
      cart: state.cart.filter(
        (i) => !(i.product_id === productId && i.unit_id === unitId)
      ),
    })),

  clearCart: () => set({ cart: [] }),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setScannedOrder: (scannedOrder) => set({ scannedOrder }),
  setLastReceipt: (lastReceipt) => set({ lastReceipt }),
  getTotal: () =>
    roundCurrency(get().cart.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)),
}));
