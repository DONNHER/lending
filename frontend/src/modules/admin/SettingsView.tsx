import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  HardDrive,
  RefreshCw,
  Search,
  Shield,
  UserCog,
} from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/productAssets';
import { exportAuditLogsDataset } from '../../lib/reportExport';
import { useAppStore } from '../../stores/app-store';
import type {
  AuditLog,
  AuthSession,
  BackupMonitoringRecord,
  ExportLogRecord,
  ImportLogRecord,
  ScheduledTaskRecord,
  SyncConflictRecord,
  User,
  UserRole,
} from '../../types/domain';
import { ConfirmDialog, type ConfirmDetailRow } from '../../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';
import { EmailMfaSettings } from './EmailMfaSettings';
import { UserSecurityPanel } from './UserSecurityPanel';

type PendingAdminTx =
  | { kind: 'policy' }
  | { kind: 'backup' }
  | { kind: 'resolve_conflict'; id: string; productName: string; terminalId: string; reason: string }
  | { kind: 'status'; id: string; userName: string; nextStatus: 'active' | 'disabled' }
  | { kind: 'role'; id: string; userName: string; currentRole: UserRole; nextRole: UserRole }
  | { kind: 'impersonate'; id: string; userName: string; email: string; role: UserRole };

interface AdminGovernancePayload {
  import_logs: ImportLogRecord[];
  export_logs: ExportLogRecord[];
  backups: BackupMonitoringRecord[];
  scheduled_tasks: ScheduledTaskRecord[];
  rate_limits: {
    tiers: Array<{ tier: string; limit_per_min: number; scope: string }>;
    active_buckets: Array<{ key: string; hits: number; blocked: number; reset_at: string }>;
  };
  system_health: {
    database_size_bytes: number;
    total_products: number;
    total_sales: number;
    total_audit_logs: number;
    retention_policy: string;
    backup_schedule: string;
  };
}

