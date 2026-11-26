import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { apiRequest } from '../../lib/api';
import type { User } from '../../types/domain';
import { SessionDevices } from '../auth/SessionDevices';

type Action = 'password-reset' | 'force-logout';

export function UserSecurityPanel({ user, onClose }: { user: User; onClose: () => void }) {
  const cache = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);

  async function submit() {
    if (!action || working) return;
    setWorking(true);
    setFeedback(null);
    try {
      const response = await apiRequest('/admin/users/' + encodeURIComponent(user.id) + '/' + action, { method: 'POST' });
      setFeedback({ error: false, text: response.message });
      void cache.invalidateQueries({ queryKey: ['account-devices', user.id] });
      void cache.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : 'The action did not complete.' });
    } finally {
      setAction(null);
      setWorking(false);
    }
  }

  const forceLogout = action === 'force-logout';
  return (
    <section aria-label={'Account security for ' + user.name} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">{user.name}</h2>
          <p className="text-sm text-slate-600">{user.email}</p>
        </div>
        <button type="button" aria-label="Close account security" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setAction('password-reset')} disabled={user.account_status !== 'active'}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
          Send password reset link
        </button>
        <button type="button" onClick={() => setAction('force-logout')}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-800">
          Sign out all devices
        </button>
      </div>
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-sm text-red-700' : 'text-sm text-emerald-800'}>{feedback.text}</p>}
      <SessionDevices userId={user.id} admin />
      <ConfirmDialog open={action !== null} title={forceLogout ? 'Sign out all devices?' : 'Send a password reset link?'}
        description={forceLogout
          ? (user.role === 'cashier' ? 'Queued offline sales stay on the cashier device. The cashier will need to sign in again to sync them.' : 'This account will need to sign in again on each device.')
          : 'The link will be sent to ' + user.email + ' and expires in 30 minutes.'}
        confirmLabel={forceLogout ? 'Sign out devices' : 'Send reset link'}
        tone={forceLogout ? 'red' : 'green'} isPending={working}
        onConfirm={() => void submit()} onCancel={() => setAction(null)} />
    </section>
  );
}
