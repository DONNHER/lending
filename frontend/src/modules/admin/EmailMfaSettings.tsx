import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface EmailMfaPolicy {
  enabled: boolean;
  can_configure: boolean;
}

interface EmailChallenge {
  challenge_id: string;
  email_hint: string;
  expires_in: number;
}

const POLICY_ENDPOINT = '/admin/security/email-mfa';

export function EmailMfaSettings({ userId }: { userId: string }) {
  const queryKey = ['admin-email-mfa', userId];
  const queryClient = useQueryClient();
  const policyQuery = useQuery({
    queryKey,
    queryFn: async () => (await apiRequest<EmailMfaPolicy>(POLICY_ENDPOINT)).data,
  });
  const [target, setTarget] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const policy = policyQuery.data;
  const action = target ? 'Enable' : 'Disable';

  function closeConfirmation() {
    setTarget(null);
    setPassword('');
    setChallenge(null);
    setCode('');
    setError('');
  }

  async function confirmChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (target === null || busy) return;
    setError('');
    setBusy(true);

    try {
      if (!challenge) {
        const { data } = await apiRequest<EmailChallenge>(`${POLICY_ENDPOINT}/challenge`, {
          method: 'POST',
          body: JSON.stringify({ enabled: target, password }),
        });
        setChallenge(data);
      } else {
        const { data } = await apiRequest<EmailMfaPolicy>(POLICY_ENDPOINT, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: target, challenge_id: challenge.challenge_id, code }),
        });
        queryClient.setQueryData(queryKey, data);
        void queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
        closeConfirmation();
        setNotice(data.enabled ? 'Email MFA enabled for all accounts.' : 'Email MFA disabled for all accounts.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The setting could not be changed.');
    } finally {
      setPassword('');
      setCode('');
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="email-mfa-heading" className="max-w-xl space-y-4 rounded-xl border border-[#E2E8E4] bg-white p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        <h2 id="email-mfa-heading" className="font-display text-base font-semibold text-slate-900">Email MFA</h2>
        {policy && <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${policy.enabled ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>{policy.enabled ? 'Enabled' : 'Disabled'}</span>}
      </div>

      {policyQuery.isLoading && <p role="status" className="text-sm text-slate-700">Loading email MFA settings…</p>}
      {policyQuery.isError && !policy && (
        <div role="alert" className="text-sm text-red-800">
          <p>{policyQuery.error.message}</p>
          <button type="button" onClick={() => void policyQuery.refetch()} className="mt-2 font-semibold underline">Try again</button>
        </div>
      )}
      {policy && (
        <>
          <p className="text-sm text-slate-700">When enabled, all accounts enter an email verification code at sign-in.</p>
          {!policy.can_configure && <p className="text-sm text-amber-900">This deployment manages MFA through its external sign-in provider.</p>}
          {target === null && policy.can_configure && (
            <button type="button" onClick={() => { setNotice(''); setTarget(!policy.enabled); }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:border-emerald-700 hover:text-emerald-900">
              {policy.enabled ? 'Disable email MFA' : 'Enable email MFA'}
            </button>
          )}
        </>
      )}
      {notice && <p role="status" className="text-sm font-medium text-emerald-800">{notice}</p>}

      {target !== null && (
        <form onSubmit={(event) => void confirmChange(event)} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">{action} email MFA for all accounts</h3>
          {challenge ? (
            <>
              <p className="text-sm text-slate-700">Enter the six-digit code sent to {challenge.email_hint}. It expires in {Math.ceil(challenge.expires_in / 60)} minutes.</p>
              <label htmlFor="mfa-policy-code" className="block text-sm font-medium text-slate-800">Email verification code</label>
              <input id="mfa-policy-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required disabled={busy}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm" />
            </>
          ) : (
            <>
              <label htmlFor="mfa-policy-password" className="block text-sm font-medium text-slate-800">Current administrator password</label>
              <input id="mfa-policy-password" type="password" autoComplete="current-password" required
                value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </>
          )}
          {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || (challenge ? code.length !== 6 : !password)}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
              {busy ? (challenge ? 'Verifying…' : 'Sending…') : challenge ? `${action} email MFA` : 'Send verification code'}
            </button>
            <button type="button" onClick={closeConfirmation} disabled={busy}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60">Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
