import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Mail, ShieldCheck, User as UserIcon, Wallet } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDateTime, formatPHP } from '../../lib/productAssets';
import { useAppStore } from '../../stores/app-store';
import type { AuthSession, ShareCapitalAccount, ShareholderProfile } from '../../types/domain';
import { StatusLabel } from '../../components/ui/StateViews';

interface MeShareholderSummary {
  profile: ShareholderProfile;
  capital_account: ShareCapitalAccount;
}

export function ProfileView() {
  const queryClient = useQueryClient();
  const { session, setSession, logout } = useAppStore();

  const user = session?.user;
  const impersonatedBy = session?.impersonated_by ?? null;

  const shareholderQuery = useQuery({
    queryKey: ['shareholder-me-summary'],
    enabled: user?.role === 'shareholder',
    queryFn: async () => (await apiRequest<MeShareholderSummary | null>('/shareholders/me')).data,
  });

  if (!user) return null;

  async function handleSignOut() {
    await apiRequest('/auth/logout', { method: 'POST', signal: AbortSignal.timeout(4500) }).catch(() => {});
    queryClient.clear();
    logout();
  }

  async function handleExitImpersonation() {
    try {
      const res = await apiRequest<AuthSession>('/admin/impersonation', {
        method: 'DELETE',
      });
      setSession(res.data);
      queryClient.invalidateQueries();
    } catch {
      await handleSignOut();
    }
  }

  const initials = user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const shData = shareholderQuery.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Account Summary Card */}
      <section className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] pb-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#14532D] font-display text-lg font-bold text-white">
              {initials || <UserIcon className="h-6 w-6" />}
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-[#0F172A]">{user.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  {user.email}
                </span>
                <span aria-hidden="true">·</span>
                <span className="capitalize font-medium text-[#334155]">{user.role}</span>
              </div>
            </div>
          </div>

          <StatusLabel
            tone={user.account_status === 'active' ? 'green' : 'red'}
            label={user.account_status}
          />
        </div>

        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[#64748B]">Workspace Role</dt>
            <dd className="mt-1 font-medium capitalize text-[#0F172A]">{user.role}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#64748B]">Account Created</dt>
            <dd className="mt-1 font-mono text-xs text-[#334155] tabular-nums">
              {formatDateTime(user.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#64748B]">User ID</dt>
            <dd className="mt-1 truncate font-mono text-xs text-[#334155]">{user.id}</dd>
          </div>
        </dl>

        {impersonatedBy ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-[#92400E]">
            <span>
              Currently impersonated by Admin <strong>{impersonatedBy.name}</strong> ({impersonatedBy.email})
            </span>
            <button
              type="button"
              onClick={handleExitImpersonation}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium text-[#92400E] hover:bg-amber-100"
            >
              Exit Impersonation
            </button>
          </div>
        ) : null}
      </section>

      {/* Shareholder Membership Summary (when signed in as Shareholder) */}
      {user.role === 'shareholder' && shData?.profile ? (
        <section className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#15803D]" />
              <h3 className="font-display text-base font-semibold text-[#0F172A]">
                Cooperative Membership
              </h3>
            </div>
            <StatusLabel
              tone={
                shData.profile.verification_status === 'approved'
                  ? 'green'
                  : shData.profile.verification_status === 'rejected'
                  ? 'red'
                  : 'amber'
              }
              label={shData.profile.verification_status.replace('_', ' ')}
            />
          </div>

          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[#64748B]">Membership Number</dt>
              <dd className="mt-1 font-mono text-xs font-semibold text-[#0F172A]">
                {shData.profile.membership_number}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#64748B]">Contact Number</dt>
              <dd className="mt-1 font-mono text-xs text-[#334155]">
                {shData.profile.contact_number || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#64748B]">Share Capital</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#15803D] tabular-nums">
                <Wallet className="h-3.5 w-3.5" />
                {formatPHP(shData.capital_account?.paid_amount ?? 0)} /{' '}
                {formatPHP(shData.capital_account?.required_amount ?? 5000)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {/* Session & Sign Out */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#E2E8E4] bg-white p-6">
        <div>
          <h3 className="font-display text-base font-semibold text-[#0F172A]">Session</h3>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Sign out to end and revoke your active session on this browser.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 rounded-lg bg-[#DC2626] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 whitespace-nowrap"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </section>
    </div>
  );
}
