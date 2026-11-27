import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  Leaf,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
  ShoppingCart,
  User as UserIcon,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatPHP } from '../../lib/productAssets';
import { useLanguage, useTranslate, type Language, type MessageKey } from '../../lib/language';
import {
  canAccessWorkspace,
  useAppStore,
  type WorkspaceId,
} from '../../stores/app-store';
import { useCartStore } from '../../stores/cart-store';
import type { AuthSession, UserRole } from '../../types/domain';
import { NotificationBell } from './NotificationBell';

interface SubNavItem {
  id: string;
  label: MessageKey;
  roles?: UserRole[];
}

interface NavItem {
  id: WorkspaceId;
  label: MessageKey;
  icon: typeof LayoutDashboard;
  subItems?: SubNavItem[];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    id: 'pos',
    label: 'POS Terminal',
    icon: ShoppingCart,
    subItems: [
      { id: 'register', label: 'POS Register' },
      { id: 'sales', label: 'Sales & Returns' },
    ],
  },
  {
    id: 'shop',
    label: 'Online Shop',
    icon: ShoppingBag,
    subItems: [
      { id: 'all', label: 'All Supplies' },
      { id: 'Crop Care & Inputs', label: 'Crop Care & Inputs' },
      { id: 'Fertilizers & Soil', label: 'Fertilizers & Soil' },
      { id: 'Livestock Feed', label: 'Livestock Feed' },
      { id: 'Seeds & Planting', label: 'Seeds & Planting' },
    ],
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: ClipboardList,
    subItems: [
      { id: 'all', label: 'All Orders' },
      { id: 'confirmed', label: 'Confirmed' },
      { id: 'fulfilled', label: 'Fulfilled' },
      { id: 'cancelled', label: 'Cancelled' },
    ],
  },
  {
    id: 'inventory',
    label: 'Products & Inventory',
    icon: Package,
    subItems: [
      { id: 'balances', label: 'Stock Balances' },
      { id: 'movements', label: 'Ledger Movements' },
      { id: 'receipt', label: 'Receive Stock', roles: ['admin', 'manager'] },
      { id: 'adjust', label: 'Adjustment', roles: ['admin', 'manager'] },
      { id: 'create', label: 'New Product', roles: ['admin', 'manager'] },
      { id: 'import-export', label: 'Import / Export', roles: ['admin', 'manager'] },
    ],
  },
  { id: 'shareholders', label: 'Shareholders', icon: Users },
  { id: 'loans', label: 'Loans', icon: Landmark },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  {
    id: 'settings',
    label: 'Settings & Admin',
    icon: Settings,
    subItems: [
      { id: 'users', label: 'Users & Roles' },
      { id: 'policy', label: 'Capital & Loan Policy' },
      { id: 'sync', label: 'Offline Sync & Conflicts' },
      { id: 'audit', label: 'Audit Logs' },
      { id: 'data', label: 'Data & Backups' },
    ],
  },
  { id: 'profile', label: 'Profile', icon: UserIcon },
];

function getVisibleSubItems(item: NavItem, role: UserRole): SubNavItem[] {
  if (!item.subItems) return [];
  return item.subItems.filter((sub) => !sub.roles || sub.roles.includes(role));
}

