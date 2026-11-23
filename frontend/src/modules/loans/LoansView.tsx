import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Landmark,
  ShieldAlert,
  CalendarClock,
} from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import {
  getLoanHistoryDateString,
  queryShareholderLoanHistory,
  type LoanHistorySortOrder,
  type LoanHistoryStatusFilter,
} from '../../lib/loanHistory';
import { formatPHP, formatShortDate } from '../../lib/productAssets';
import { roundCurrency } from '../../lib/domainRules';
import { LoanApplicationForm, type LoanApplicationDraft } from './LoanApplicationForm';
import { useAppStore } from '../../stores/app-store';
import type {
  Loan,
  LoanApplication,
  LoanEligibilityEvaluation,
  LoanSettings,
} from '../../types/domain';
import { ConfirmDialog, type ConfirmDetailRow } from '../../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';

const LOAN_HISTORY_PAGE_SIZE = 5;

interface ShareholderLoansDashboard {
  mode: 'shareholder';
  evaluation: LoanEligibilityEvaluation;
  loans: Loan[];
  applications: LoanApplication[];
  loanSettings: LoanSettings;
}

interface ManagerLoansDashboard {
  mode: 'manager';
  applications: LoanApplication[];
  loans: Loan[];
  loanSettings: LoanSettings;
}

type PendingLoanConfirm =
  | { kind: 'review'; app: LoanApplication; decision: 'approved' | 'rejected' }
  | { kind: 'disburse'; loan: Loan }
  | { kind: 'payment'; loan: Loan; amount: number }
  | { kind: 'overdue'; loan: Loan };

