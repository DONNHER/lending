import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../../lib/api';
import { useTranslate, type MessageKey } from '../../lib/language';
import { isPosConnectionError } from '../../lib/posOffline';
import { canAccessWorkspace, useAppStore } from '../../stores/app-store';

export function usePosSync() {
  const queryClient = useQueryClient();
  const t = useTranslate();
  const { session, terminalId, offlineMode, setOfflineMode, offlineOutbox, removeSyncedEvents } = useAppStore();
  const user = session?.user;
  const enabled = Boolean(user && canAccessWorkspace(user.role, 'pos') && !session?.impersonated_by);
  const [syncMessage, setSyncMessage] = useState<{ tone: 'green' | 'amber' | 'red'; message: MessageKey; count?: number } | null>(null);
  const attempted = useRef('');
  const health = useQuery({
    queryKey: ['api-connectivity', user?.id],
    enabled: Boolean(user),
    networkMode: 'always',
    retry: false,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    queryFn: async ({ signal }) => {
      try {
        const response = await fetch('/api/v1/health', {
          cache: 'no-store',
          signal: AbortSignal.any([signal, AbortSignal.timeout(3500)]),
        });
        if (!response.ok) throw new Error('POS service is unavailable.');
        if (!signal.aborted) setOfflineMode(!navigator.onLine);
        return true;
      } catch (error) {
        if (!signal.aborted) setOfflineMode(true);
        throw error;
      }
    },
  });
  const { refetch } = health;

  useEffect(() => {
    if (!user) return;
    function handleOffline() { setOfflineMode(true); }
    function handleOnline() { void refetch(); }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    if (!navigator.onLine) handleOffline();
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [user, refetch, setOfflineMode]);

  const pendingEvents = offlineOutbox.filter((event) =>
    event.terminal_id === terminalId && (!event.cashier_id || event.cashier_id === user?.id)
  );

  const { mutate: sync, isPending } = useMutation({
    networkMode: 'always',
    mutationFn: (events: typeof pendingEvents) => apiRequest<{
      results: Array<{ event_id: string; status: string; reason?: string }>;
    }>('/sync/batches', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ terminal_id: terminalId, events }),
    }),
    onSuccess: async ({ data }) => {
      const conflicts = data.results.filter((result) => result.status === 'conflict');
      const completed = data.results.filter((result) =>
        ['processed', 'duplicate_ignored', 'conflict'].includes(result.status)
      );
      setSyncMessage(conflicts.length
        ? { tone: 'amber', message: '{count} offline sale(s) need manager review in Settings → Offline Sync & Conflicts.', count: conflicts.length }
        : { tone: 'green', message: '{count} offline sale(s) synced.', count: completed.length });
      try {
        await removeSyncedEvents(completed.map((result) => result.event_id));
      } catch {
        setSyncMessage({ tone: 'red', message: 'Sales reached the server, but the register could not update its queue.' });
      }
      await Promise.all(['pos-catalog-cache', 'pos-product-search', 'pos-sales', 'reports-overview', 'sync-telemetry']
        .map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error) => {
      if (isPosConnectionError(error)) setOfflineMode(true);
      setSyncMessage({ tone: 'red', message: error instanceof ApiError && error.status === 401
        ? 'Sign in again to sync saved sales.'
        : 'Sales are still saved on this computer. Sync will retry when the server responds.' });
    },
  });

  useEffect(() => {
    if (!enabled || offlineMode || !health.isSuccess || isPending || !pendingEvents.length) return;
    const attempt = `${health.dataUpdatedAt}:${pendingEvents[0].event_id}`;
    if (attempted.current === attempt) return;
    attempted.current = attempt;
    sync(pendingEvents.slice(0, 50));
  }, [enabled, offlineMode, health.isSuccess, health.dataUpdatedAt, isPending, pendingEvents, sync]);

  return {
    isSyncing: isPending,
    syncMessage: syncMessage && {
      tone: syncMessage.tone,
      text: t(syncMessage.message, { count: syncMessage.count ?? 0 }),
    },
  };
}
