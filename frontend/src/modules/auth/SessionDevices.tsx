import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { formatDateTime } from '../../lib/productAssets';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import type { AccountDevice } from '../../types/domain';

export function SessionDevices({
  userId,
  admin = false,
}: {
  userId: string;
  admin?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const path = admin ? '/admin/users/' + encodeURIComponent(userId) + '/sessions' : '/auth/sessions';
  const devices = useQuery({
    queryKey: ['account-devices', userId, admin],
    queryFn: async () => (await apiRequest<AccountDevice[]>(path)).data,
  });

  async function signOut() {
    if (!selected || working) return;
    setWorking(true);
    setError('');
    try {
      await apiRequest('/auth/sessions/' + encodeURIComponent(selected), { method: 'DELETE' });
      await devices.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The device could not be signed out.');
    } finally {
      setWorking(false);
      setSelected(null);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="font-semibold text-slate-900">Sign-in history</h3>
      {devices.isLoading && <p role="status" className="text-sm text-slate-600">Loading devices…</p>}
      {devices.isError && <p role="alert" className="text-sm text-red-700">{devices.error.message}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {devices.data?.length === 0 && <p className="text-sm text-slate-600">No Argivit sessions to display.</p>}
      {devices.data && devices.data.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {devices.data.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{device.current ? 'This session' : device.active ? 'Active session' : 'Ended session'}</p>
                <p className="break-words text-xs text-slate-600">{device.device || 'Device details unavailable'}</p>
                <p className="mt-1 text-xs text-slate-600">Signed in {formatDateTime(device.created_at)}{device.last_active_at ? ' · Last active ' + formatDateTime(device.last_active_at) : ''}</p>
              </div>
              {!admin && device.active && !device.current && (
                <button type="button" onClick={() => setSelected(device.id)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                  Sign out device
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={selected !== null} title="Sign out this device?"
        description="The device will need to sign in again to access Argivit."
        confirmLabel="Sign out device" isPending={working} onConfirm={() => void signOut()}
        onCancel={() => setSelected(null)} />
    </section>
  );
}
