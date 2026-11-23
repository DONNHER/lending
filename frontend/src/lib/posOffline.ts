import type { AuthSession, OfflineSyncEventPayload, Product } from '../types/domain';

interface DesktopPosSnapshot {
  catalog: Product[] | null;
  outbox: OfflineSyncEventPayload[];
}

interface DesktopPosBridge {
  snapshot: () => Promise<DesktopPosSnapshot>;
  saveCatalog: (products: Product[]) => Promise<void>;
  queueSale: (event: OfflineSyncEventPayload) => Promise<OfflineSyncEventPayload[]>;
  acknowledgeSales: (ids: string[]) => Promise<OfflineSyncEventPayload[]>;
}

declare global {
  interface Window {
    argivitDesktop?: DesktopPosBridge;
  }
}

const CATALOG_KEY = 'argivit_pos_catalog_v1';
const SESSION_KEY = 'argivit_pos_cashier_v1';
let desktopCatalog: Product[] | undefined;

export function getDesktopPosBridge(): DesktopPosBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.argivitDesktop;
}

export async function initializeDesktopPos(bridge: DesktopPosBridge): Promise<OfflineSyncEventPayload[]> {
  const snapshot = await bridge.snapshot();
  desktopCatalog = snapshot.catalog ?? undefined;
  return snapshot.outbox;
}

export function createPosSaleId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function loadPosCatalog(): Product[] | undefined {
  if (getDesktopPosBridge()) return desktopCatalog;
  try {
    const value = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? 'null');
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function savePosCatalog(products: Product[]): Promise<void> {
  const desktop = getDesktopPosBridge();
  if (desktop) {
    await desktop.saveCatalog(products);
    desktopCatalog = products;
    return;
  }
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(products));
  } catch {
    // The online register can still use the in-memory catalog.
  }
}

export function saveOfflineCashier(session: AuthSession | null): void {
  try {
    if (session?.user.role === 'cashier' && !session.impersonated_by) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Offline startup requires accessible browser storage.
  }
}

export function loadOfflineCashier(token: string): AuthSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as AuthSession | null;
    if (session?.token !== token || session.user.role !== 'cashier' || session.impersonated_by) return null;
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function isPosConnectionError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'TimeoutError');
}