export function SettingsView() {
  const queryClient = useQueryClient();
  const { session, setSession, subTabs, setWorkspaceSubTab } = useAppStore();
  const isAdmin = session?.user.role === 'admin';

  const tab = subTabs.settings;
  const setTab = (next: 'users' | 'policy' | 'sync' | 'audit' | 'data') =>
    setWorkspaceSubTab('settings', next);
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingAdminTx | null>(null);
  const [securityUserId, setSecurityUserId] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditScope, setAuditScope] = useState('active');
  const [auditAfter, setAuditAfter] = useState('');
  const [auditBefore, setAuditBefore] = useState('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  const [reqCapital, setReqCapital] = useState('5000');
  const [multiplier, setMultiplier] = useState('6');
  const [interestRate, setInterestRate] = useState('0.06');
  const [waitingDays, setWaitingDays] = useState('7');

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await apiRequest<User[]>('/users')).data,
  });

  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () =>
      (
        await apiRequest<{
          share_capital: { required_initial_capital: number };
          loan: { capital_multiplier: number; interest_rate: number; waiting_period_days: number };
        }>('/admin/settings')
      ).data,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setReqCapital(String(settingsQuery.data.share_capital.required_initial_capital));
      setMultiplier(String(settingsQuery.data.loan.capital_multiplier));
      setInterestRate(String(settingsQuery.data.loan.interest_rate));
      setWaitingDays(String(settingsQuery.data.loan.waiting_period_days));
    }
  }, [settingsQuery.data]);

  const syncQuery = useQuery({
    queryKey: ['sync-telemetry'],
    enabled: tab === 'sync',
    queryFn: async () =>
      (
        await apiRequest<{
          conflicts: SyncConflictRecord[];
          batches: Array<{
            id: string;
            terminal_id: string;
            received_count: number;
            processed_count: number;
            duplicate_count: number;
            conflict_count: number;
            created_at: string;
          }>;
          terminals: Array<{
            id: string;
            terminal_code: string;
            location_name: string;
            last_sync_at: string | null;
          }>;
        }>('/sync/conflicts')
      ).data,
  });

  const auditQuery = useQuery({
    queryKey: ['admin-audit-logs', auditSearch, auditActionFilter, auditScope, auditAfter, auditBefore],
    enabled: tab === 'audit',
    queryFn: async () => {
      const qs = new URLSearchParams({ scope: auditScope });
      if (auditSearch.trim()) qs.set('q', auditSearch.trim());
      if (auditActionFilter.trim()) qs.set('action', auditActionFilter.trim());
      if (auditAfter) qs.set('after', auditAfter);
      if (auditBefore) qs.set('before', auditBefore);
      return (await apiRequest<AuditLog[]>(`/admin/audit-logs?${qs}`)).data;
    },
  });

  const governanceQuery = useQuery({
    queryKey: ['admin-governance'],
    enabled: tab === 'data',
    queryFn: async () => (await apiRequest<AdminGovernancePayload>('/admin/governance')).data,
  });

  const statusMutation = useMutation({
    mutationFn: async (params: { id: string; account_status: 'active' | 'disabled' }) =>
      apiRequest(`/users/${params.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ account_status: params.account_status }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Update failed.' });
    },
  });

  const roleMutation = useMutation({
    mutationFn: async (params: { id: string; role: UserRole }) =>
      apiRequest(`/users/${params.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: params.role }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Role update failed.' });
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async (targetUserId: string) =>
      apiRequest<AuthSession>('/admin/impersonation', {
        method: 'POST',
        body: JSON.stringify({ target_user_id: targetUserId }),
      }),
    onSuccess: (res) => {
      setSession(res.data);
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Impersonation failed.' });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async () =>
      apiRequest('/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          required_initial_capital: Number(reqCapital),
          capital_multiplier: Number(multiplier),
          interest_rate: Number(interestRate),
          waiting_period_days: Number(waitingDays),
        }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      queryClient.invalidateQueries({ queryKey: ['loans-dashboard'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Save failed.' });
    },
  });

  const resolveConflictMutation = useMutation({
    mutationFn: async (params: {
      id: string;
      resolution: 'accepted_negative_adjustment' | 'voided';
    }) =>
      apiRequest(`/sync/conflicts/${params.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution: params.resolution }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['sync-telemetry'] });
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Conflict resolution failed.' });
    },
  });

  const triggerBackupMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{
        id: string;
        backup_type: string;
        size_bytes: number;
        status: string;
        created_at: string;
      }>('/admin/backups/trigger', { method: 'POST' }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['admin-governance'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Manual backup failed.' });
    },
  });

  function handleSavePolicy(e: FormEvent) {
    e.preventDefault();
    setPendingTx({ kind: 'policy' });
  }

  async function handleExportAudit(format: 'csv' | 'pdf' | 'xlsx') {
    const rows = auditQuery.data || [];
    if (rows.length === 0) return;
    const filename = exportAuditLogsDataset(rows, format);
    try {
      await apiRequest('/reports/export-logs', {
        method: 'POST',
        body: JSON.stringify({
          export_type: 'audit_logs',
          format,
          period: 'all',
          row_count: rows.length,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['admin-governance'] });
    } catch {
      // Non-blocking audit export telemetry
    }
    setFeedback({ tone: 'green', text: `Exported ${rows.length} audit record(s) to ${filename}.` });
  }

  let confirmConfig: {
    title: string;
    description: string;
    details: ConfirmDetailRow[];
    confirmLabel: string;
    tone: 'green' | 'amber' | 'red';
    onConfirm: () => void;
  } | null = null;

  if (pendingTx?.kind === 'policy') {
    confirmConfig = {
      title: 'Confirm Cooperative Policy Update',
      description:
        'Apply updated share capital and loan policy parameters across the cooperative platform.',
      details: [
        { label: 'Required Share Capital', value: `PHP ${Number(reqCapital).toLocaleString()}` },
        { label: 'Loan Multiplier', value: `${multiplier}×` },
        { label: 'Interest Rate', value: `${(Number(interestRate) * 100).toFixed(2)}%` },
        { label: 'Waiting Period', value: `${waitingDays} days` },
      ],
      confirmLabel: 'Confirm & Save Policy',
      tone: 'amber',
      onConfirm: () => {
        saveSettingsMutation.mutate(undefined, { onSettled: () => setPendingTx(null) });
      },
    };
  } else if (pendingTx?.kind === 'backup') {
    confirmConfig = {
      title: 'Confirm Manual Full Database Backup',
      description:
        'Run an immediate SQLite integrity check (PRAGMA quick_check) and record a verified local encrypted backup snapshot.',
      details: [
        { label: 'Backup Type', value: 'manual_full' },
        { label: 'Retention Tier', value: '7 daily' },
        {
          label: 'Database Size',
          value: governanceQuery.data
            ? `${Math.max(1, Math.round(governanceQuery.data.system_health.database_size_bytes / 1024))} KB`
            : 'Live Ledger',
        },
      ],
      confirmLabel: 'Run Backup Now',
      tone: 'green',
      onConfirm: () => {
        triggerBackupMutation.mutate(undefined, { onSettled: () => setPendingTx(null) });
      },
    };
  } else if (pendingTx?.kind === 'resolve_conflict') {
    confirmConfig = {
      title: 'Confirm Sync Conflict Reconciliation',
      description:
        'Accept and reconcile this offline POS synchronization conflict into central warehouse inventory.',
      details: [
        { label: 'Product', value: pendingTx.productName },
        { label: 'Terminal', value: pendingTx.terminalId },
        { label: 'Reason', value: pendingTx.reason },
      ],
      confirmLabel: 'Confirm & Reconcile',
      tone: 'amber',
      onConfirm: () => {
        resolveConflictMutation.mutate(
          { id: pendingTx.id, resolution: 'accepted_negative_adjustment' },
          { onSettled: () => setPendingTx(null) }
        );
      },
    };
  } else if (pendingTx?.kind === 'status') {
    const isDisable = pendingTx.nextStatus === 'disabled';
    confirmConfig = {
      title: isDisable ? 'Confirm Account Disable' : 'Confirm Account Enable',
      description: isDisable
        ? 'Disable this user account and revoke active access immediately.'
        : 'Re-enable this user account and restore cooperative access.',
      details: [
        { label: 'User', value: pendingTx.userName },
        { label: 'New Status', value: pendingTx.nextStatus.toUpperCase() },
      ],
      confirmLabel: isDisable ? 'Disable Account' : 'Enable Account',
      tone: isDisable ? 'red' : 'green',
      onConfirm: () => {
        statusMutation.mutate(
          { id: pendingTx.id, account_status: pendingTx.nextStatus },
          { onSettled: () => setPendingTx(null) }
        );
      },
    };
  } else if (pendingTx?.kind === 'role') {
    confirmConfig = {
      title: 'Confirm Role Change',
      description: 'Update the assigned cooperative permission role for this user account.',
      details: [
        { label: 'User', value: pendingTx.userName },
        { label: 'Current Role', value: pendingTx.currentRole },
        { label: 'New Role', value: pendingTx.nextRole },
      ],
      confirmLabel: 'Confirm Role Change',
      tone: 'amber',
      onConfirm: () => {
        roleMutation.mutate(
          { id: pendingTx.id, role: pendingTx.nextRole },
          { onSettled: () => setPendingTx(null) }
        );
      },
    };
  } else if (pendingTx?.kind === 'impersonate') {
    confirmConfig = {
      title: 'Confirm User Impersonation',
      description: 'Switch your active session to view the platform as this user.',
      details: [
        { label: 'Target User', value: pendingTx.userName },
        { label: 'Email', value: pendingTx.email },
        { label: 'Role', value: pendingTx.role },
      ],
      confirmLabel: 'Confirm Impersonation',
      tone: 'amber',
      onConfirm: () => {
        impersonateMutation.mutate(pendingTx.id, { onSettled: () => setPendingTx(null) });
      },
    };
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#E2E8E4] bg-white p-1 w-fit">
        {(
          [
            { id: 'users', label: 'Users & Roles' },
            { id: 'policy', label: 'Capital & Loan Policy' },
            { id: 'sync', label: 'Offline Sync & Conflicts' },
            { id: 'audit', label: 'Audit Logs' },
            { id: 'data', label: 'Data & Backups' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              tab === t.id ? 'bg-[#15803D] text-white' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback ? (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'green'
              ? 'border-emerald-200 bg-emerald-50 text-[#14532D]'
              : 'border-red-200 bg-red-50 text-[#991B1B]'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {tab === 'users' ? (
        <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
          <div className="border-b border-[#E2E8E4] px-5 py-4">
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Users, Role Provisioning & Admin Impersonation
            </h2>
            <p className="text-xs text-[#64748B]">
              Admin and manager privileges are strictly controlled server-side; never trusted from client claims
            </p>
          </div>
          {usersQuery.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={4} />
            </div>
          ) : usersQuery.isError ? (
            <div className="p-5">
              <ErrorState
                message={(usersQuery.error as Error).message}
                onRetry={() => usersQuery.refetch()}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-xs font-medium text-[#475569]">
                  <tr>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E4]">
                  {(usersQuery.data || []).map((u) => (
                    <tr key={u.id}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-[#0F172A]">{u.name}</div>
                        <div className="font-mono text-xs text-[#64748B]">{u.email}</div>
                      </td>
                      <td className="px-5 py-3">
                        {isAdmin ? (
                          <select
                            aria-label={`Role for ${u.name}`}
                            value={u.role}
                            onChange={(e) => {
                              const nextRole = e.target.value as UserRole;
                              if (nextRole !== u.role) {
                                setPendingTx({
                                  kind: 'role',
                                  id: u.id,
                                  userName: u.name,
                                  currentRole: u.role,
                                  nextRole,
                                });
                              }
                            }}
                            className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs capitalize"
                          >
                            <option value="admin">admin</option>
                            <option value="manager">manager</option>
                            <option value="cashier">cashier</option>
                            <option value="shareholder">shareholder</option>
                          </select>
                        ) : (
                          <span className="text-xs capitalize text-[#334155]">{u.role}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusLabel
                          tone={u.account_status === 'active' ? 'green' : 'red'}
                          label={u.account_status}
                        />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {isAdmin && u.id !== session?.user.id ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setPendingTx({
                                  kind: 'impersonate',
                                  id: u.id,
                                  userName: u.name,
                                  email: u.email,
                                  role: u.role,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2.5 py-1 text-xs font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D]"
                            >
                              <UserCog className="h-3.5 w-3.5" />
                              Impersonate
                            </button>
                            <button type="button" onClick={() => setSecurityUserId(u.id)}
                              className="rounded border border-[#CBD5E1] px-2.5 py-1 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8]">
                              Security
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingTx({
                                  kind: 'status',
                                  id: u.id,
                                  userName: u.name,
                                  nextStatus: u.account_status === 'active' ? 'disabled' : 'active',
                                })
                              }
                              className="rounded border border-[#CBD5E1] px-2.5 py-1 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8]"
                            >
                              {u.account_status === 'active' ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-[#94A3B8]">Current Session</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'users' && isAdmin && usersQuery.data?.filter((user) => user.id === securityUserId).map((user) => (
        <UserSecurityPanel key={user.id} user={user} onClose={() => setSecurityUserId(null)} />
      ))}

      {tab === 'policy' ? (
        <form
          onSubmit={handleSavePolicy}
          className="max-w-xl rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[#15803D]" />
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Cooperative Share Capital & Loan Policy
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pol-cap" className="block text-xs font-medium text-[#334155]">
                Fixed Initial Share Capital (PHP)
              </label>
              <input
                id="pol-cap"
                type="number"
                min="100"
                required
                value={reqCapital}
                onChange={(e) => setReqCapital(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="pol-mult" className="block text-xs font-medium text-[#334155]">
                Loan Capital Multiplier (×)
              </label>
              <input
                id="pol-mult"
                type="number"
                min="1"
                max="20"
                required
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="pol-rate" className="block text-xs font-medium text-[#334155]">
                Interest Rate (Decimal, e.g. 0.06 = 6%)
              </label>
              <input
                id="pol-rate"
                type="number"
                min="0"
                max="0.5"
                step="0.01"
                required
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="pol-wait" className="block text-xs font-medium text-[#334155]">
                Overdue Settlement Waiting Days
              </label>
              <input
                id="pol-wait"
                type="number"
                min="1"
                max="60"
                required
                value={waitingDays}
                onChange={(e) => setWaitingDays(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saveSettingsMutation.isPending}
            className="rounded-lg bg-[#15803D] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#166534]"
          >
            {saveSettingsMutation.isPending ? 'Saving...' : 'Save Policy Settings'}
          </button>
        </form>
      ) : null}

      {tab === 'policy' && isAdmin && session && <EmailMfaSettings userId={session.user.id} />}

      {tab === 'sync' ? (
        <div className="space-y-5">
          {syncQuery.isLoading ? (
            <LoadingSkeleton rows={4} />
          ) : (
            <>
              <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-[#15803D]" />
                  <h2 className="font-display text-base font-semibold text-[#0F172A]">
                    Registered POS Terminals & Sync Batches
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(syncQuery.data?.terminals || []).map((t) => (
                    <div key={t.id} className="rounded-lg border border-[#E2E8E4] p-3.5 text-xs">
                      <div className="font-mono font-semibold text-[#0F172A]">{t.terminal_code}</div>
                      <div className="text-[#475569]">{t.location_name}</div>
                      <div className="mt-1 font-mono text-[#64748B]">
                        Last Sync: {formatDateTime(t.last_sync_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-3">
                <h3 className="font-display text-base font-semibold text-[#0F172A]">
                  Offline Synchronization Conflicts
                </h3>
                {(syncQuery.data?.conflicts || []).length === 0 ? (
                  <EmptyState
                    title="No sync conflicts"
                    description="Offline POS sales synchronized cleanly against central warehouse balances."
                  />
                ) : (
                  <div className="divide-y divide-[#E2E8E4]">
                    {syncQuery.data!.conflicts.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div>
                          <div className="font-medium text-[#0F172A]">
                            {c.product_name} · {c.terminal_id}
                          </div>
                          <div className="text-[#64748B]">{c.reason}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusLabel
                            tone={c.resolution_status === 'open' ? 'red' : 'green'}
                            label={c.resolution_status.replace(/_/g, ' ')}
                          />
                          {c.resolution_status === 'open' ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingTx({
                                  kind: 'resolve_conflict',
                                  id: c.id,
                                  productName: c.product_name,
                                  terminalId: c.terminal_id,
                                  reason: c.reason,
                                })
                              }
                              className="rounded bg-[#15803D] px-3 py-1.5 font-medium text-white hover:bg-[#166534]"
                            >
                              Accept & Reconcile
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8E4] px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#0F172A]">
                System Audit Trail & Compliance Logs
              </h2>
              <p className="text-xs text-[#64748B]">
                Searchable write-once ledger of authentication, catalog imports, loan transitions, and admin actions
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void handleExportAudit('xlsx')} disabled={!auditQuery.data?.length}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#15803D] disabled:opacity-50">
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#15803D]" aria-hidden="true" /> Export Excel
              </button>
              <button
                type="button"
                onClick={() => void handleExportAudit('csv')}
                disabled={!auditQuery.data || auditQuery.data.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#15803D] disabled:opacity-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#15803D]" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => void handleExportAudit('pdf')}
                disabled={!auditQuery.data || auditQuery.data.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#166534] disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export PDF
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-b border-[#E2E8E4] bg-[#F7F9F8] px-5 py-3 sm:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
              <input
                type="search"
                aria-label="Search audit logs"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search actor, action, entity type, or ID..."
                className="w-full rounded-lg border border-[#CBD5E1] bg-white py-1.5 pl-8 pr-3 text-xs"
              />
            </div>
            <div>
              <select
                aria-label="Filter by audit event prefix"
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs text-[#0F172A]"
              >
                <option value="">All Event Categories</option>
                <option value="product">Products & Bulk Imports</option>
                <option value="loan">Loan Lifecycle & Payments</option>
                <option value="sale">POS Sales & Fulfillments</option>
                <option value="shareholder">Shareholder Verification</option>
                <option value="user">User Accounts & Roles</option>
                <option value="system">Backups & System Events</option>
                <option value="settings">Policy Settings</option>
                <option value="admin">Admin Impersonation</option>
                <option value="auth.">Sign-in and Sign-out</option>
                <option value="auth.suspicious_activity">Suspicious Activity</option>
              </select>
            </div>
            <label className="grid gap-1 text-xs font-medium text-[#475569]">
              Date from (UTC)
              <input type="date" value={auditAfter} max={auditBefore || undefined} onChange={(event) => setAuditAfter(event.target.value)} className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-[#0F172A]" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-[#475569]">
              Date to (UTC)
              <input type="date" value={auditBefore} min={auditAfter || undefined} onChange={(event) => setAuditBefore(event.target.value)} className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-[#0F172A]" />
            </label>
            <select aria-label="Audit archive" value={auditScope} onChange={(event) => setAuditScope(event.target.value)} className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs text-[#0F172A]">
              <option value="active">Current records</option>
              <option value="archived">Archived records</option>
              <option value="all">All records</option>
            </select>
          </div>

          {auditQuery.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={5} />
            </div>
          ) : auditQuery.isError ? (
            <div className="p-5">
              <ErrorState
                message={(auditQuery.error as Error).message}
                onRetry={() => auditQuery.refetch()}
              />
            </div>
          ) : (auditQuery.data || []).length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No matching audit records"
                description="Adjust your search query or event category filter to inspect system audit trails."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                  <tr>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">Actor</th>
                    <th className="px-5 py-3">Entity</th>
                    <th className="px-5 py-3">Timestamp</th>
                    <th className="px-5 py-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E4]">
                  {(auditQuery.data || []).map((log) => {
                    const isExpanded = expandedAuditId === log.id;
                    return (
                      <Fragment key={log.id}>
                        <tr className="hover:bg-[#F7F9F8]">
                          <td className="px-5 py-3 font-mono font-medium text-[#0F172A]">{log.action}</td>
                          <td className="px-5 py-3 text-[#334155]">{log.actor_name}</td>
                          <td className="px-5 py-3 font-mono text-[#64748B]">
                            {log.entity_type} · {log.entity_id}
                          </td>
                          <td className="px-5 py-3 font-mono text-[#64748B] tabular-nums">
                            {formatDateTime(log.created_at)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setExpandedAuditId(isExpanded ? null : log.id)}
                              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D]"
                            >
                              {isExpanded ? (
                                <>
                                  Hide <ChevronUp className="h-3 w-3" />
                                </>
                              ) : (
                                <>
                                  Inspect <ChevronDown className="h-3 w-3" />
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="bg-[#F7F9F8]">
                            <td colSpan={5} className="px-5 py-3">
                              <div className="rounded-lg border border-[#E2E8E4] bg-white p-3">
                                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                                  Recorded Metadata Payload ({log.id})
                                </div>
                                <pre className="overflow-x-auto font-mono text-[11px] text-[#0F172A]">
                                  {JSON.stringify(log.metadata || {}, null, 2)}
                                </pre>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'data' ? (
        <div className="space-y-5">
          {governanceQuery.isLoading ? (
            <LoadingSkeleton rows={5} />
          ) : governanceQuery.isError ? (
            <ErrorState
              message={(governanceQuery.error as Error).message}
              onRetry={() => governanceQuery.refetch()}
            />
          ) : governanceQuery.data ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8E4] bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-[#DCFCE7] p-2.5 text-[#14532D]">
                    <Database className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-semibold text-[#0F172A]">
                      Database Backups, Maintenance Tasks & Governance
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      Schedule: {governanceQuery.data.system_health.backup_schedule} · Retention:{' '}
                      {governanceQuery.data.system_health.retention_policy}
                    </p>
                  </div>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setPendingTx({ kind: 'backup' })}
                    disabled={triggerBackupMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#15803D] px-4 py-2 text-xs font-medium text-white hover:bg-[#166534] disabled:opacity-50"
                  >
                    <HardDrive className="h-4 w-4" />
                    {triggerBackupMutation.isPending ? 'Running Backup...' : 'Run Manual Backup'}
                  </button>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
                  <div className="text-xs text-[#64748B]">Database Size</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                    {Math.max(1, Math.round(governanceQuery.data.system_health.database_size_bytes / 1024))} KB
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B]">SQLite WAL Storage</div>
                </div>
                <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
                  <div className="text-xs text-[#64748B]">Retention Policy</div>
                  <div className="mt-1 text-sm font-semibold text-[#0F172A]">
                    {governanceQuery.data.system_health.retention_policy}
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B]">Local encrypted snapshots</div>
                </div>
                <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
                  <div className="text-xs text-[#64748B]">Catalog & Sales Records</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                    {governanceQuery.data.system_health.total_products} SKUs ·{' '}
                    {governanceQuery.data.system_health.total_sales} Sales
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B]">Active warehouse ledger</div>
                </div>
                <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
                  <div className="text-xs text-[#64748B]">Audit Trail Volume</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                    {governanceQuery.data.system_health.total_audit_logs}
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B]">Tamper-evident entries</div>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
                <div className="border-b border-[#E2E8E4] px-5 py-4">
                  <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                    Backup Monitoring History
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                      <tr>
                        <th className="px-5 py-3">Type</th>
                        <th className="px-5 py-3">Storage Location</th>
                        <th className="px-5 py-3">Retention</th>
                        <th className="px-5 py-3 text-right">Size</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Triggered By</th>
                        <th className="px-5 py-3 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8E4]">
                      {governanceQuery.data.backups.map((b) => (
                        <tr key={b.id}>
                          <td className="px-5 py-3 font-mono font-medium text-[#0F172A]">{b.backup_type}</td>
                          <td className="px-5 py-3 font-mono text-[#475569]">{b.storage_location}</td>
                          <td className="px-5 py-3 text-[#64748B]">{b.retention_tier}</td>
                          <td className="px-5 py-3 text-right font-mono tabular-nums">
                            {Math.max(1, Math.round(b.size_bytes / 1024))} KB
                          </td>
                          <td className="px-5 py-3">
                            <StatusLabel
                              tone={b.status === 'verified' ? 'green' : 'amber'}
                              label={b.status}
                            />
                          </td>
                          <td className="px-5 py-3 text-[#334155]">{b.triggered_by}</td>
                          <td className="px-5 py-3 text-right font-mono text-[#64748B]">
                            {formatDateTime(b.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
                <div className="flex items-center gap-2 border-b border-[#E2E8E4] px-5 py-4">
                  <Clock className="h-4 w-4 text-[#15803D]" />
                  <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                    Scheduled Maintenance Tasks
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                      <tr>
                        <th className="px-5 py-3">Task</th>
                        <th className="px-5 py-3">Frequency</th>
                        <th className="px-5 py-3">Description</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3 text-right">Duration</th>
                        <th className="px-5 py-3 text-right">Last Run</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8E4]">
                      {governanceQuery.data.scheduled_tasks.map((task) => (
                        <tr key={task.id}>
                          <td className="px-5 py-3 font-mono font-medium text-[#0F172A]">{task.task_name}</td>
                          <td className="px-5 py-3 text-[#334155]">{task.frequency}</td>
                          <td className="px-5 py-3 text-[#64748B]">{task.description}</td>
                          <td className="px-5 py-3">
                            <StatusLabel
                              tone={task.last_status === 'healthy' ? 'green' : 'amber'}
                              label={task.last_status}
                            />
                          </td>
                          <td className="px-5 py-3 text-right font-mono tabular-nums text-[#475569]">
                            {task.last_duration_ms} ms
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-[#64748B]">
                            {formatDateTime(task.last_run_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
                  <div className="border-b border-[#E2E8E4] px-5 py-4">
                    <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                      Recent Bulk Import Logs
                    </h3>
                  </div>
                  {governanceQuery.data.import_logs.length === 0 ? (
                    <div className="p-5">
                      <EmptyState
                        title="No bulk imports yet"
                        description="Excel/CSV product uploads from Products & Inventory appear here."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                          <tr>
                            <th className="px-4 py-2.5">File</th>
                            <th className="px-4 py-2.5 text-right">Created / Updated / Failed</th>
                            <th className="px-4 py-2.5 text-right">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8E4]">
                          {governanceQuery.data.import_logs.slice(0, 8).map((log) => (
                            <tr key={log.id}>
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-[#0F172A]">{log.filename}</div>
                                <div className="text-[11px] text-[#64748B]">by {log.user_name}</div>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                                <span className="text-[#15803D]">{log.created_count}</span> /{' '}
                                <span className="text-[#B45309]">{log.updated_count}</span> /{' '}
                                <span className="text-[#B91C1C]">{log.failed_count}</span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-[#64748B]">
                                {formatDateTime(log.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
                  <div className="border-b border-[#E2E8E4] px-5 py-4">
                    <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                      Recent Report & Catalog Export Logs
                    </h3>
                  </div>
                  {governanceQuery.data.export_logs.length === 0 ? (
                    <div className="p-5">
                      <EmptyState
                        title="No exports logged yet"
                        description="Excel, CSV, and PDF exports from Reports, Inventory, or Audit Logs are tracked here."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                          <tr>
                            <th className="px-4 py-2.5">Export Type</th>
                            <th className="px-4 py-2.5">Format / Period</th>
                            <th className="px-4 py-2.5 text-right">Rows</th>
                            <th className="px-4 py-2.5 text-right">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8E4]">
                          {governanceQuery.data.export_logs.slice(0, 8).map((log) => (
                            <tr key={log.id}>
                              <td className="px-4 py-2.5 font-mono text-[#0F172A]">{log.export_type}</td>
                              <td className="px-4 py-2.5 uppercase text-[#475569]">
                                {log.format} · {log.period}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                                {log.row_count}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-[#64748B]">
                                {formatDateTime(log.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
                <div className="border-b border-[#E2E8E4] px-5 py-4">
                  <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                    Tiered API Rate Limiting Strategy
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                      <tr>
                        <th className="px-5 py-3">Tier</th>
                        <th className="px-5 py-3 text-right">Requests / Minute</th>
                        <th className="px-5 py-3">Protected Scope</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8E4]">
                      {governanceQuery.data.rate_limits.tiers.map((tier) => (
                        <tr key={tier.tier}>
                          <td className="px-5 py-3 font-mono font-semibold uppercase text-[#0F172A]">
                            {tier.tier}
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-semibold text-[#15803D] tabular-nums">
                            {tier.limit_per_min} req/min
                          </td>
                          <td className="px-5 py-3 text-[#64748B]">{tier.scope}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmConfig)}
        title={confirmConfig?.title || ''}
        description={confirmConfig?.description || ''}
        details={confirmConfig?.details || []}
        confirmLabel={confirmConfig?.confirmLabel}
        tone={confirmConfig?.tone || 'amber'}
        isPending={
          saveSettingsMutation.isPending ||
          triggerBackupMutation.isPending ||
          resolveConflictMutation.isPending ||
          statusMutation.isPending ||
          roleMutation.isPending ||
          impersonateMutation.isPending
        }
        onCancel={() => setPendingTx(null)}
        onConfirm={() => confirmConfig?.onConfirm()}
      />
    </div>
  );
}
