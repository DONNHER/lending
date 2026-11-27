import { ArrowRight, Leaf, ShieldCheck, ShoppingBag, Store } from 'lucide-react';
import { AuthShowcasePanel } from './AuthShowcasePanel';

export type PortalRoute = '/admin-login' | '/cashier' | '/online-shop';

const PORTALS: Array<{
  route: PortalRoute;
  label: string;
  description: string;
  icon: typeof ShieldCheck;
}> = [
  {
    route: '/admin-login',
    label: 'Admin Login',
    description: 'System administration, approvals, inventory & loan governance',
    icon: ShieldCheck,
  },
  {
    route: '/cashier',
    label: 'Cashier',
    description: 'POS terminal, offline sync & pre-order pickup',
    icon: Store,
  },
  {
    route: '/online-shop',
    label: 'Online Shop',
    description: 'Member & shareholder sign in, registration, orders & loans',
    icon: ShoppingBag,
  },
];

export function PortalScreen({ onSelectPortal }: { onSelectPortal: (route: PortalRoute) => void }) {
  return (
    <div className="min-h-screen bg-[#F7F9F8] text-[#0F172A] lg:grid lg:grid-cols-12">
      <AuthShowcasePanel />

      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:col-span-6">
        <div className="mx-auto w-full max-w-md space-y-7">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#15803D] text-white">
              <Leaf className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-bold text-[#0F172A]">Argivit Store</span>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-[#0F172A]">
              Choose your portal
            </h2>
            <p className="mt-1 text-sm text-[#475569]">
              Select a workspace portal to continue to sign in.
            </p>
          </div>

          <div className="space-y-3">
            {PORTALS.map(({ route, label, description, icon: Icon }) => (
              <button
                key={route}
                type="button"
                onClick={() => onSelectPortal(route)}
                className="group flex w-full items-center justify-between gap-4 rounded-xl border border-[#E2E8E4] bg-white px-5 py-4 text-left transition-all hover:border-[#15803D] hover:bg-[#F0FDF4]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#15803D] transition-colors group-hover:bg-[#15803D] group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-display text-base font-semibold text-[#0F172A]">
                      {label}
                    </div>
                    <p className="mt-0.5 text-xs text-[#475569]">{description}</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#15803D]" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
