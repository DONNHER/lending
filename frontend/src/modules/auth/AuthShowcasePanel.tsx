import { Leaf, ShieldCheck, Store, UserCheck } from 'lucide-react';
import { STORE_HERO_IMAGE } from '../../lib/productAssets';

export function AuthShowcasePanel() {
  return (
    <div className="relative flex flex-col justify-between gap-5 bg-[#14532D] px-5 py-6 text-white sm:px-8 sm:py-7 lg:col-span-6 lg:min-h-screen lg:gap-8 lg:p-8 xl:p-12">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <Leaf className="h-5 w-5 text-emerald-200" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight sm:text-xl">Argivit Store</span>
        </div>
        <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100 lg:hidden">
          Cooperative Ledger
        </span>
      </div>

      <div className="my-auto w-full max-w-2xl space-y-5 lg:max-w-xl lg:space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-center sm:gap-6 lg:block lg:space-y-6">
          <div className="hidden overflow-hidden rounded-xl border border-white/15 bg-black/20 sm:col-span-5 sm:block lg:col-span-12">
            <img
              src={STORE_HERO_IMAGE}
              alt="Argivit Cooperative Supply Store and Warehouse"
              referrerPolicy="no-referrer"
              className="aspect-[16/10] w-full object-cover lg:h-56 lg:aspect-auto xl:h-64"
            />
          </div>

          <div className="space-y-2 sm:col-span-7 sm:space-y-3 lg:col-span-12">
            <h1 className="font-display text-xl font-bold leading-tight text-white sm:text-2xl xl:text-3xl">
              Cooperative Retail, Inventory & Shareholder Credit in One Ledger
            </h1>
            <p className="text-xs leading-relaxed text-emerald-100/90 sm:text-sm">
              Built for agricultural supply cooperatives with dual-unit sack/kilogram stock control,
              offline-resilient POS synchronization, verified fixed share capital, and 6× capital-backed
              member loans.
            </p>
          </div>
        </div>

        <div className="hidden grid-cols-3 gap-3 border-t border-white/15 pt-4 text-xs text-emerald-100 sm:grid lg:gap-4 lg:pt-5">
          <div>
            <Store className="mb-1.5 h-4 w-4 text-emerald-300" />
            <div className="font-semibold text-white">Hybrid POS</div>
            <div className="mt-0.5 text-emerald-200/80">Outbox queue & idempotent sync</div>
          </div>
          <div>
            <UserCheck className="mb-1.5 h-4 w-4 text-emerald-300" />
            <div className="font-semibold text-white">Verified Capital</div>
            <div className="mt-0.5 text-emerald-200/80">Immutable payment records</div>
          </div>
          <div>
            <ShieldCheck className="mb-1.5 h-4 w-4 text-emerald-300" />
            <div className="font-semibold text-white">Loan State Engine</div>
            <div className="mt-0.5 text-emerald-200/80">6× ceiling & installment rules</div>
          </div>
        </div>
      </div>

      <p className="hidden text-xs text-emerald-200/75 lg:block">
        Argivit Agricultural Supply Cooperative · Authoritative Transaction & Inventory System
      </p>
    </div>
  );
}
