import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { roundCurrency } from '../../lib/domainRules';
import { formatPHP } from '../../lib/productAssets';

export interface LoanApplicationDraft {
  requested_amount: number;
  term_months: number;
  purpose: string;
}

interface LoanApplicationFormProps {
  availableCredit: number;
  interestRate: number;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (draft: LoanApplicationDraft) => void;
}

const APPLICATION_STEPS = [
  { id: 'amount', label: 'Amount', title: 'How much do you need?' },
  { id: 'plan', label: 'Repayment', title: 'Choose a repayment plan' },
  { id: 'review', label: 'Review', title: 'Review your application' },
] as const;
type ApplicationStep = (typeof APPLICATION_STEPS)[number]['id'];

export function LoanApplicationForm({ availableCredit, interestRate, isPending, onCancel, onSubmit }: LoanApplicationFormProps) {
  const [step, setStep] = useState<ApplicationStep>('amount');
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState(6);
  const [purpose, setPurpose] = useState('');

  const principal = Number(amount);
  const interest = roundCurrency(principal * interestRate);
  const total = roundCurrency(principal + interest);
  const validAmount = Number.isFinite(principal) && principal >= 1 && principal <= availableCredit;
  const validPurpose = purpose.trim().length >= 5;
  const currentStep = APPLICATION_STEPS.findIndex(({ id }) => id === step);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAmount || isPending) return;
    if (step === 'amount') {
      setStep('plan');
    } else if (validPurpose && step === 'plan') {
      setStep('review');
    } else if (validPurpose) {
      onSubmit({ requested_amount: principal, term_months: term, purpose: purpose.trim() });
    }
  }

  function goBack() {
    if (step === 'review') setStep('plan');
    else if (step === 'plan') setStep('amount');
    else onCancel();
  }

  return (
    <section aria-labelledby="loan-application-title" className="mx-auto w-full max-w-2xl space-y-4">
      <header>
        <button type="button" onClick={goBack} disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-[#14532D] disabled:opacity-50">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {step === 'amount' ? 'Loan overview' : 'Previous step'}
        </button>
        <h1 id="loan-application-title" className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Loan application</h1>
      </header>

      <ol aria-label="Application progress" className="grid grid-cols-3 gap-3 rounded-xl border border-[#E2E8E4] bg-white p-3 sm:p-4">
        {APPLICATION_STEPS.map(({ id, label }, index) => (
          <li key={id} aria-current={step === id ? 'step' : undefined} className={`border-t-4 pt-2 text-xs font-semibold sm:text-sm ${index <= currentStep ? 'border-[#15803D] text-[#14532D]' : 'border-[#E2E8E4] text-slate-500'}`}>
            {label}
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-[#E2E8E4] bg-white p-5 sm:p-7">
        <h2 className="text-xl font-bold text-slate-950" aria-live="polite">{APPLICATION_STEPS[currentStep].title}</h2>
        {step === 'amount' && (
          <div>
            <label htmlFor="loan-amount" className="block text-sm font-semibold text-slate-800">Loan amount</label>
            <input id="loan-amount" type="number" inputMode="decimal" min="1" max={availableCredit} step="0.01" required
              value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="₱0.00"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-2xl font-semibold tabular-nums" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-600">Available to borrow {formatPHP(availableCredit)}</span>
              <button type="button" onClick={() => setAmount(String(availableCredit))} className="font-semibold text-emerald-800">Use maximum</button>
            </div>
          </div>
        )}

        {step === 'plan' && (
          <>
            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">Monthly installments</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[3, 6, 12].map((months) => (
                  <label key={months} className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 ${term === months ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200'}`}>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <input type="radio" name="loan-term" checked={term === months} onChange={() => setTerm(months)} className="accent-emerald-700" />
                      {months} months
                    </span>
                    <span className="text-xs text-slate-600">About {formatPHP(total / months)} / month</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm font-semibold text-slate-800">
              What will you use the loan for?
              <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} required minLength={5} rows={2}
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
            </label>
          </>
        )}

        {step === 'review' && (
          <>
            <dl className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
              {[
                ['Loan amount', formatPHP(principal)],
                [`Flat interest for the full term (${(interestRate * 100).toFixed(1)}%)`, formatPHP(interest)],
                ['Repayment plan', `${term} monthly installments`],
                ['Estimated monthly payment', formatPHP(total / term)],
                ['Purpose', purpose.trim()],
                ['Total to repay', formatPHP(total)],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 last:border-t last:border-slate-200 last:pt-3 last:text-base">
                  <dt className="text-slate-600">{label}</dt><dd className="break-words font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-slate-600">Your application goes to the cooperative manager for approval.</p>
          </>
        )}

        <button type="submit" disabled={isPending || !validAmount || (step !== 'amount' && !validPurpose)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          {isPending ? 'Submitting…' : step === 'amount' ? 'Continue' : step === 'plan' ? 'Review application' : 'Submit application'}
          {!isPending && step !== 'review' && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>
    </section>
  );
}
