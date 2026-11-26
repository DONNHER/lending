import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { formatPHP, formatShortDate } from '../../lib/productAssets';
import { LoanApplicationForm, type LoanApplicationDraft } from './LoanApplicationForm';
import { MemberLoansOverview, type MemberLoanSection } from './MemberLoansOverview';
import { useAppStore } from '../../stores/app-store';
import type {
  Loan,
  LoanApplication,
  LoanEligibilityEvaluation,
  LoanSettings,
} from '../../types/domain';
import { ConfirmDialog, type ConfirmDetailRow } from '../../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';

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
  const [memberSection, setMemberSection] = useState<MemberLoanSection>('accounts');
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
      setMemberSection('applications');
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
        <MemberLoansOverview
          evaluation={data.evaluation}
          loans={data.loans}
          applications={data.applications}
          section={memberSection}
          onSectionChange={setMemberSection}
          onApply={() => {
            setFeedback(null);
            setApplicationOpen(true);
          }}
        />
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
