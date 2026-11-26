import { useState } from 'react';
import { ArrowRight, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, FileText, History, Landmark, LockKeyhole } from 'lucide-react';
import { EmptyState, StatusLabel } from '../../components/ui/StateViews';
import { roundCurrency } from '../../lib/domainRules';
import { getLoanHistoryDateString, queryShareholderLoanHistory, type LoanHistorySortOrder, type LoanHistoryStatusFilter } from '../../lib/loanHistory';
import { formatPHP, formatShortDate } from '../../lib/productAssets';
import { useAppStore } from '../../stores/app-store';
import type { Loan, LoanApplication, LoanEligibilityEvaluation } from '../../types/domain';

const SECTIONS = [
  { id: 'accounts', label: 'My loans', icon: Landmark },
  { id: 'applications', label: 'Applications', icon: FileText },
  { id: 'history', label: 'History', icon: History },
] as const;
const CARD = 'min-w-0 rounded-2xl border border-[#E2E8E4] bg-white';
const SECONDARY_ACTION = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#D6E6DD] px-4 py-2 text-sm font-semibold text-[#14532D] hover:bg-emerald-50 disabled:opacity-40';

export type MemberLoanSection = (typeof SECTIONS)[number]['id'];

interface MemberLoansOverviewProps {
  evaluation: LoanEligibilityEvaluation;
  loans: Loan[];
  applications: LoanApplication[];
  section: MemberLoanSection;
  onSectionChange: (section: MemberLoanSection) => void;
  onApply: () => void;
}