export function AppShell({ children, activeWorkspace, loanAccess }: { children: ReactNode; activeWorkspace: WorkspaceId; loanAccess: boolean }) {
  const t = useTranslate();
  const { language, setLanguage } = useLanguage();
  const {
    session,
    subTabs,
    setActiveWorkspace,
    navigateToWorkspace,
    offlineMode,
    offlineOutbox,
    setSession,
    logout,
  } = useAppStore();
  const { items: cartItems, setCartOpen, getTotal: getCartTotal } = useCartStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [miniMenuId, setMiniMenuId] = useState<WorkspaceId | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<WorkspaceId, boolean>>>({});
  const [sidebarMode, setSidebarMode] = useState<'shop' | 'loan'>('shop');
  const sidebarContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSidebarMode('shop');
  }, [session?.user.id]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMiniMenuId(null);
      }
    }
    function handleMouseDown(e: MouseEvent) {
      if (
        miniMenuId &&
        sidebarContainerRef.current &&
        !sidebarContainerRef.current.contains(e.target as Node)
      ) {
        setMiniMenuId(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [miniMenuId]);

  if (!session) return null;

  const { user, impersonated_by } = session;
  const loanPortal = import.meta.env.VITE_ARGIVET_ENTRY === 'loan';
  const totalCartQty = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  const navItems = user.role === 'shareholder'
    ? NAV_ITEMS.map((item) => item.id === 'shareholders' ? { ...item, label: 'Membership' as const } : item)
    : NAV_ITEMS;
  const baseAllowedItems = navItems.filter((item) => canAccessWorkspace(user.role, item.id) &&
    (item.id !== 'loans' || loanAccess) &&
    (!offlineMode || user.role !== 'cashier' || item.id === 'pos')
  );
  const effectiveSidebarMode: 'shop' | 'loan' =
    activeWorkspace === 'loans' || activeWorkspace === 'shareholders'
      ? 'loan'
      : activeWorkspace === 'shop' || activeWorkspace === 'orders'
      ? 'shop'
      : sidebarMode;
  const allowedItems =
    user.role === 'shareholder'
      ? baseAllowedItems.filter((item) =>
          effectiveSidebarMode === 'shop'
            ? item.id === 'shop' || item.id === 'orders'
            : item.id === 'loans' || item.id === 'shareholders'
        )
      : loanPortal
      ? baseAllowedItems.filter((item) => item.id === 'loans' || item.id === 'shareholders')
      : baseAllowedItems.filter((item) => item.id !== 'profile');
  const activeItem = navItems.find((i) => i.id === activeWorkspace) || allowedItems[0];
  const miniMenuItem =
    miniMenuId && allowedItems.some((i) => i.id === miniMenuId)
      ? allowedItems.find((i) => i.id === miniMenuId) || null
      : null;

  function getActiveSubTabFor(workspaceId: WorkspaceId): string | null {
    switch (workspaceId) {
      case 'pos':
        return subTabs.pos;
      case 'shop':
        return subTabs.shop;
      case 'orders':
        return subTabs.orders;
      case 'inventory':
        return subTabs.inventory;
      case 'loans':
        return subTabs.loans;
      case 'settings':
        return subTabs.settings;
      default:
        return null;
    }
  }

  function handleSidebarModeChange(nextMode: 'shop' | 'loan') {
    setSidebarMode(nextMode);
    setMiniMenuId(null);
    setMobileOpen(false);
    if (nextMode === 'loan') {
      setActiveWorkspace(loanAccess ? 'loans' : 'shareholders');
    } else if (nextMode === 'shop' && activeWorkspace !== 'shop' && activeWorkspace !== 'orders') {
      setActiveWorkspace('shop');
    }
  }

  function handleRailIconClick(item: NavItem) {
    const visibleSubs = getVisibleSubItems(item, user.role);
    if (visibleSubs.length === 0) {
      setMiniMenuId(null);
      setActiveWorkspace(item.id);
      return;
    }
    if (miniMenuId === item.id) {
      setMiniMenuId(null);
      return;
    }
    setMiniMenuId(item.id);
  }

  async function handleExitImpersonation() {
    try {
      const res = await apiRequest<AuthSession>('/admin/impersonation', {
        method: 'DELETE',
      });
      setSession(res.data);
    } catch {
      logout();
    }
  }

  const expandedSidebarContent = (isMobileDrawer = false) => (
    <div className="flex h-full min-h-0 flex-col bg-[#14532D] text-white">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
            <Leaf className="h-4 w-4 text-emerald-200" />
          </div>
          <span className="font-display text-base font-bold tracking-tight whitespace-nowrap">
            Argivit Store
          </span>
        </div>
        {isMobileDrawer ? (
          <button
            type="button"
            aria-label={t('Close navigation menu')}
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 text-emerald-100 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('Collapse sidebar to icon rail')}
            title={t('Collapse sidebar')}
            onClick={() => setSidebarExpanded(false)}
            className="rounded-md p-1.5 text-emerald-100 hover:bg-white/10"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 pt-4 pb-2">
          <div className="rounded-lg bg-white/10 px-3 py-2.5">
            <div className="text-[11px] font-medium text-emerald-200">{t('Active Workspace')}</div>
            <div className="mt-0.5 text-xs font-semibold text-white capitalize">
              {t('{role} Portal', { role: t(user.role) })}
            </div>
          </div>
        </div>

        {user.role === 'shareholder' ? (
          <div className="px-3 pt-1 pb-2">
            <div
              role="group"
              aria-label={t('Switch shareholder workspace')}
              className="grid grid-cols-2 gap-1 rounded-lg bg-black/20 p-1"
            >
              <button
                type="button"
                aria-pressed={effectiveSidebarMode === 'shop'}
                onClick={() => handleSidebarModeChange('shop')}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  effectiveSidebarMode === 'shop'
                    ? 'bg-white text-[#14532D]'
                    : 'text-emerald-100/85 hover:text-white'
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                <span>{t('Online Shop')}</span>
              </button>
              <button
                type="button"
                aria-pressed={effectiveSidebarMode === 'loan'}
                onClick={() => handleSidebarModeChange('loan')}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  effectiveSidebarMode === 'loan'
                    ? 'bg-white text-[#14532D]'
                    : 'text-emerald-100/85 hover:text-white'
                }`}
              >
                <Landmark className="h-3.5 w-3.5 shrink-0" />
                <span>{t('Loan')}</span>
              </button>
            </div>
          </div>
        ) : null}

        <nav className="space-y-1 px-3 py-2" aria-label={t('Workspace navigation')}>
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const active = activeWorkspace === item.id;
            const subItems = getVisibleSubItems(item, user.role);
            const hasSub = subItems.length > 0;
            const groupOpen = expandedGroups[item.id] ?? active;
            const activeSub = getActiveSubTabFor(item.id);

            return (
              <div key={item.id} className="space-y-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveWorkspace(item.id);
                      if (hasSub) {
                        setExpandedGroups((prev) => ({ ...prev, [item.id]: true }));
                      }
                      setMobileOpen(false);
                    }}
                    className={`flex flex-1 items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white text-[#14532D]'
                        : 'text-emerald-100/90 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{t(item.label)}</span>
                    </span>
                    {item.id === 'pos' && offlineOutbox.length > 0 ? (
                      <span
                        className={`font-mono text-xs font-semibold ${
                          active ? 'text-[#B45309]' : 'text-amber-300'
                        }`}
                      >
                        {offlineOutbox.length}
                      </span>
                    ) : null}
                  </button>
                  {hasSub ? (
                    <button
                      type="button"
                      aria-label={t('Toggle {item} sub-directory', { item: t(item.label) })}
                      aria-expanded={groupOpen}
                      onClick={() =>
                        setExpandedGroups((prev) => ({ ...prev, [item.id]: !groupOpen }))
                      }
                      className="rounded-lg p-2 text-emerald-100/80 hover:bg-white/10 hover:text-white"
                    >
                      {groupOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>

                {hasSub && groupOpen ? (
                  <div className="ml-4 space-y-0.5 border-l border-white/15 pl-3">
                    {subItems.map((sub) => {
                      const isSubActive = active && activeSub === sub.id;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            navigateToWorkspace(item.id, sub.id);
                            setMobileOpen(false);
                          }}
                          className={`block w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors whitespace-nowrap ${
                            isSubActive
                              ? 'bg-white/15 font-semibold text-white'
                              : 'text-emerald-100/80 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {t(sub.label)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="shrink-0 border-t border-white/10 p-4 space-y-3">
        {!loanPortal && canAccessWorkspace(user.role, 'pos') ? (
          <div
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium ${
              offlineMode
                ? 'border-amber-300/60 bg-amber-400/20 text-amber-100'
                : 'border-white/15 bg-white/5 text-emerald-100'
            }`}
          >
            <span className="flex items-center gap-2">
              {offlineMode ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
              <span>{t(offlineMode ? 'Offline · Cash only' : 'Online')}</span>
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setActiveWorkspace('profile');
            setMobileOpen(false);
          }}
          aria-label={t('Open profile page')}
          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
            activeWorkspace === 'profile'
              ? 'bg-white/15 text-white'
              : 'hover:bg-white/10'
          }`}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{user.name}</div>
            <div className="truncate text-xs text-emerald-200/80">{user.email}</div>
          </div>
          <UserIcon className="h-4 w-4 shrink-0 text-emerald-100" />
        </button>
      </div>
    </div>
  );

  const collapsedRailContent = (
    <div className="flex h-full min-h-0 flex-col bg-[#14532D] text-white">
      <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-white/10">
        <button
          type="button"
          aria-label={t('Expand sidebar')}
          title={t('Expand full sidebar')}
          onClick={() => {
            setMiniMenuId(null);
            setSidebarExpanded(true);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-emerald-200 transition-colors hover:bg-white/25 hover:text-white"
        >
          <Leaf className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0 w-full flex-col items-center overflow-y-auto py-3">
        {user.role === 'shareholder' ? (
          <div
            role="group"
            aria-label={t('Switch shareholder workspace')}
            className="mb-3 flex shrink-0 flex-col gap-1 rounded-lg bg-black/20 p-1"
          >
            <button
              type="button"
              aria-label={t('Online Shop mode')}
              title={t('Online Shop')}
              aria-pressed={effectiveSidebarMode === 'shop'}
              onClick={() => handleSidebarModeChange('shop')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                effectiveSidebarMode === 'shop'
                  ? 'bg-white text-[#14532D]'
                  : 'text-emerald-100/85 hover:bg-white/10 hover:text-white'
              }`}
            >
              <ShoppingBag className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t('Loan mode')}
              title={t('Loan')}
              aria-pressed={effectiveSidebarMode === 'loan'}
              onClick={() => handleSidebarModeChange('loan')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                effectiveSidebarMode === 'loan'
                  ? 'bg-white text-[#14532D]'
                  : 'text-emerald-100/85 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Landmark className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <nav
          className="flex w-full flex-col items-center gap-1.5 px-2"
          aria-label={t('Workspace icon rail')}
        >
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const active = activeWorkspace === item.id;
            const isMiniOpen = miniMenuId === item.id;
            const hasSub = getVisibleSubItems(item, user.role).length > 0;

            return (
              <button
                key={item.id}
                type="button"
                aria-label={t(item.label)}
                title={t(item.label)}
                aria-expanded={isMiniOpen}
                onClick={() => handleRailIconClick(item)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? 'bg-white text-[#14532D]'
                    : isMiniOpen
                    ? 'bg-white/20 text-white ring-1 ring-white/40'
                    : 'text-emerald-100/90 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {hasSub ? (
                  <ChevronRight
                    aria-hidden="true"
                    className={`absolute right-0.5 bottom-0.5 h-2.5 w-2.5 ${
                      active ? 'text-[#14532D]/70' : 'text-emerald-200/75'
                    }`}
                  />
                ) : null}
                {item.id === 'pos' && offlineOutbox.length > 0 ? (
                  <span
                    aria-label={t('{count} offline queued', { count: offlineOutbox.length })}
                    className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 font-mono text-[10px] font-bold text-slate-900"
                  >
                    {offlineOutbox.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="shrink-0 flex flex-col items-center gap-2 border-t border-white/10 py-3">
        {!loanPortal && canAccessWorkspace(user.role, 'pos') ? (
          <div
            role="img"
            aria-label={t(offlineMode ? 'Offline · Cash only' : 'Online')}
            title={t(offlineMode ? 'Offline · Cash only' : 'Online')}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
              offlineMode
                ? 'border-amber-300/60 bg-amber-400/20 text-amber-100'
                : 'border-white/15 bg-white/5 text-emerald-100'
            }`}
          >
            {offlineMode ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
          </div>
        ) : null}

        <button
          type="button"
          aria-label={t('Open profile page')}
          title={`${user.name} · ${t('Profile')}`}
          onClick={() => {
            setMiniMenuId(null);
            setActiveWorkspace('profile');
          }}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            activeWorkspace === 'profile'
              ? 'bg-white text-[#14532D]'
              : 'text-emerald-100/85 hover:bg-white/10 hover:text-white'
          }`}
        >
          <UserIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label={t('Expand full sidebar')}
          title={t('Expand full sidebar')}
          onClick={() => {
            setMiniMenuId(null);
            setSidebarExpanded(true);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-emerald-100/85 transition-colors hover:bg-white/10 hover:text-white"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const miniMenuSubItems = miniMenuItem ? getVisibleSubItems(miniMenuItem, user.role) : [];
  const miniMenuActiveSub = miniMenuItem ? getActiveSubTabFor(miniMenuItem.id) : null;

  return (
    <div className="flex min-h-screen bg-[#F7F9F8] text-[#0F172A]">
      {/* Wide & Landscape Persistent Sidebar (Icon Rail by default; expandable) */}
      <div ref={sidebarContainerRef} className="relative hidden shrink-0 md:block landscape:block">
        <aside
          className={`sticky top-0 flex h-screen flex-col overflow-hidden bg-[#14532D] ${
            sidebarExpanded ? 'w-64' : 'w-16'
          }`}
        >
          {sidebarExpanded ? expandedSidebarContent(false) : collapsedRailContent}
        </aside>

        {/* Mini Sidebar Flyout when collapsed icon is clicked */}
        {!sidebarExpanded && miniMenuItem ? (
          <div
            role="region"
            aria-label={t('{item} mini sidebar', { item: t(miniMenuItem.label) })}
            className="fixed top-0 bottom-0 left-16 z-50 flex w-[264px] flex-col overflow-hidden border-r border-[#E2E8E4] bg-white text-[#0F172A] shadow-xl"
          >
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[#E2E8E4] px-3.5">
              <button
                type="button"
                onClick={() => {
                  setActiveWorkspace(miniMenuItem.id);
                  setMiniMenuId(null);
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-[#F7F9F8]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#F0FDF4] text-[#15803D]">
                  <miniMenuItem.icon className="h-4 w-4" />
                </span>
                <span className="truncate font-display text-sm font-semibold text-[#0F172A]">
                  {t(miniMenuItem.label)}
                </span>
              </button>
              <button
                type="button"
                aria-label={t('Close mini sidebar')}
                onClick={() => setMiniMenuId(null)}
                className="rounded-md p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                {miniMenuSubItems.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="px-2 text-xs font-medium text-[#64748B]">
                      {t('Sub-directory')}
                    </div>
                    <div className="space-y-1" role="list" aria-label={t('{item} sub-directory', { item: t(miniMenuItem.label) })}>
                      {miniMenuSubItems.map((sub) => {
                        const isSubActive =
                          activeWorkspace === miniMenuItem.id && miniMenuActiveSub === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => {
                              navigateToWorkspace(miniMenuItem.id, sub.id);
                              setMiniMenuId(null);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                              isSubActive
                                ? 'bg-[#F0FDF4] text-[#15803D] font-semibold'
                                : 'text-[#334155] hover:bg-[#F7F9F8] hover:text-[#0F172A]'
                            }`}
                          >
                            <span>{t(sub.label)}</span>
                            <ChevronRight
                              className={`h-3.5 w-3.5 ${
                                isSubActive ? 'text-[#15803D]' : 'text-[#94A3B8]'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 px-1">
                    <p className="text-xs text-[#64748B]">
                      {activeWorkspace === miniMenuItem.id
                        ? 'Currently viewing this workspace.'
                        : 'Select below to open this workspace.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveWorkspace(miniMenuItem.id);
                        setMiniMenuId(null);
                      }}
                      className="flex w-full items-center justify-between rounded-lg bg-[#15803D] px-3 py-2 text-xs font-medium text-white hover:bg-[#166534] whitespace-nowrap"
                    >
                      <span>{t('Open {item}', { item: t(miniMenuItem.label) })}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
            </div>

            <div className="shrink-0 border-t border-[#E2E8E4] p-3">
              <button
                type="button"
                onClick={() => {
                  setMiniMenuId(null);
                  setSidebarExpanded(true);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#E2E8E4] bg-[#F8FAFC] px-3 py-2 text-xs font-medium text-[#334155] hover:bg-[#F1F5F9] whitespace-nowrap"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
                <span>{t('Pin Full Sidebar')}</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Portrait Mobile Drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden landscape:hidden">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 h-full w-64 max-w-[80vw] overflow-hidden">
            {expandedSidebarContent(true)}
          </aside>
        </div>
      ) : null}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {impersonated_by ? (
          <div className="flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-[#92400E] sm:px-6">
            <span>
              {t('Impersonating {user} ({role}) · Admin: {admin}', { user: user.name, role: t(user.role), admin: impersonated_by.name })}
            </span>
            <button
              type="button"
              onClick={handleExitImpersonation}
              className="rounded border border-amber-300 bg-white px-3 py-1 font-medium text-[#92400E] hover:bg-amber-100 whitespace-nowrap shrink-0"
            >
              {t('Exit Impersonation')}
            </button>
          </div>
        ) : null}

        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-[#E2E8E4] bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label={t('Open navigation menu')}
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-[#334155] hover:bg-[#EEF3F0] md:hidden landscape:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden text-[#64748B] sm:inline whitespace-nowrap">Argivit Store</span>
              <span className="hidden text-[#CBD5E1] sm:inline">/</span>
              <h1 className="truncate font-display text-base font-semibold text-[#0F172A]">
                {t(activeItem?.label ?? 'Workspace')}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {session && <NotificationBell key={session.user.id} session={session} offline={offlineMode} />}
            <label className="flex items-center">
              <span className="sr-only">{t('Language')}</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 focus-visible:outline-emerald-700"
              >
                <option value="en" lang="en">English</option>
                <option value="fil" lang="fil">Filipino</option>
              </select>
            </label>
            {activeWorkspace === 'shop' ? (
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden whitespace-nowrap font-mono text-xs text-[#475569] tabular-nums lg:inline">
                  {t('Current subtotal')}: {formatPHP(getCartTotal())}
                </span>
                <button
                  type="button"
                  aria-label={t('Pre-Order Bag ({count})', { count: totalCartQty })}
                  onClick={() => setCartOpen(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#166534]"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span>
                    <span className="hidden sm:inline">{t('Pre-Order Bag ({count})', { count: totalCartQty })}</span>
                    <span className="sm:hidden">{t('Bag ({count})', { count: totalCartQty })}</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
