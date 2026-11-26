import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import type { SessionStatus } from '../../types/domain';

export function SessionGuard({
  token,
  initial,
  offline,
  onExpired,
}: {
  token: string;
  initial: SessionStatus;
  offline: boolean;
  onExpired: () => void;
}) {
  const [session, setSession] = useState(initial);
  const [clock, setClock] = useState(Date.now);
  const [requestPending, setRequestPending] = useState(false);
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const deadline = Date.parse(session.expires_at);

  useEffect(() => {
    setRequestPending(false);
    let active = true;
    let dirty = false;
    let updating = false;
    let nextPoll = Date.now() + 60_000;
    let nextActivity = 0;

    const refreshStatus = async (activity: boolean) => {
      if (!active || updating || offline || !navigator.onLine || document.hidden) return;
      if (activity && Date.now() < nextActivity) return;
      if (activity) nextActivity = Date.now() + 10_000;
      updating = true;
      setRequestPending(true);
      const headers = { Authorization: 'Bearer ' + token };
      try {
        if (activity) {
          dirty = false;
          const { data } = await apiRequest<SessionStatus | null>('/auth/session/activity', {
            method: 'POST', headers, signal: AbortSignal.timeout(5000),
          });
          if (active && data) setSession(data);
        } else {
          const { data } = await apiRequest<{ session: SessionStatus | null }>('/auth/me', {
            headers, signal: AbortSignal.timeout(5000),
          });
          if (active && data.session) setSession(data.session);
        }
      } catch (error) {
        if (active && error instanceof ApiError && (error.status === 401 || error.status === 403)) onExpired();
      } finally {
        updating = false;
        if (active) setRequestPending(false);
      }
    };
    refresh.current = () => refreshStatus(true);
    const record = (event: Event) => {
      if (!event.isTrusted) return;
      dirty = true;
      if (deadline - Date.now() <= 60_000 && Date.now() >= nextActivity) {
        nextPoll = updating ? 0 : Date.now() + 60_000;
        void refreshStatus(true);
      }
    };
    const tick = () => {
      const now = Date.now();
      setClock(now);
      if (now >= nextPoll && !updating && !document.hidden) {
        nextPoll = now + 60_000;
        void refreshStatus(dirty);
      }
    };
    const onVisible = () => { if (!document.hidden) { nextPoll = 0; tick(); } };
    window.addEventListener('pointerdown', record, { passive: true });
    window.addEventListener('keydown', record);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const timer = window.setInterval(tick, 1000);
    return () => {
      active = false;
      refresh.current = null;
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', record);
      window.removeEventListener('keydown', record);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [token, deadline, offline, onExpired]);

  useEffect(() => {
    // The cached cashier still needs its local queue during a service outage.
    if (!offline || session.idle_timeout) {
      if (clock >= deadline && !requestPending) onExpired();
    }
  }, [clock, deadline, offline, onExpired, requestPending, session.idle_timeout]);

  const seconds = Math.ceil((deadline - clock) / 1000);
  if (seconds > 300 || seconds <= 0 || (offline && !session.idle_timeout)) return null;
  const minutes = Math.ceil(seconds / 60);

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span>Your session expires in {minutes} {minutes === 1 ? 'minute' : 'minutes'}. {session.idle_timeout ? 'Save your work or stay signed in.' : 'Sign in again when it ends.'}</span>
      {session.idle_timeout && !offline && (
        <button type="button" onClick={() => void refresh.current?.()} disabled={requestPending} className="rounded-lg border border-amber-700 px-3 py-1.5 font-semibold">
          Stay signed in
        </button>
      )}
    </div>
  );
}
