import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { EmptyState, LoadingSkeleton } from './components/ui/StateViews';
import { ApiError, apiRequest, getStoredToken } from './lib/api';
import { isPosConnectionError, loadOfflineCashier } from './lib/posOffline';
import { SettingsView } from './modules/admin/SettingsView';
import { AuthScreen } from './modules/auth/AuthScreen';
import { DashboardView } from './modules/dashboard/DashboardView';
import { InventoryView } from './modules/inventory/InventoryView';
import { LoansView } from './modules/loans/LoansView';
import { OrdersView } from './modules/orders/OrdersView';
import { PosTerminalView } from './modules/pos/PosTerminalView';
import { usePosSync } from './modules/pos/usePosSync';
import { ProfileView } from './modules/profile/ProfileView';
import { ReportsView } from './modules/reports/ReportsView';
import { ShareholdersView } from './modules/shareholders/ShareholdersView';
import { OnlineShopView } from './modules/shop/OnlineShopView';
import { useAppStore } from './stores/app-store';
import type { User } from './types/domain';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function ArgivitRouter() {
  const { session, activeWorkspace, offlineMode, setOfflineMode, setSession, logout } = useAppStore();
  const [booting, setBooting] = useState(Boolean(getStoredToken()));
  const sync = usePosSync();

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBooting(false);
      return;
    }

    apiRequest<{ user: User; impersonated_by?: { id: string; name: string; email: string } | null }>(
      '/auth/me', { signal: AbortSignal.timeout(4000) }
    )
      .then((res) => {
        setSession({
          token,
          user: res.data.user,
          impersonated_by: res.data.impersonated_by ?? null,
        });
      })
      .catch((error) => {
        if (isPosConnectionError(error) || (error instanceof ApiError && error.status >= 500)) {
          const cachedCashier = loadOfflineCashier(token);
          if (cachedCashier) {
            setOfflineMode(true);
            setSession(cachedCashier);
            return;
          }
        }
        logout();
      })
      .finally(() => {
        setBooting(false);
      });
  }, [setSession, setOfflineMode, logout]);

  if (booting) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  const workspace = offlineMode && session.user.role === 'cashier' ? 'pos' : activeWorkspace;
  return (
    <AppShell>
      {workspace === 'dashboard' && <DashboardView />}
      {workspace === 'pos' && <PosTerminalView {...sync} />}
      {workspace === 'shop' && <OnlineShopView />}
      {workspace === 'orders' && <OrdersView />}
      {workspace === 'inventory' && <InventoryView />}
      {workspace === 'shareholders' && <ShareholdersView />}
      {workspace === 'loans' && (offlineMode
        ? <EmptyState title="Loans require a connection" description="Reconnect to view loans, submit applications, or record repayments." />
        : <LoansView />)}
      {workspace === 'reports' && <ReportsView />}
      {workspace === 'settings' && <SettingsView />}
      {workspace === 'profile' && <ProfileView />}
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ArgivitRouter />
    </QueryClientProvider>
  );
}