export function LoansView() {
  const queryClient = useQueryClient();
  const session = useAppStore((state) => state.session);
  const user = session?.user;
  const role = user?.role;
  const isManager = role === 'admin' || role === 'manager';

  const [applicationOpen, setApplicationOpen] = useState(false);
  const [showActiveBreakdown, setShowActiveBreakdown] = useState(false);
  const [expandedHistoryLoanIds, setExpandedHistoryLoanIds] = useState<Record<string, boolean>>({});
  const [historyStatusFilter, setHistoryStatusFilter] = useState<LoanHistoryStatusFilter>('all');
  const [historySortOrder, setHistorySortOrder] = useState<LoanHistorySortOrder>('desc');
  const [historyPage, setHistoryPage] = useState(1);
  const [paymentAmountByLoan, setPaymentAmountByLoan] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingLoanConfirm | null>(null);

  const dashboardQuery = useQuery({
    queryKey: ['loans-dashboard', user?.id],
    queryFn: async () =>
      (await apiRequest<ShareholderLoansDashboard | ManagerLoansDashboard>('/loans/dashboard')).data,
  });

  const applyMutation = useMutation({
    mutationFn: async (params: LoanApplicationDraft) =>
      apiRequest('/loans/applications', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: (res) => {
      setPendingConfirm(null);
      setApplicationOpen(false);
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['loans-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['loans-eligibility'] });
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Loan request failed.' });
    },
  });

  const reviewAppMutation = useMutation({
    mutationFn: async (params: { appId: string; decision: 'approved' | 'rejected' }) =>
      apiRequest(`/loans/applications/${params.appId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision: params.decision }),
      }),
    onSuccess: (res) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['loans-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['loans-eligibility'] });
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Review failed.' });
    },
  });

  const disburseMutation = useMutation({
    mutationFn: async (loanId: string) =>
      apiRequest(`/loans/${loanId}/disburse`, { method: 'POST' }),
    onSuccess: (res) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['loans-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['loans-eligibility'] });
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Disbursement failed.' });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async (params: { loanId: string; amount: number }) =>
      apiRequest(`/loans/${params.loanId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: params.amount,
          payment_method: 'cash',
          reference: `LPAY-${Date.now().toString().slice(-6)}`,
        }),
      }),
    onSuccess: (res) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['loans-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['loans-eligibility'] });
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Payment failed.' });
    },
  });

  const overdueMutation = useMutation({
    mutationFn: async (loanId: string) =>
      apiRequest(`/loans/${loanId}/simulate-overdue`, { method: 'POST' }),
    onSuccess: (res) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'amber', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['loans-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['loans-eligibility'] });
    },
    onError: (err) => {
      setPendingConfirm(null);
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Action failed.' });
    },
  });

  if (dashboardQuery.isLoading) return <LoadingSkeleton rows={6} />;
  if (dashboardQuery.isError) {
    return (
      <ErrorState
        message={(dashboardQuery.error as Error).message}
        onRetry={() => dashboardQuery.refetch()}
      />
    );
  }

  const data = dashboardQuery.data!;
  const isShareholder = data.mode === 'shareholder';
  const activeLoans = isShareholder
    ? data.loans.filter((l) => l.status !== 'fully_paid')
    : data.loans;
  const historyResult = isShareholder
    ? queryShareholderLoanHistory(data.loans, {
        status: historyStatusFilter,
        sortOrder: historySortOrder,
        page: historyPage,
        pageSize: LOAN_HISTORY_PAGE_SIZE,
      })
    : null;
  const pendingShareholderApps = isShareholder
    ? data.applications.filter((a) => a.status === 'submitted' || a.status === 'under_review')
    : [];
  const totalActiveBalance = activeLoans.reduce((sum, l) => sum + l.computed_balance, 0);
  const nextInstallment = activeLoans
    .flatMap((loan) => loan.installments
      .filter((installment) => installment.status !== 'paid' && installment.amount_due > installment.amount_paid)
      .map((installment) => ({ loanNumber: loan.loan_number, installment })))
    .sort((a, b) => a.installment.due_date.localeCompare(b.installment.due_date))[0];

  function handleConfirmTransaction() {
    if (!pendingConfirm) return;
    switch (pendingConfirm.kind) {
      case 'review':
        reviewAppMutation.mutate({
          appId: pendingConfirm.app.id,
          decision: pendingConfirm.decision,
        });
        break;
      case 'disburse':
        disburseMutation.mutate(pendingConfirm.loan.id);
        break;
      case 'payment':
        paymentMutation.mutate({
          loanId: pendingConfirm.loan.id,
          amount: pendingConfirm.amount,
        });
        break;
      case 'overdue':
        overdueMutation.mutate(pendingConfirm.loan.id);
        break;
    }
  }

  const confirmConfig: {
    title: string;
    description: string;
    details: ConfirmDetailRow[];
    confirmLabel: string;
    tone: 'green' | 'amber' | 'red';
  } | null = pendingConfirm
    ? (() => {
        switch (pendingConfirm.kind) {
          case 'review':
            return {
              title:
                pendingConfirm.decision === 'approved'
                  ? 'Confirm Loan Approval'
                  : 'Confirm Loan Rejection',
              description:
                pendingConfirm.decision === 'approved'
                  ? 'Approving creates an approved loan account ready for transactional disbursement.'
                  : 'Rejecting closes this loan application and restores the member’s available credit.',
              details: [
                {
                  label: 'Member',
                  value: `${pendingConfirm.app.shareholder_name || 'Member'} (${pendingConfirm.app.membership_number || ''})`,
                },
                { label: 'Requested Amount', value: formatPHP(pendingConfirm.app.requested_amount) },
                { label: 'Term', value: `${pendingConfirm.app.term_months} months` },
              ],
              confirmLabel:
                pendingConfirm.decision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection',
              tone: pendingConfirm.decision === 'approved' ? 'green' : 'red',
            };
          case 'disburse':
            return {
              title: 'Confirm Loan Disbursement',
              description:
                'Disbursing activates the loan account and generates the monthly installment schedule.',
              details: [
                { label: 'Loan Account', value: pendingConfirm.loan.loan_number },
                { label: 'Member', value: pendingConfirm.loan.shareholder_name || 'Member' },
                { label: 'Principal', value: formatPHP(pendingConfirm.loan.principal) },
                { label: 'Term', value: `${pendingConfirm.loan.term_months} months` },
              ],
              confirmLabel: 'Confirm Disbursement',
              tone: 'green',
            };
          case 'payment':
            return {
              title: 'Confirm Loan Payment Allocation',
              description:
                'Record this loan repayment and allocate it across fees, interest, and principal.',
              details: [
                { label: 'Loan Account', value: pendingConfirm.loan.loan_number },
                { label: 'Member', value: pendingConfirm.loan.shareholder_name || 'Member' },
                { label: 'Payment Amount', value: formatPHP(pendingConfirm.amount) },
                { label: 'Remaining Balance', value: formatPHP(pendingConfirm.loan.computed_balance) },
              ],
              confirmLabel: 'Confirm Payment',
              tone: 'green',
            };
          case 'overdue':
            return {
              title: 'Confirm Overdue Installment',
              description:
                'Marking the next installment overdue will suspend the member’s loan withdrawal privileges until settled.',
              details: [
                { label: 'Loan Account', value: pendingConfirm.loan.loan_number },
                { label: 'Member', value: pendingConfirm.loan.shareholder_name || 'Member' },
              ],
              confirmLabel: 'Mark Overdue',
              tone: 'amber',
            };
        }
      })()
    : null;

  const isConfirmPending =
    reviewAppMutation.isPending ||
    disburseMutation.isPending ||
    paymentMutation.isPending ||
    overdueMutation.isPending;

  function renderInstallmentTable(loan: Loan) {
    if (loan.installments.length === 0) return null;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Due Date</th>
              <th className="px-3 py-2 text-right">Principal</th>
              <th className="px-3 py-2 text-right">Interest</th>
              <th className="px-3 py-2 text-right">Amount Due</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8E4]">
            {loan.installments.map((inst) => (
              <tr key={inst.id}>
                <td className="px-3 py-2 font-mono">{inst.installment_number}</td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {formatShortDate(inst.due_date)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatPHP(inst.principal_due)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatPHP(inst.interest_due)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                  {formatPHP(inst.amount_due)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatPHP(inst.amount_paid)}
                </td>
                <td className="px-3 py-2 text-right">
                  <StatusLabel
                    tone={
                      inst.status === 'paid'
                        ? 'green'
                        : inst.status === 'overdue'
                        ? 'red'
                        : 'amber'
                    }
                    label={inst.status}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderPaymentHistory(loan: Loan) {
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        <h4 className="text-sm font-semibold text-slate-900">Recorded repayments</h4>
        {loan.payments.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No repayments recorded yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {loan.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <div className="text-slate-800">{formatShortDate(payment.payment_date)}</div>
                  <div className="font-mono text-xs text-slate-600">{payment.reference}</div>
                </div>
                <span className="font-semibold tabular-nums text-emerald-800">{formatPHP(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'green'
              ? 'border-emerald-200 bg-emerald-50 text-[#14532D]'
              : feedback.tone === 'amber'
              ? 'border-amber-200 bg-amber-50 text-[#92400E]'
              : 'border-red-200 bg-red-50 text-[#991B1B]'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {/* SHAREHOLDER MAIN LOANS OVERVIEW PAGE */}
      {isShareholder && applicationOpen && data.evaluation.eligible ? (
        <LoanApplicationForm
          availableCredit={data.evaluation.available_credit}
          interestRate={data.loanSettings.interest_rate}
          isPending={applyMutation.isPending}
          onCancel={() => setApplicationOpen(false)}
          onSubmit={(draft) => applyMutation.mutate(draft)}
        />
      ) : isShareholder ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl bg-emerald-950 p-5 text-white sm:p-6">
              <Landmark className="mb-4 h-5 w-5 text-emerald-200" />
              <h2 className="text-sm font-medium text-emerald-100">Available to borrow</h2>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{formatPHP(data.evaluation.available_credit)}</p>
              {data.evaluation.eligible ? (
                <button type="button" onClick={() => setApplicationOpen(true)}
                  className="mt-5 w-full rounded-xl bg-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-100 sm:w-auto">
                  Apply for a loan
                </button>
              ) : (
                <div className="mt-4 flex items-start gap-2 text-sm text-emerald-50">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>
                    {data.evaluation.reason || 'Your loan offer is currently unavailable.'}
                    {data.evaluation.available_at && <> Available again {formatShortDate(data.evaluation.available_at)}.</>}
                  </span>
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6">
              <CalendarClock className="mb-4 h-5 w-5 text-emerald-800" />
              <h2 className="text-sm font-medium text-slate-600">Next payment</h2>
              {nextInstallment ? (
                <>
                  <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                    {formatPHP(roundCurrency(nextInstallment.installment.amount_due - nextInstallment.installment.amount_paid))}
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    Due {formatShortDate(nextInstallment.installment.due_date)} · {nextInstallment.loanNumber}
                  </p>
                  <p className="mt-3 text-sm text-slate-600">Pay through your cooperative manager.</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-600">You have no scheduled payment.</p>
              )}
            </section>
          </div>

          {/* Pending Requests Banner (only when present) */}
          {pendingShareholderApps.length > 0 ? (
            <section className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-3">
              <h3 className="font-display text-sm font-semibold text-[#0F172A]">
                Pending loan applications ({pendingShareholderApps.length})
              </h3>
              <div className="divide-y divide-[#E2E8E4]">
                {pendingShareholderApps.map((app) => (
                  <div
                    key={app.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#0F172A]">{app.purpose}</div>
                      <div className="text-[#64748B]">
                        {app.term_months} months · {formatShortDate(app.created_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                        {formatPHP(app.requested_amount)}
                      </span>
                      <StatusLabel tone="amber" label={app.status.replace('_', ' ')} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Active Loan Account Summary — Breakdown Hidden by Default */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#E2E8E4] bg-white p-5">
              <div>
                <h3 className="font-display text-base font-semibold text-[#0F172A]">
                  My Loan Accounts ({activeLoans.length})
                </h3>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  {activeLoans.length === 0
                    ? 'No active loan balance at this time.'
                    : `Total Active Balance: ${formatPHP(totalActiveBalance)} · Loan repayments are recorded by the cooperative manager.`}
                </p>
              </div>

              {activeLoans.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowActiveBreakdown((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] whitespace-nowrap"
                >
                  <span>{showActiveBreakdown ? 'Hide Breakdown' : 'Show Breakdown'}</span>
                  {showActiveBreakdown ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
            </div>

            {showActiveBreakdown && activeLoans.length > 0 ? (
              <div className="space-y-4">
                {activeLoans.map((loan) => (
                  <div
                    key={loan.id}
                    className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2E8E4] pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-[#0F172A]">
                            {loan.loan_number}
                          </span>
                          <StatusLabel
                            tone={loan.status === 'overdue' ? 'red' : 'amber'}
                            label={loan.status.replace('_', ' ')}
                          />
                        </div>
                        <div className="mt-1 text-xs text-[#64748B]">
                          Principal: {formatPHP(loan.principal)} · Interest:{' '}
                          {formatPHP(loan.interest_amount)} · Term: {loan.term_months} mos
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums">
                        <div className="text-xs text-[#64748B]">Computed Ledger Balance</div>
                        <div className="text-lg font-bold text-[#0F172A]">
                          {formatPHP(loan.computed_balance)}
                        </div>
                        <div className="text-[11px] text-[#15803D]">
                          Paid: {formatPHP(loan.computed_total_paid)} /{' '}
                          {formatPHP(loan.computed_total_payable)}
                        </div>
                      </div>
                    </div>

                    {renderInstallmentTable(loan)}
                    {renderPaymentHistory(loan)}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* Loan History (Shown by Default Below with Status Filter, Date Sort & Pagination) */}
          {historyResult ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8E4] bg-white px-5 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[#0F172A]">
                    {historyStatusFilter === 'fully_paid'
                      ? `Completed Loan Accounts (${historyResult.total})`
                      : `Loan History (${historyResult.total})`}
                  </h3>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    Filter by loan status, sort by date, and open any record to review installments
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter loan history by status"
                    value={historyStatusFilter}
                    onChange={(e) => {
                      setHistoryStatusFilter(e.target.value as LoanHistoryStatusFilter);
                      setHistoryPage(1);
                    }}
                    className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] focus:border-[#15803D] focus:outline-none"
                  >
                    <option value="all">All Statuses</option>
                    <option value="fully_paid">Fully Paid</option>
                    <option value="active">Active</option>
                    <option value="overdue">Overdue</option>
                    <option value="disbursed">Disbursed</option>
                    <option value="approved">Approved</option>
                  </select>

                  <select
                    aria-label="Sort loan history by date"
                    value={historySortOrder}
                    onChange={(e) => {
                      setHistorySortOrder(e.target.value as LoanHistorySortOrder);
                      setHistoryPage(1);
                    }}
                    className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] focus:border-[#15803D] focus:outline-none"
                  >
                    <option value="desc">Newest First</option>
                    <option value="asc">Oldest First</option>
                  </select>
                </div>
              </div>

              {historyResult.items.length === 0 ? (
                <EmptyState
                  title="No loan accounts match this filter"
                  description={
                    historyStatusFilter === 'all'
                      ? 'Your cooperative loan records will appear here once created.'
                      : `No ${historyStatusFilter.replace('_', ' ')} loan accounts found.`
                  }
                />
              ) : (
                <div className="space-y-3">
                  {historyResult.items.map((loan) => {
                    const expanded = Boolean(expandedHistoryLoanIds[loan.id]);
                    const historyDate = getLoanHistoryDateString(loan);
                    return (
                      <div
                        key={loan.id}
                        className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm font-bold text-[#0F172A]">
                                {loan.loan_number}
                              </span>
                              <StatusLabel
                                tone={
                                  loan.status === 'fully_paid'
                                    ? 'green'
                                    : loan.status === 'overdue'
                                    ? 'red'
                                    : 'amber'
                                }
                                label={loan.status.replace('_', ' ')}
                              />
                              <span className="text-xs text-[#64748B]">
                                · {formatShortDate(historyDate)}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-[#64748B]">
                              Principal: {formatPHP(loan.principal)} · Interest:{' '}
                              {formatPHP(loan.interest_amount)} · Term: {loan.term_months} mos
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right font-mono tabular-nums">
                              <div className="text-xs text-[#64748B]">Total Paid</div>
                              <div className="text-sm font-bold text-[#15803D]">
                                {formatPHP(loan.computed_total_paid)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedHistoryLoanIds((prev) => ({
                                  ...prev,
                                  [loan.id]: !expanded,
                                }))
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] whitespace-nowrap"
                            >
                              <span>{expanded ? 'Hide Breakdown' : 'Show Breakdown'}</span>
                              {expanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {expanded ? (
                          <div className="border-t border-[#E2E8E4] pt-4">
                            {renderInstallmentTable(loan)}
                            {renderPaymentHistory(loan)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <nav
                    aria-label="Loan history pagination"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8E4] bg-white px-5 py-3"
                  >
                    <div className="font-mono text-xs text-[#64748B] tabular-nums">
                      Showing {historyResult.startIndex}–{historyResult.endIndex} of{' '}
                      {historyResult.total} loan accounts
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={historyResult.page <= 1}
                        onClick={() => setHistoryPage(Math.max(1, historyResult.page - 1))}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] disabled:opacity-40"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        <span>Previous</span>
                      </button>

                      <span className="px-2 font-mono text-xs text-[#475569] tabular-nums">
                        Page {historyResult.page} of {historyResult.totalPages}
                      </span>

                      <button
                        type="button"
                        disabled={historyResult.page >= historyResult.totalPages}
                        onClick={() =>
                          setHistoryPage(Math.min(historyResult.totalPages, historyResult.page + 1))
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] disabled:opacity-40"
                      >
                        <span>Next</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </nav>
                </div>
              )}
            </section>
          ) : null}

        </>
      ) : null}

      {/* MANAGER / ADMIN PORTFOLIO VIEW */}
      {isManager ? (
        <>
          <section className="rounded-xl border border-[#E2E8E4] bg-white">
            <div className="border-b border-[#E2E8E4] px-5 py-4">
              <h2 className="font-display text-base font-semibold text-[#0F172A]">
                Loan Applications Queue ({data.applications.length})
              </h2>
              <p className="text-xs text-[#64748B]">
                Review submitted shareholder loan applications before transactional disbursement
              </p>
            </div>
            {data.applications.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No loan applications"
                  description="Shareholder loan applications will appear here for underwriting."
                />
              </div>
            ) : (
              <div className="divide-y divide-[#E2E8E4]">
                {data.applications.map((app) => (
                  <div
                    key={app.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-[#0F172A]">
                          {app.shareholder_name || 'Member'} ({app.membership_number})
                        </span>
                        <StatusLabel
                          tone={
                            app.status === 'approved'
                              ? 'green'
                              : app.status === 'rejected'
                              ? 'red'
                              : 'amber'
                          }
                          label={app.status}
                        />
                      </div>
                      <div className="mt-1 text-xs text-[#64748B]">
                        {app.purpose} · {app.term_months} months
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-[#0F172A] tabular-nums">
                        {formatPHP(app.requested_amount)}
                      </span>
                      {app.status === 'submitted' || app.status === 'under_review' ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setPendingConfirm({ kind: 'review', app, decision: 'approved' })
                            }
                            className="rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#166534]"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingConfirm({ kind: 'review', app, decision: 'rejected' })
                            }
                            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-[#DC2626] hover:bg-red-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="font-display text-base font-semibold text-[#0F172A]">
              Cooperative Loan Accounts & Repayment Schedules
            </h3>

            {data.loans.length === 0 ? (
              <EmptyState
                title="No loan accounts yet"
                description="Approved applications appear here for disbursement and monthly installment tracking."
              />
            ) : (
              data.loans.map((loan) => {
                const nextDue = loan.installments.find((i) => i.status !== 'paid');
                const defaultPay = nextDue ? String(nextDue.amount_due - nextDue.amount_paid) : '';
                const inputVal = paymentAmountByLoan[loan.id] ?? defaultPay;

                return (
                  <div
                    key={loan.id}
                    className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2E8E4] pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-[#0F172A]">
                            {loan.loan_number}
                          </span>
                          <StatusLabel
                            tone={
                              loan.status === 'fully_paid'
                                ? 'green'
                                : loan.status === 'overdue'
                                ? 'red'
                                : 'amber'
                            }
                            label={loan.status.replace('_', ' ')}
                          />
                        </div>
                        <div className="mt-1 text-xs text-[#64748B]">
                          {loan.shareholder_name ? `${loan.shareholder_name} · ` : ''}
                          Principal: {formatPHP(loan.principal)} · Interest:{' '}
                          {formatPHP(loan.interest_amount)} · Term: {loan.term_months} mos
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums">
                        <div className="text-xs text-[#64748B]">Computed Ledger Balance</div>
                        <div className="text-lg font-bold text-[#0F172A]">
                          {formatPHP(loan.computed_balance)}
                        </div>
                        <div className="text-[11px] text-[#15803D]">
                          Paid: {formatPHP(loan.computed_total_paid)} /{' '}
                          {formatPHP(loan.computed_total_payable)}
                        </div>
                      </div>
                    </div>

                    {loan.status === 'approved' ? (
                      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
                        <span className="text-xs font-medium text-[#14532D]">
                          Loan approved and awaiting transactional disbursement.
                        </span>
                        <button
                          type="button"
                          disabled={disburseMutation.isPending}
                          onClick={() => setPendingConfirm({ kind: 'disburse', loan })}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#166534]"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Disburse & Generate Schedule
                        </button>
                      </div>
                    ) : null}

                    {renderInstallmentTable(loan)}

                    {loan.status === 'active' || loan.status === 'overdue' ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8E4] pt-3">
                        {role === 'manager' && !session?.impersonated_by && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            step="any"
                            aria-label={`Payment amount for ${loan.loan_number}`}
                            value={inputVal}
                            onChange={(e) =>
                              setPaymentAmountByLoan((prev) => ({
                                ...prev,
                                [loan.id]: e.target.value,
                              }))
                            }
                            className="w-36 rounded-lg border border-[#CBD5E1] px-3 py-1.5 font-mono text-xs"
                          />
                          <button
                            type="button"
                            disabled={paymentMutation.isPending || !inputVal || Number(inputVal) <= 0}
                            onClick={() =>
                              setPendingConfirm({
                                kind: 'payment',
                                loan,
                                amount: Number(inputVal),
                              })
                            }
                            className="rounded-lg bg-[#15803D] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#166534] disabled:opacity-50"
                          >
                            Record repayment
                          </button>
                        </div>
                        )}

                        {loan.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => setPendingConfirm({ kind: 'overdue', loan })}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-[#92400E] hover:bg-amber-100"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Mark Next Installment Overdue
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </section>
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmConfig)}
        title={confirmConfig?.title || ''}
        description={confirmConfig?.description || ''}
        details={confirmConfig?.details || []}
        confirmLabel={confirmConfig?.confirmLabel}
        tone={confirmConfig?.tone}
        isPending={isConfirmPending}
        onConfirm={handleConfirmTransaction}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
