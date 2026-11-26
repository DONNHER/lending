import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Settings2, X } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDateTime } from '../../lib/productAssets';
import type { AuthSession } from '../../types/domain';

const kinds = { system: 'System updates', warning: 'Warnings', critical: 'Security and critical alerts', reminder: 'Reminders' } as const;
type Kind = keyof typeof kinds;

interface Notice {
  id: string;
  kind: Kind;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

interface Inbox {
  items: Notice[];
  unread: number;
  preferences: Record<Kind, boolean>;
  stream_enabled: boolean;
}

async function streamInbox(token: string, signal: AbortSignal, onUpdate: (snapshot: Inbox) => void) {
  const response = await fetch('/api/v1/notifications/events', {
    signal, headers: { Authorization: 'Bearer ' + token, Accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
    throw new Error('Notification stream did not open.');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      buffer += next.value;
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.startsWith('data: ')) {
          onUpdate(JSON.parse(frame.slice(6)) as Inbox);
        }
        end = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type InboxAction =
  | { type: 'read' }
  | { type: 'remove'; id: string }
  | { type: 'preference'; kind: Kind; enabled: boolean };

export function NotificationBell({ session, offline }: { session: AuthSession; offline: boolean }) {
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const queryKey = ['notifications', session.user.id];
  const [open, setOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const inbox = useQuery({
    queryKey, enabled: !offline, refetchInterval: 15_000,
    queryFn: async () => (await apiRequest<Inbox>('/notifications')).data,
  });
  const stream = inbox.data?.stream_enabled && Boolean(session.session) && !session.impersonated_by;
  const userId = session.user.id;
  const token = session.token;

  useEffect(() => {
    if (!stream || offline) return;
    const controller = new AbortController();
    let next: number | undefined;

    const connect = async () => {
      try {
        await streamInbox(token, controller.signal, (snapshot) => {
          if (!controller.signal.aborted) queryClient.setQueryData(['notifications', userId], snapshot);
        });
      } catch {
        // The regular inbox request remains available if a proxy closes the stream.
      }
      if (!controller.signal.aborted) next = window.setTimeout(() => { void connect(); }, 5000);
    };

    void connect();
    return () => {
      controller.abort();
      window.clearTimeout(next);
    };
  }, [offline, queryClient, stream, token, userId]);

  const action = useMutation({
    mutationFn: async (request: InboxAction) => {
      if (request.type === 'read') return apiRequest('/notifications/read-all', { method: 'POST' });
      if (request.type === 'remove') return apiRequest('/notifications/' + encodeURIComponent(request.id), { method: 'DELETE' });
      return apiRequest('/notifications/preferences', {
        method: 'PATCH', body: JSON.stringify({ kind: request.kind, enabled: request.enabled }),
      });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey }); },
  });
  const total = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];
  const actionDisabled = offline || action.isPending;

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div className="relative" onKeyDown={(event) => { if (open && event.key === 'Escape') close(); }}>
      <button ref={button} type="button" aria-label={total ? 'Notifications, ' + total + ' unread' : 'Notifications'}
        aria-controls={panelId} aria-expanded={open} onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 text-slate-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700">
        <Bell aria-hidden="true" className="h-5 w-5" />
        {total > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-emerald-800 px-0.5 text-[10px] font-bold text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <section id={panelId} aria-label="Notification inbox"
          className="absolute right-0 top-full z-40 mt-2 w-[min(23rem,calc(100vw_-_2rem))] rounded-xl border border-slate-200 bg-white shadow-xl">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold text-slate-950">Notifications</h2>
            <div className="flex gap-2">
              <button type="button" aria-label="Notification preferences" aria-expanded={preferencesOpen}
                onClick={() => setPreferencesOpen(!preferencesOpen)} className="rounded p-2 hover:bg-slate-100">
                <Settings2 aria-hidden="true" className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Close notifications" onClick={close} className="rounded p-2 hover:bg-slate-100">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </header>
          <div className="max-h-[min(24rem,calc(100dvh_-_9rem))] overflow-y-auto">
            {offline && <p className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">Reconnect to update your notifications.</p>}
            {action.isError && <p role="alert" className="px-4 py-2 text-xs text-red-700">{action.error.message}</p>}
            {preferencesOpen ? (
              <fieldset className="space-y-3 p-4 text-sm">
                <legend className="pt-3 font-medium">In-app notifications</legend>
                {(Object.keys(kinds) as Kind[]).map((kind) => (
                  <label key={kind} className="flex items-center gap-2">
                    <input type="checkbox" checked={inbox.data?.preferences?.[kind] ?? true} disabled={actionDisabled}
                      onChange={(event) => action.mutate({ type: 'preference', kind, enabled: event.target.checked })}
                      className="h-4 w-4 accent-emerald-700" />
                    {kinds[kind]}
                  </label>
                ))}
              </fieldset>
            ) : (
              <>
                {total > 0 && (
                  <div className="flex justify-end border-b border-slate-200 px-4 py-2">
                    <button type="button" disabled={actionDisabled} onClick={() => action.mutate({ type: 'read' })}
                      className="text-xs font-semibold text-emerald-800 underline underline-offset-4 disabled:opacity-50">
                      Mark all as read
                    </button>
                  </div>
                )}
                {inbox.isError && <p role="alert" className="p-4 text-sm text-red-700">{inbox.error.message}</p>}
                {inbox.isLoading && <p role="status" className="p-4 text-sm text-slate-600">Loading notifications…</p>}
                {!inbox.isLoading && !inbox.isError && items.length === 0 && <p className="p-4 text-sm text-slate-600">No notifications yet.</p>}
                <ul className="divide-y divide-slate-200">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-600">{kinds[item.kind]}{item.read_at ? '' : ' · Unread'}</p>
                        <p className="mt-0.5 text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="break-words text-sm text-slate-700">{item.message}</p>
                        <p className="mt-1 text-xs text-slate-600">{formatDateTime(item.created_at)}</p>
                      </div>
                      <button type="button" aria-label={'Remove ' + item.title} disabled={actionDisabled}
                        onClick={() => action.mutate({ type: 'remove', id: item.id })}
                        className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
