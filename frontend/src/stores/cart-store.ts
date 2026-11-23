import { create } from 'zustand';
import { roundCurrency } from '../lib/domainRules';

export interface ShopCartLine {
  product_id: string;
  product_name: string;
  sku: string;
  image_url: string;
  unit_id: string;
  unit_name: string;
  conversion_factor: number;
  unit_price: number;
  quantity: number;
}

interface CartState {
  items: ShopCartLine[];
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  addItem: (line: Omit<ShopCartLine, 'quantity'>, qty?: number) => void;
  updateQty: (productId: string, unitId: string, quantity: number) => void;
  removeItem: (productId: string, unitId: string) => void;
  clearCart: () => void;
  getTotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  cartOpen: false,
  setCartOpen: (open) => set({ cartOpen: open }),
  addItem: (line, qty = 1) =>
    set((state) => {
      const idx = state.items.findIndex(
        (i) => i.product_id === line.product_id && i.unit_id === line.unit_id
      );
      if (idx >= 0) {
        const updated = [...state.items];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + qty };
        return { items: updated };
      }
      return { items: [...state.items, { ...line, quantity: qty }] };
    }),
  updateQty: (productId, unitId, quantity) =>
    set((state) => {
      if (quantity <= 0) {
        return {
          items: state.items.filter(
            (i) => !(i.product_id === productId && i.unit_id === unitId)
          ),
        };
      }
      return {
        items: state.items.map((i) =>
          i.product_id === productId && i.unit_id === unitId ? { ...i, quantity } : i
        ),
      };
    }),
  removeItem: (productId, unitId) =>
    set((state) => ({
      items: state.items.filter(
        (i) => !(i.product_id === productId && i.unit_id === unitId)
      ),
    })),
  clearCart: () => set({ items: [] }),
  getTotal: () =>
    roundCurrency(get().items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)),
}));
