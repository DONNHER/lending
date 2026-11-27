import { useCallback, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { EmptyState, LoadingSkeleton } from './components/ui/StateViews';
import { ApiError, apiRequest, getStoredToken } from './lib/api';
import { getDesktopPosBridge, isPosConnectionError, loadOfflineCashier } from './lib/posOffline';
import { SettingsView } from './modules/admin/SettingsView';
import { AuthScreen, type AuthPortal } from './modules/auth/AuthScreen';
import { PasswordRecoveryView, readPasswordResetToken } from './modules/auth/PasswordRecoveryView';
import { PortalScreen, type PortalRoute } from './modules/auth/PortalScreen';
import { SessionGuard } from './modules/auth/SessionGuard';
import { DashboardView } from './modules/dashboard/DashboardView';
import { InventoryView } from './modules/inventory/InventoryView';
import { LoansView } from './modules/loans/LoansView';
import { OrdersView } from './modules/orders/OrdersView';
import { PosTerminalView } from './modules/pos/PosTerminalView';
import { usePosSync } from './modules/pos/usePosSync';
import { ProfileView } from './modules/profile/ProfileView';
import { ReportsView } from './modules/reports/ReportsView';
import { ShareholdersView } from './modules/shareholders/ShareholdersView';
import { membershipQuery } from './modules/shareholders/membershipQuery';
import { OnlineShopView } from './modules/shop/OnlineShopView';
import { useAppStore } from './stores/app-store';
import type { AuthSession } from './types/domain';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

const ROUTE_PORTALS: Record<string, AuthPortal> = {
  '/admin-login': 'admin',
  '/manager': 'manager',
  '/cashier': 'cashier',
  '/online-shop': 'online-shop',
  '/login': 'online-shop',
  '/register': 'online-shop',
};

function ArgivitRouter() {
  const { session, activeWorkspace, offlineMode, setOfflineMode, setSession, logout } = useAppStore();
  const [booting, setBooting] = useState(Boolean(getStoredToken()));
  const [resetToken, setResetToken] = useState(readPasswordResetToken);
  const [pathname, setPathname] = useState(() => window.location.pathname || '/');

  const navigate = useCallback((to: '/' | PortalRoute) => {
    if (window.location.pathname !== to) {
      window.history.pushState(null, '', to);
    }
    setPathname(to);
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const expireSession = useCallback(() => {
    queryClient.clear();
    logout();
  }, [logout]);

  function closeRecovery() {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setResetToken(null);
  }
  const sync = usePosSync();
  const membership = useQuery({
    ...membershipQuery(session?.user.role === 'shareholder' ? session.user.id : undefined),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBooting(false);
      return;
    }

    apiRequest<Omit<AuthSession, 'token'>>(
      '/auth/me', { signal: AbortSignal.timeout(4000) }
    )
      .then((res) => {
        setSession({
          token,
          user: res.data.user,
          impersonated_by: res.data.impersonated_by ?? null,
          session: res.data.session,
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

  if (resetToken) {
    return <PasswordRecoveryView token={resetToken} onBack={closeRecovery} onReset={() => {
      expireSession();
      closeRecovery();
    }} />;
  }

  if (booting) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  if (!session) {
    if (getDesktopPosBridge()) {
      return <AuthScreen key="cashier" portal="cashier" />;
    }
    const selectedPortal = ROUTE_PORTALS[pathname];
    if (!selectedPortal) {
      return <PortalScreen onSelectPortal={navigate} />;
    }
    return <AuthScreen key={selectedPortal} portal={selectedPortal} onBackToPortal={() => navigate('/')} />;
  }

  const loanAccess = session.user.role !== 'shareholder' || (!membership.isError && membership.data?.loan_access === true);
  const loanPortal = import.meta.env.VITE_ARGIVET_ENTRY === 'loan';
  let workspace = offlineMode && session.user.role === 'cashier' ? 'pos' : activeWorkspace;
  if (loanPortal && session.user.role !== 'shareholder' && !['loans', 'shareholders', 'profile'].includes(workspace)) {
    workspace = session.user.role === 'cashier' ? 'profile' : 'shareholders';
  }
  if (workspace === 'loans' && !loanAccess) workspace = 'shareholders';
  return (
    <AppShell activeWorkspace={workspace} loanAccess={loanAccess}>
      {session.session && (
        <SessionGuard key={session.session.id} token={session.token} initial={session.session}
          offline={offlineMode} onExpired={expireSession} />
      )}
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
