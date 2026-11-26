import { create } from 'zustand';
import { setStoredToken } from '../lib/api';
import { getDesktopPosBridge, saveOfflineCashier } from '../lib/posOffline';
import type { AuthSession, OfflineSyncEventPayload, UserRole } from '../types/domain';

export type WorkspaceId =
  | 'dashboard'
  | 'pos'
  | 'shop'
  | 'orders'
  | 'inventory'
  | 'shareholders'
  | 'loans'
  | 'reports'
  | 'settings'
  | 'profile';

export function getDefaultWorkspaceForRole(role: UserRole): WorkspaceId {
  switch (role) {
    case 'cashier':
      return 'pos';
    case 'shareholder':
      return 'shop';
    case 'manager':
    case 'admin':
    default:
      return 'dashboard';
  }
}

export function canAccessWorkspace(role: UserRole, workspace: WorkspaceId): boolean {
  const matrix: Record<UserRole, WorkspaceId[]> = {
    admin: ['dashboard', 'pos', 'shop', 'orders', 'inventory', 'shareholders', 'loans', 'reports', 'settings', 'profile'],
    manager: ['dashboard', 'pos', 'orders', 'inventory', 'shareholders', 'loans', 'reports', 'settings', 'profile'],
    cashier: ['pos', 'orders', 'inventory', 'profile'],
    shareholder: ['shop', 'orders', 'shareholders', 'loans', 'profile'],
  };
  return matrix[role].includes(workspace);
}

const OUTBOX_KEY = 'argivit_pos_offline_outbox_v1';

function readOutbox(): OfflineSyncEventPayload[] {
  const value = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
  if (!Array.isArray(value)) throw new Error('The saved sales queue is unreadable.');
  return value as OfflineSyncEventPayload[];
}

function loadOutbox(): OfflineSyncEventPayload[] {
  try {
    return readOutbox();
  } catch {
    return [];
  }
}

async function updateOutbox(
  update: (events: OfflineSyncEventPayload[]) => OfflineSyncEventPayload[],
  publish: (events: OfflineSyncEventPayload[]) => void,
): Promise<void> {
  const commit = () => {
    // Read under the lock so another tab's newly saved sales stay in the queue.
    const next = update(readOutbox());
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
    publish(next);
  };
  if (navigator.locks) await navigator.locks.request(OUTBOX_KEY, commit);
  else commit();
}

export interface WorkspaceSubTabs {
  pos: 'register' | 'sales';
  shop: string;
  orders: 'all' | 'confirmed' | 'fulfilled' | 'cancelled';
  inventory: 'balances' | 'movements' | 'receipt' | 'adjust' | 'create' | 'import-export';
  loans: 'overview' | 'history';
  settings: 'users' | 'policy' | 'sync' | 'audit' | 'data';
}

const DEFAULT_SUB_TABS: WorkspaceSubTabs = {
  pos: 'register',
  shop: 'all',
  orders: 'all',
  inventory: 'balances',
  loans: 'overview',
  settings: 'users',
};

interface AppState {
  session: AuthSession | null;
  activeWorkspace: WorkspaceId;
  subTabs: WorkspaceSubTabs;
  offlineMode: boolean;
  terminalId: string;
  offlineOutbox: OfflineSyncEventPayload[];
  setSession: (session: AuthSession | null) => void;
  setActiveWorkspace: (workspace: WorkspaceId) => void;
  setWorkspaceSubTab: <K extends keyof WorkspaceSubTabs>(
    workspace: K,
    subTab: WorkspaceSubTabs[K]
  ) => void;
  navigateToWorkspace: (workspace: WorkspaceId, subTab?: string) => void;
  setOfflineMode: (offline: boolean) => void;
  setTerminalId: (terminalId: string) => void;
  enqueueOfflineEvent: (evt: OfflineSyncEventPayload) => Promise<void>;
  removeSyncedEvents: (eventIds: string[]) => Promise<void>;
  logout: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  session: null,
  activeWorkspace: 'dashboard',
  subTabs: { ...DEFAULT_SUB_TABS },
  offlineMode: typeof navigator !== 'undefined' && !navigator.onLine,
  terminalId: 'TERMINAL-001',
  offlineOutbox: getDesktopPosBridge() ? [] : loadOutbox(),

  setSession: (session) => {
    setStoredToken(session?.token ?? null, session?.session?.remembered);
    saveOfflineCashier(session);
    set((state) => {
      if (!session) {
        return { session: null, activeWorkspace: 'dashboard', subTabs: { ...DEFAULT_SUB_TABS } };
      }
      const nextWorkspace = canAccessWorkspace(session.user.role, state.activeWorkspace)
        ? state.activeWorkspace
        : getDefaultWorkspaceForRole(session.user.role);
      return { session, activeWorkspace: nextWorkspace };
    });
  },

  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setWorkspaceSubTab: (workspace, subTab) =>
    set((state) => ({
      subTabs: {
        ...state.subTabs,
        [workspace]: subTab,
      },
    })),
  navigateToWorkspace: (workspace, subTab) =>
    set((state) => {
      if (
        subTab &&
        (workspace === 'pos' ||
          workspace === 'shop' ||
          workspace === 'orders' ||
          workspace === 'inventory' ||
          workspace === 'loans' ||
          workspace === 'settings')
      ) {
        return {
          activeWorkspace: workspace,
          subTabs: {
            ...state.subTabs,
            [workspace]: subTab,
          },
        };
      }
      return { activeWorkspace: workspace };
    }),
  setOfflineMode: (offlineMode) => set({ offlineMode }),
  setTerminalId: (terminalId) => set({ terminalId }),

  enqueueOfflineEvent: async (evt) => {
    const desktop = getDesktopPosBridge();
    if (desktop) {
      set({ offlineOutbox: await desktop.queueSale(evt) });
      return;
    }
    await updateOutbox(
      (events) => events.some((event) => event.event_id === evt.event_id) ? events : [...events, evt],
      (offlineOutbox) => set({ offlineOutbox }),
    );
  },

  removeSyncedEvents: async (eventIds) => {
    const desktop = getDesktopPosBridge();
    if (desktop) {
      set({ offlineOutbox: await desktop.acknowledgeSales(eventIds) });
      return;
    }
    const removed = new Set(eventIds);
    await updateOutbox(
      (events) => events.filter((event) => !removed.has(event.event_id)),
      (offlineOutbox) => set({ offlineOutbox }),
    );
  },

  logout: () => {
    setStoredToken(null);
    saveOfflineCashier(null);
    set({ session: null, activeWorkspace: 'dashboard' });
  },
}));

if (typeof window !== 'undefined' && !getDesktopPosBridge()) {
  window.addEventListener('storage', (event) => {
    if (event.key === OUTBOX_KEY || event.key === null) {
      useAppStore.setState({ offlineOutbox: loadOutbox() });
    }
  });
}