function LoanAccount({ loan, expanded, history, onToggle }: {
  loan: Loan;
  expanded: boolean;
  history: boolean;
  onToggle: () => void;
}) {
  const panelId = `member-loan-details-${loan.id}`;
  const totals = [
    ['Principal', formatPHP(loan.principal)], ['Interest', formatPHP(loan.interest_amount)],
    ['Term', `${loan.term_months} months`], ['Total to repay', formatPHP(loan.computed_total_payable)],
    ['Paid to date', formatPHP(loan.computed_total_paid)],
  ];

  return (
    <article className={CARD}>
      <button id={`member-loan-${loan.id}`} type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-[#F7F9F8] sm:gap-4 sm:px-5">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF5F0] text-[#166534] sm:flex">
          <Landmark aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-semibold text-slate-900">{loan.loan_number}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <StatusLabel tone={loan.status === 'overdue' ? 'red' : loan.status === 'fully_paid' ? 'green' : 'neutral'} label={loan.status.replace('_', ' ')} />
            {history ? formatShortDate(getLoanHistoryDateString(loan)) : `${loan.term_months} months`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-xs text-slate-600">{history ? 'Total paid' : 'Balance'}</span>
          <span className="block text-sm font-semibold tabular-nums text-slate-950 sm:text-base">
            {formatPHP(history ? loan.computed_total_paid : loan.computed_balance)}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[#166534] transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div id={panelId} className="space-y-5 border-t border-[#E2E8E4] p-4 sm:p-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-[#F0F6F2] p-4 sm:grid-cols-3 xl:grid-cols-5">
            {totals.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-600">{label}</dt>
                <dd className="mt-1 break-words text-sm font-semibold tabular-nums text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h4 className="font-semibold text-slate-900">Installment schedule</h4>
            {loan.installments.length === 0 ? <p className="mt-2 text-sm text-slate-600">No installments scheduled yet.</p> : (
              <ol className="mt-2 divide-y divide-[#E2E8E4]">
                {loan.installments.map((installment) => (
                  <li key={installment.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{formatShortDate(installment.due_date)}</p>
                      <p className="mt-1 text-xs text-slate-600">Installment {installment.installment_number} · Paid {formatPHP(installment.amount_paid)}</p>
                    </div>
                    <div className="text-right">
                      <p className="mb-1 text-sm font-semibold tabular-nums text-slate-900">{formatPHP(installment.amount_due)}</p>
                      <StatusLabel tone={installment.status === 'paid' ? 'green' : installment.status === 'overdue' ? 'red' : 'amber'} label={installment.status} />
                    </div>
                    <p className="col-span-2 text-xs text-slate-600">
                      Principal {formatPHP(installment.principal_due)} · Interest {formatPHP(installment.interest_due)}
                      {installment.fees_due > 0 && <> · Fees {formatPHP(installment.fees_due)}</>}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="border-t border-[#E2E8E4] pt-4">
            <h4 className="font-semibold text-slate-900">Recorded repayments</h4>
            {loan.payments.length === 0 ? <p className="mt-2 text-sm text-slate-600">No repayments recorded yet.</p> : (
              <ul className="mt-2 divide-y divide-[#E2E8E4]">
                {loan.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-words text-slate-600">{formatShortDate(payment.payment_date)} · {payment.reference}</span>
                    <span className="font-semibold tabular-nums text-[#166534]">{formatPHP(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function MemberLoansOverview({ evaluation, loans, applications, section, onSectionChange, onApply }: MemberLoansOverviewProps) {
  const navigateToMembership = useAppStore((state) => state.setActiveWorkspace);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<LoanHistoryStatusFilter>('all');
  const [historySort, setHistorySort] = useState<LoanHistorySortOrder>('desc');
  const [historyPage, setHistoryPage] = useState(1);
  const openLoans = loans.filter((loan) => loan.status !== 'fully_paid');
  const nextPayment = openLoans.flatMap((loan) => loan.installments
    .filter((installment) => installment.status !== 'paid' && installment.amount_due > installment.amount_paid)
    .map((installment) => ({ loan, installment })))
    .sort((a, b) => a.installment.due_date.localeCompare(b.installment.due_date))[0];
  const history = queryShareholderLoanHistory(loans, { status: historyStatus, sortOrder: historySort, page: historyPage, pageSize: 5 });
  const accounts = section === 'history' ? history.items : openLoans;
  const outstanding = roundCurrency(openLoans.reduce((sum, loan) => sum + loan.computed_balance, 0));

  function showSchedule(loanId: string) {
    onSectionChange('accounts');
    setExpandedId(loanId);
    window.requestAnimationFrame(() => document.getElementById(`member-loan-${loanId}`)?.focus());
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Member loans</h1>
      </header>

      <div className="grid gap-4 md:grid-cols-[1.22fr_1fr]">
        <section aria-labelledby="member-credit" className="flex min-w-0 flex-col rounded-2xl bg-[#14532D] p-5 text-white sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="member-credit" className="text-sm font-semibold text-emerald-100">Available to borrow</h2>
              <p className="mt-2 break-words text-[clamp(1.65rem,5vw,2.6rem)] leading-tight font-bold tracking-tight tabular-nums">
                {formatPHP(evaluation.eligible ? evaluation.available_credit : 0)}
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 text-emerald-100">
              {evaluation.eligible ? <Landmark aria-hidden="true" className="h-5 w-5" /> : <LockKeyhole aria-hidden="true" className="h-5 w-5" />}
            </span>
          </div>
          {evaluation.eligible ? (
            <button type="button" onClick={onApply} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#14532D] hover:bg-emerald-50">
              Apply for a loan <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : (
            <div className="mt-4 text-sm leading-relaxed text-emerald-50">
              <p>{evaluation.reason || 'Applications are currently unavailable.'}</p>
              {evaluation.available_at && <p className="mt-1">Available again {formatShortDate(evaluation.available_at)}.</p>}
              {evaluation.stage === 'MEMBERSHIP' && (
                <button type="button" onClick={() => navigateToMembership('shareholders')} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold underline underline-offset-4">
                  View membership <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <dl className="mt-auto grid grid-cols-2 gap-3 pt-5 text-sm">
            <div><dt className="text-xs text-emerald-100">Verified share capital</dt><dd className="mt-1 font-semibold tabular-nums">{formatPHP(evaluation.verified_capital)}</dd></div>
            <div><dt className="text-xs text-emerald-100">Credit limit</dt><dd className="mt-1 font-semibold tabular-nums">{formatPHP(evaluation.maximum_loan)}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="member-next-payment" className={`${CARD} flex flex-col p-5 sm:p-6`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="member-next-payment" className="text-sm font-semibold text-slate-600">{nextPayment?.installment.status === 'overdue' ? 'Overdue payment' : 'Next payment'}</h2>
              {nextPayment ? (
                <p className="mt-2 break-words text-[clamp(1.65rem,5vw,2.6rem)] leading-tight font-bold tracking-tight tabular-nums text-slate-950">
                  {formatPHP(roundCurrency(nextPayment.installment.amount_due - nextPayment.installment.amount_paid))}
                </p>
              ) : <p className="mt-2 text-xl font-bold text-slate-950">No payment scheduled</p>}
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF5F0] text-[#166534]">
              <CalendarClock aria-hidden="true" className="h-5 w-5" />
            </span>
          </div>
          {nextPayment && (
            <>
              <p className="mt-2 text-sm text-slate-600">Due {formatShortDate(nextPayment.installment.due_date)} · {nextPayment.loan.loan_number}</p>
              <button type="button" onClick={() => showSchedule(nextPayment.loan.id)} className={`${SECONDARY_ACTION} mt-5 self-start`}>
                View payment schedule <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </button>
              <p className="mt-auto pt-5 text-sm text-slate-600">Your cooperative manager records repayments.</p>
            </>
          )}
        </section>
      </div>

      <div role="group" aria-label="Loan views" className="grid grid-cols-3 gap-1 rounded-xl border border-[#E2E8E4] bg-[#EDF3EF] p-1">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={section === id} aria-controls="member-loans-panel" onClick={() => {
            onSectionChange(id);
            setExpandedId(null);
          }} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-1.5 text-xs font-semibold sm:px-3 sm:text-sm ${section === id ? 'bg-white text-[#14532D] shadow-sm' : 'text-slate-600 hover:bg-white/60'}`}>
            <Icon aria-hidden="true" className="hidden h-4 w-4 sm:block" /> {label}
          </button>
        ))}
      </div>

      <section id="member-loans-panel" className="space-y-3">
        {section === 'applications' ? (
          <>
            <h2 className="text-lg font-bold text-slate-950">Loan applications</h2>
            {applications.length === 0 ? <EmptyState title="No applications yet" description="Submitted applications will appear here with their review status." /> : applications.map((application) => (
              <article key={application.id} className={`${CARD} flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5`}>
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-semibold text-slate-950">{application.purpose}</h3>
                  <p className="mt-1 text-sm text-slate-600">{application.term_months} months · {formatShortDate(application.created_at)}</p>
                  {application.reviewer_remarks && <p className="mt-2 break-words text-sm text-slate-600">{application.reviewer_remarks}</p>}
                </div>
                <div className="text-right">
                  <p className="mb-1 font-semibold tabular-nums text-slate-950">{formatPHP(application.requested_amount)}</p>
                  <StatusLabel tone={application.status === 'approved' ? 'green' : application.status === 'rejected' ? 'red' : 'amber'} label={application.status.replace('_', ' ')} />
                </div>
              </article>
            ))}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-950">{section === 'history' ? 'Loan history' : 'Loan accounts'}</h2>
                {section === 'accounts' && openLoans.length > 0 && <p className="text-sm text-slate-600">Outstanding balance {formatPHP(outstanding)}</p>}
              </div>
              {section === 'history' && (
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Filter loan history by status" value={historyStatus} onChange={(event) => { setHistoryStatus(event.target.value as LoanHistoryStatusFilter); setHistoryPage(1); }}
                    className="min-h-11 rounded-xl border border-[#D6E6DD] bg-white px-2 text-sm text-slate-700">
                    <option value="all">All statuses</option><option value="fully_paid">Fully paid</option><option value="approved">Approved</option>
                    <option value="disbursed">Disbursed</option><option value="active">Active</option><option value="overdue">Overdue</option>
                  </select>
                  <select aria-label="Sort loan history by date" value={historySort} onChange={(event) => { setHistorySort(event.target.value as LoanHistorySortOrder); setHistoryPage(1); }}
                    className="min-h-11 rounded-xl border border-[#D6E6DD] bg-white px-2 text-sm text-slate-700">
                    <option value="desc">Newest first</option><option value="asc">Oldest first</option>
                  </select>
                </div>
              )}
            </div>
            {accounts.length === 0 ? (
              <EmptyState title={section === 'history' ? 'No matching loan records' : 'No open loan accounts'} description={section === 'history' ? 'Try another status or check back after opening an account.' : 'Your loan accounts and installment schedules will appear here.'} />
            ) : accounts.map((loan) => (
              <LoanAccount key={loan.id} loan={loan} expanded={expandedId === loan.id} history={section === 'history'} onToggle={() => setExpandedId(expandedId === loan.id ? null : loan.id)} />
            ))}
            {section === 'history' && history.totalPages > 1 && (
              <nav aria-label="Loan history pagination" className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-sm text-slate-600">{history.startIndex}–{history.endIndex} of {history.total} loans</span>
                <div className="flex gap-2">
                  <button type="button" className={SECONDARY_ACTION} disabled={history.page <= 1} onClick={() => setHistoryPage(history.page - 1)}><ChevronLeft aria-hidden="true" className="h-4 w-4" /> Previous</button>
                  <button type="button" className={SECONDARY_ACTION} disabled={history.page >= history.totalPages} onClick={() => setHistoryPage(history.page + 1)}>Next <ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
