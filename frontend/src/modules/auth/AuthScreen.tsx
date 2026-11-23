import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Leaf, ShieldCheck, Store, UserCheck } from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { STORE_HERO_IMAGE } from '../../lib/productAssets';
import { useAppStore } from '../../stores/app-store';
import type { AuthSession } from '../../types/domain';

const DEMO_ACCOUNTS = [
  {
    role: 'Admin',
    name: 'Elena Rostova',
    email: 'admin@argivitstore.com',
    scope: 'Full system · Users · Settings · Impersonation',
  },
  {
    role: 'Manager',
    name: 'Marco Santos',
    email: 'manager@argivitstore.com',
    scope: 'Approvals · Inventory · Loans · Reports',
  },
  {
    role: 'Cashier',
    name: 'Lea Mendoza',
    email: 'cashier@argivitstore.com',
    scope: 'POS Terminal · Offline Sync · Pre-order Pickup',
  },
  {
    role: 'Shareholder',
    name: 'Mateo Cruz',
    email: 'mateo@argivitstore.com',
    scope: 'Online Shop · Membership · Loans (6× Capital)',
  },
];

export function AuthScreen() {
  const setSession = useAppStore((s) => s.setSession);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    let active = true;
    void apiRequest<{ auth_url: string | null; demo_accounts: boolean }>('/auth/config')
      .then((res) => {
        if (active) setShowDemo(res.data.demo_accounts);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function showError(error: unknown) {
    setErrorMsg(error instanceof Error ? error.message : 'Authentication failed. Please retry.');
    setFieldErrors(error instanceof ApiError ? error.errors ?? {} : {});
  }

  async function handleLogin(targetEmail: string, targetPassword: string) {
    setLoading(true);
    setErrorMsg(null);
    setFieldErrors({});
    try {
      const res = await apiRequest<AuthSession>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail, password: targetPassword }),
      });
      setSession(res.data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'login') {
      await handleLogin(email, password);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setFieldErrors({});
    try {
      const profile = { first_name: firstName, last_name: lastName, contact_number: contactNumber, address };
      const res = await apiRequest<AuthSession>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ ...profile, email, password }),
      });
      setSession(res.data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F9F8] text-[#0F172A] lg:grid lg:grid-cols-12">
      {/* Left Cooperative Showcase Column */}
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

      {/* Right Authentication Form Column */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:col-span-6">
        <div className="mx-auto w-full max-w-md space-y-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#15803D] text-white">
                <Leaf className="h-4 w-4" />
              </div>
              <span className="font-display text-lg font-bold text-[#0F172A]">Argivit Store</span>
            </div>

            <div className="inline-flex rounded-lg border border-[#E2E8E4] bg-white p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg(null);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-[#15803D] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg(null);
                  setEmail('');
                  setPassword('');
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-[#15803D] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                Register Shareholder
              </button>
            </div>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-[#0F172A]">
              {mode === 'login' ? 'Sign in to your workspace' : 'New shareholder registration'}
            </h2>
            <p className="mt-1 text-sm text-[#475569]">
              {mode === 'login'
                ? 'Access role-scoped cooperative operations, POS, and member credit.'
                : 'Public accounts default to Shareholder membership and require manager verification.'}
            </p>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#991B1B]"
            >
              {errorMsg}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-first" className="block text-xs font-medium text-[#334155]">
                    First Name
                  </label>
                  <input
                    id="reg-first"
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Juan"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                  />
                  {fieldErrors.first_name ? (
                    <p className="mt-1 text-xs text-[#DC2626]">{fieldErrors.first_name[0]}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="reg-last" className="block text-xs font-medium text-[#334155]">
                    Last Name
                  </label>
                  <input
                    id="reg-last"
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Dela Cruz"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                  />
                </div>
              </div>
            ) : null}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-[#334155]">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@argivitstore.com"
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
              />
              {fieldErrors.email ? (
                <p className="mt-1 text-xs text-[#DC2626]">{fieldErrors.email[0]}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-[#334155]">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
              />
              {fieldErrors.password ? (
                <p className="mt-1 text-xs text-[#DC2626]">{fieldErrors.password[0]}</p>
              ) : null}
            </div>

            {mode === 'register' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-contact" className="block text-xs font-medium text-[#334155]">
                    Contact Number
                  </label>
                  <input
                    id="reg-contact"
                    type="text"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="+63 917 000 0000"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                  />
                </div>
                <div>
                  <label htmlFor="reg-address" className="block text-xs font-medium text-[#334155]">
                    Municipality / Address
                  </label>
                  <input
                    id="reg-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Cabanatuan City"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                  />
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#15803D] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#166534] disabled:opacity-50"
            >
              <span>{loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Shareholder Account'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {mode === 'login' && showDemo ? (
            <div className="border-t border-[#E2E8E4] pt-5">
              <div className="mb-3 text-xs font-medium text-[#475569]">
                Quick Workspace Access (Seeded Roles)
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {DEMO_ACCOUNTS.map((acct) => (
                  <button
                    key={acct.email}
                    type="button"
                    disabled={loading}
                    onClick={() => handleLogin(acct.email, 'Argivit2026!')}
                    className="flex flex-col items-start rounded-lg border border-[#E2E8E4] bg-white px-3.5 py-2.5 text-left transition-colors hover:border-[#15803D] hover:bg-[#F0FDF4]"
                  >
                    <div className="flex w-full items-center justify-between text-xs font-semibold text-[#0F172A]">
                      <span>{acct.role}</span>
                      <span className="font-mono text-[11px] font-normal text-[#15803D]">
                        {acct.name.split(' ')[0]}
                      </span>
                    </div>
                    <span className="mt-0.5 line-clamp-1 text-[11px] text-[#64748B]">{acct.scope}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
