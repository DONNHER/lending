import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';

export function readPasswordResetToken(): string | null {
  const match = /^#reset-password=([0-9a-f]{64})$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

export function PasswordRecoveryView({
  token,
  emailSuggestion = '',
  onBack,
  onReset,
}: {
  token?: string;
  emailSuggestion?: string;
  onBack: () => void;
  onReset?: () => void;
}) {
  const [email, setEmail] = useState(emailSuggestion);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || message) return;
    if (token && password !== confirmation) {
      setError('The passwords must match.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await apiRequest(token ? '/auth/password/reset' : '/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify(token ? { token, password, password_confirmation: confirmation } : { email }),
      });
      setMessage(response.message);
      setPassword('');
      setConfirmation('');
    } catch (cause) {
      const fieldError = cause instanceof ApiError ? Object.values(cause.errors ?? {}).flat()[0] : undefined;
      setError(fieldError || (cause instanceof Error ? cause.message : 'Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  }

  const input = 'mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-4 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100';
  return (
    <main className="grid min-h-screen place-items-center bg-[#F7F9F8] p-5">
      <section aria-labelledby="recovery-title" className="w-full max-w-md space-y-5 rounded-2xl border border-[#E2E8E4] bg-white p-6 sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
          <KeyRound aria-hidden="true" className="h-5 w-5" />
        </div>
        <h1 id="recovery-title" className="text-2xl font-bold text-slate-950">{token ? 'Set a new password' : 'Forgot your password?'}</h1>
        {message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : (
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            {token ? (
              <>
                <p className="text-sm text-slate-600">Use at least eight characters with uppercase and lowercase letters, a number, and a symbol.</p>
                <label className="block text-sm font-semibold">
                  New password
                  <input className={input} type="password" autoComplete="new-password" required minLength={8} maxLength={72}
                    value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <label className="block text-sm font-semibold">
                  Confirm new password
                  <input className={input} type="password" autoComplete="new-password" required
                    value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                </label>
              </>
            ) : (
              <label className="block text-sm font-semibold">
                Account email
                <input className={input} type="email" autoComplete="email" maxLength={254} required
                  value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
            )}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={loading} className="min-h-11 w-full rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              {loading ? 'Working…' : token ? 'Set new password' : 'Email reset link'}
            </button>
          </form>
        )}
        <button type="button" disabled={loading} onClick={token && message ? onReset ?? onBack : onBack}
          className="min-h-10 w-full text-sm font-semibold text-emerald-900 underline underline-offset-4 disabled:opacity-50">
          {token && !message ? 'Cancel' : 'Back to sign in'}
        </button>
      </section>
    </main>
  );
}
