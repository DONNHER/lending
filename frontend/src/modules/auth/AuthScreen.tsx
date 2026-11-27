import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Leaf, ShieldCheck } from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { useAppStore } from '../../stores/app-store';
import type { AuthSession } from '../../types/domain';
import { AuthShowcasePanel } from './AuthShowcasePanel';
import { PasswordRecoveryView } from './PasswordRecoveryView';
import { getDesktopPosBridge } from '../../lib/posOffline';

export type AuthPortal = 'admin' | 'cashier' | 'online-shop';

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

interface EmailChallenge {
  mfa_required: true;
  challenge_id: string;
  email_hint: string;
  expires_in: number;
}

export function AuthScreen({
  portal = 'online-shop',
  onBackToPortal,
}: {
  portal?: AuthPortal;
  onBackToPortal?: () => void;
}) {
  const setSession = useAppStore((s) => s.setSession);
  const allowRegistration = portal === 'online-shop';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const desktopRegister = Boolean(getDesktopPosBridge());
  const [remember, setRemember] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [demoEmails, setDemoEmails] = useState<string[]>([]);
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [code, setCode] = useState('');
  const demoAccounts = DEMO_ACCOUNTS.filter((account) => demoEmails.includes(account.email));

  useEffect(() => {
    let active = true;
    void apiRequest<{ demo_account_emails?: string[]; password_recovery?: boolean }>('/auth/config')
      .then((res) => {
        if (active) {
          setDemoEmails(res.data.demo_account_emails ?? []);
          setRecoveryAvailable(res.data.password_recovery === true);
        }
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

  function completePasswordStep(result: AuthSession | EmailChallenge, targetEmail: string) {
    if ('mfa_required' in result) {
      setEmail(targetEmail);
      setPassword('');
      setCode('');
      setChallenge(result);
      return;
    }
    setSession(result);
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || loading || code.length !== 6) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await apiRequest<AuthSession>('/auth/mfa/verify', {
        method: 'POST', body: JSON.stringify({ challenge_id: challenge.challenge_id, code }),
      });
      setSession(response.data);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(targetEmail: string, targetPassword: string) {
    setLoading(true);
    setErrorMsg(null);
    setFieldErrors({});
    try {
      const res = await apiRequest<AuthSession | EmailChallenge>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail, password: targetPassword, remember: desktopRegister || remember }),
      });
      completePasswordStep(res.data, targetEmail);
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
      const res = await apiRequest<AuthSession | EmailChallenge>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ ...profile, email, password }),
      });
      completePasswordStep(res.data, email);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }

  if (recovering) {
    return <PasswordRecoveryView emailSuggestion={email} onBack={() => setRecovering(false)} />;
  }

  if (challenge) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F7F9F8] p-5">
        <section aria-labelledby="email-code-title" className="w-full max-w-md space-y-5 rounded-2xl border border-[#E2E8E4] bg-white p-6 sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-[#166534]">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h1 id="email-code-title" className="text-2xl font-bold text-slate-950">Check your email</h1>
            <p id="email-code-hint" className="mt-2 break-words text-sm text-slate-600">Enter the six-digit code sent to {challenge.email_hint}. It expires in {Math.ceil(challenge.expires_in / 60)} minutes.</p>
          </div>
          <form onSubmit={verifyCode} className="space-y-4">
            <label htmlFor="email-code" className="block text-sm font-semibold text-slate-800">
              Verification code
              <input id="email-code" autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required
                value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))} aria-invalid={Boolean(errorMsg)}
                aria-describedby={errorMsg ? 'email-code-hint email-code-error' : 'email-code-hint'}
                className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 font-mono text-xl tracking-[0.3em] focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-emerald-100" />
            </label>
            {errorMsg && <p id="email-code-error" role="alert" className="text-sm text-red-700">{errorMsg}</p>}
            <button type="submit" disabled={loading || code.length !== 6} className="min-h-11 w-full rounded-xl bg-[#15803D] px-4 text-sm font-semibold text-white hover:bg-[#166534] disabled:opacity-50">
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </button>
            <button type="button" disabled={loading} onClick={() => { setChallenge(null); setCode(''); setErrorMsg(null); setFieldErrors({}); setMode('login'); }}
              className="min-h-11 w-full text-sm font-semibold text-[#14532D] underline underline-offset-4 disabled:opacity-50">Back to sign in</button>
          </form>
        </section>
      </main>
    );
  }

  const portalMeta = {
    admin: {
      title: 'Admin login',
      subtitle: 'Sign in to cooperative administration, inventory, approvals, and governance.',
    },
    cashier: {
      title: 'Cashier POS login',
      subtitle: 'Sign in to operate the POS register, offline queue, and pre-order pickup.',
    },
    'online-shop': {
      title: mode === 'login' ? 'Online Shop sign in' : 'New shareholder registration',
      subtitle:
        mode === 'login'
          ? 'Sign in to browse the cooperative online shop, orders, and member loans.'
          : 'Public accounts default to Shareholder membership and require manager verification.',
    },
  }[portal];

  return (
    <div className="min-h-screen bg-[#F7F9F8] text-[#0F172A] lg:grid lg:grid-cols-12">
      <AuthShowcasePanel />

      {/* Right Authentication Form Column */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:col-span-6">
        <div className="mx-auto w-full max-w-md space-y-7">
          {onBackToPortal ? (
            <button
              type="button"
              onClick={onBackToPortal}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#15803D] hover:text-[#166534]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to portal selection
            </button>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#15803D] text-white">
                <Leaf className="h-4 w-4" />
              </div>
              <span className="font-display text-lg font-bold text-[#0F172A]">Argivit Store</span>
            </div>

            {allowRegistration ? (
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
            ) : null}
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-[#0F172A]">
              {portalMeta.title}
            </h2>
            <p className="mt-1 text-sm text-[#475569]">
              {portalMeta.subtitle}
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
                minLength={mode === 'register' ? 8 : undefined}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
              />
              {mode === 'register' && <p className="mt-1 text-xs text-slate-600">Use at least eight characters with uppercase and lowercase letters, a number, and a symbol.</p>}
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

            {mode === 'login' && (!desktopRegister || recoveryAvailable) && (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                {!desktopRegister && (
                  <label className="inline-flex min-h-8 items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-emerald-700" checked={remember}
                      onChange={(event) => setRemember(event.target.checked)} />
                    Remember me
                  </label>
                )}
                {recoveryAvailable && (
                  <button type="button" disabled={loading} onClick={() => { setPassword(''); setErrorMsg(null); setRecovering(true); }}
                    className="ml-auto min-h-8 font-semibold text-emerald-800 underline underline-offset-4">
                    Forgot password?
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#15803D] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#166534] disabled:opacity-50"
            >
              <span>{loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Shareholder Account'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {mode === 'login' && demoAccounts.length > 0 ? (
            <div className="border-t border-[#E2E8E4] pt-5">
              <div className="mb-3 text-xs font-medium text-[#475569]">
                Quick Workspace Access (Seeded Roles)
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {demoAccounts.map((acct) => (
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
