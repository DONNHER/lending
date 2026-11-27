import { Leaf, ShieldCheck, Store, UserCheck } from 'lucide-react';
import { STORE_HERO_IMAGE } from '../../lib/productAssets';

export function AuthShowcasePanel() {
  return (
    <div className="relative hidden flex-col justify-between bg-[#14532D] p-10 text-white lg:col-span-6 lg:flex">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
          <Leaf className="h-5 w-5 text-emerald-200" />
        </div>
        <span className="font-display text-xl font-bold tracking-tight">Argivit Store</span>
      </div>

      <div className="my-auto max-w-xl space-y-6">
        <div className="overflow-hidden rounded-xl border border-white/15 bg-black/20">
          <img
            src={STORE_HERO_IMAGE}
            alt="Argivit Cooperative Supply Store and Warehouse"
            referrerPolicy="no-referrer"
            className="h-64 w-full object-cover"
          />
        </div>

        <div className="space-y-3">
          <h1 className="font-display text-3xl font-bold leading-tight text-white">
            Cooperative Retail, Inventory & Shareholder Credit in One Ledger
          </h1>
          <p className="text-sm leading-relaxed text-emerald-100/90">
            Built for agricultural supply cooperatives with dual-unit sack/kilogram stock control,
            offline-resilient POS synchronization, verified fixed share capital, and 6× capital-backed
            member loans.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-white/15 pt-5 text-xs text-emerald-100">
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

      <p className="text-xs text-emerald-200/75">
        Argivit Agricultural Supply Cooperative · Authoritative Transaction & Inventory System
      </p>
    </div>
  );
}
