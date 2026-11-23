import type {
  CapitalStatus,
  InstallmentStatus,
  Loan,
  LoanApplication,
  LoanEligibilityEvaluation,
  LoanInstallment,
  LoanStateStage,
  OfflineSyncEventPayload,
  ShareCapitalPayment,
  ShareholderProfile,
} from '../types/domain';

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function convertToBaseUnit(quantity: number, conversionFactor: number): number {
  if (quantity <= 0 || conversionFactor <= 0) {
    throw new Error('Quantity and conversion factor must be greater than zero.');
  }
  return roundQuantity(quantity * conversionFactor);
}

export function validateStockAvailability(
  requestedBaseQty: number,
  availableBaseQty: number
): { ok: boolean; shortfall: number } {
  const shortfall = roundQuantity(Math.max(0, requestedBaseQty - availableBaseQty));
  return {
    ok: availableBaseQty + 0.0001 >= requestedBaseQty,
    shortfall,
  };
}

export function computeSaleTotals(
  items: Array<{ quantity: number; conversionFactor: number; unitPrice: number }>
): { totalAmount: number; totalBaseQuantity: number } {
  let totalAmount = 0;
  let totalBaseQuantity = 0;
  for (const item of items) {
    totalAmount += item.quantity * item.unitPrice;
    totalBaseQuantity += convertToBaseUnit(item.quantity, item.conversionFactor);
  }
  return {
    totalAmount: roundCurrency(totalAmount),
    totalBaseQuantity: roundQuantity(totalBaseQuantity),
  };
}

export function computeShareCapitalStatus(
  requiredAmount: number,
  payments: Pick<ShareCapitalPayment, 'amount' | 'status'>[]
): { paidAmount: number; remainingAmount: number; status: CapitalStatus } {
  const verifiedTotal = payments
    .filter((p) => p.status === 'verified')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const paidAmount = roundCurrency(verifiedTotal);
  const remainingAmount = roundCurrency(Math.max(0, requiredAmount - paidAmount));

  let status: CapitalStatus = 'unpaid';
  if (paidAmount >= requiredAmount && requiredAmount > 0) {
    status = 'paid';
  } else if (paidAmount > 0) {
    status = 'partial';
  }

  return { paidAmount, remainingAmount, status };
}

export function generateInstallmentSchedule(params: {
  loanId: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  startDateIso: string;
}): LoanInstallment[] {
  const { loanId, principal, interestRate, termMonths, startDateIso } = params;
  if (principal <= 0 || termMonths <= 0) {
    throw new Error('Principal and term months must be positive.');
  }
  const totalInterest = roundCurrency(principal * interestRate);
  const basePrincipalPerInst = Math.floor((principal / termMonths) * 100) / 100;
  const baseInterestPerInst = Math.floor((totalInterest / termMonths) * 100) / 100;

  let allocatedPrincipal = 0;
  let allocatedInterest = 0;
  const startDate = new Date(startDateIso);
  const installments: LoanInstallment[] = [];

  for (let i = 1; i <= termMonths; i++) {
    const isLast = i === termMonths;
    const principalDue = isLast
      ? roundCurrency(principal - allocatedPrincipal)
      : basePrincipalPerInst;
    const interestDue = isLast
      ? roundCurrency(totalInterest - allocatedInterest)
      : baseInterestPerInst;

    allocatedPrincipal = roundCurrency(allocatedPrincipal + principalDue);
    allocatedInterest = roundCurrency(allocatedInterest + interestDue);

    const dueDate = new Date(startDate);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + i);

    installments.push({
      id: `${loanId}-inst-${i}`,
      loan_id: loanId,
      installment_number: i,
      due_date: dueDate.toISOString().slice(0, 10),
      principal_due: principalDue,
      interest_due: interestDue,
      fees_due: 0,
      amount_due: roundCurrency(principalDue + interestDue),
      principal_paid: 0,
      interest_paid: 0,
      fees_paid: 0,
      amount_paid: 0,
      status: 'pending',
      paid_at: null,
    });
  }

  return installments;
}

export function allocateLoanPayment(
  installments: LoanInstallment[],
  paymentAmount: number,
  paidAtIso: string
): {
  updatedInstallments: LoanInstallment[];
  allocations: Array<{
    installment_id: string;
    principal_paid: number;
    interest_paid: number;
    fees_paid: number;
  }>;
  unappliedRemainder: number;
} {
  if (paymentAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  let remaining = roundCurrency(paymentAmount);
  const sorted = [...installments].sort((a, b) => a.installment_number - b.installment_number);
  const allocations: Array<{
    installment_id: string;
    principal_paid: number;
    interest_paid: number;
    fees_paid: number;
  }> = [];

  const updatedInstallments = sorted.map((inst) => {
    if (remaining <= 0 || inst.status === 'paid') {
      return { ...inst };
    }

    const feesOwed = roundCurrency(Math.max(0, inst.fees_due - inst.fees_paid));
    const interestOwed = roundCurrency(Math.max(0, inst.interest_due - inst.interest_paid));
    const principalOwed = roundCurrency(Math.max(0, inst.principal_due - inst.principal_paid));

    const payFees = Math.min(remaining, feesOwed);
    remaining = roundCurrency(remaining - payFees);

    const payInterest = Math.min(remaining, interestOwed);
    remaining = roundCurrency(remaining - payInterest);

    const payPrincipal = Math.min(remaining, principalOwed);
    remaining = roundCurrency(remaining - payPrincipal);

    const totalAppliedHere = roundCurrency(payFees + payInterest + payPrincipal);
    if (totalAppliedHere > 0) {
      allocations.push({
        installment_id: inst.id,
        principal_paid: roundCurrency(payPrincipal),
        interest_paid: roundCurrency(payInterest),
        fees_paid: roundCurrency(payFees),
      });
    }

    const newFeesPaid = roundCurrency(inst.fees_paid + payFees);
    const newInterestPaid = roundCurrency(inst.interest_paid + payInterest);
    const newPrincipalPaid = roundCurrency(inst.principal_paid + payPrincipal);
    const newAmountPaid = roundCurrency(newFeesPaid + newInterestPaid + newPrincipalPaid);
    const totalDue = roundCurrency(inst.principal_due + inst.interest_due + inst.fees_due);

    let newStatus: InstallmentStatus = inst.status;
    if (newAmountPaid >= totalDue - 0.005) {
      newStatus = 'paid';
    } else if (newAmountPaid > 0) {
      newStatus = 'partial';
    }

    return {
      ...inst,
      fees_paid: newFeesPaid,
      interest_paid: newInterestPaid,
      principal_paid: newPrincipalPaid,
      amount_paid: newAmountPaid,
      status: newStatus,
      paid_at: newStatus === 'paid' ? paidAtIso : inst.paid_at ?? null,
    };
  });

  return {
    updatedInstallments,
    allocations,
    unappliedRemainder: roundCurrency(remaining),
  };
}

export function calculateLoanLedgerBalance(
  principal: number,
  interestAmount: number,
  installments: Pick<LoanInstallment, 'fees_due' | 'amount_paid'>[]
): {
  totalPayable: number;
  totalPaid: number;
  remainingBalance: number;
} {
  const totalFees = installments.reduce((sum, i) => sum + Number(i.fees_due || 0), 0);
  const totalPayable = roundCurrency(principal + interestAmount + totalFees);
  const totalPaid = roundCurrency(
    installments.reduce((sum, i) => sum + Number(i.amount_paid || 0), 0)
  );
  const remainingBalance = roundCurrency(Math.max(0, totalPayable - totalPaid));
  return { totalPayable, totalPaid, remainingBalance };
}

export function evaluateLoanEligibility(params: {
  shareholder: Pick<ShareholderProfile, 'verification_status'>;
  verifiedCapitalPaid: number;
  requiredCapital: number;
  capitalMultiplier: number;
  currency?: string;
  loans: Pick<Loan, 'status' | 'principal' | 'computed_balance' | 'installments'>[];
  applications: Array<Pick<LoanApplication, 'status'> & { requested_amount?: number }>;
  eligibilityRecord?: {
    withdrawal_blocked?: boolean;
    next_eligible_at?: string | null;
    restriction_reason?: string | null;
  } | null;
  nowIso?: string;
}): LoanEligibilityEvaluation {
  const {
    shareholder,
    verifiedCapitalPaid,
    requiredCapital,
    capitalMultiplier,
    currency = 'PHP',
    loans,
    applications,
    eligibilityRecord,
    nowIso = new Date().toISOString(),
  } = params;

  const capitalPaidEnough = verifiedCapitalPaid >= requiredCapital && requiredCapital > 0;
  const maximumLoan = roundCurrency(verifiedCapitalPaid * capitalMultiplier);

  const completedLoans = loans.filter((l) => l.status === 'fully_paid');
  const higherLoanPrivilege = completedLoans.length > 0;

  const activeLoans = loans.filter((l) => l.status !== 'fully_paid');
  const hasActiveLoan = activeLoans.length > 0;
  const activeExposure = roundCurrency(
    activeLoans.reduce((sum, l) => sum + l.computed_balance, 0)
  );
  const pendingApplications = applications.filter(
    (a) => a.status === 'submitted' || a.status === 'under_review'
  );
  const pendingExposure = roundCurrency(
    pendingApplications.reduce((sum, a) => sum + Number(a.requested_amount ?? 0), 0)
  );
  const availableCredit = roundCurrency(
    Math.max(0, maximumLoan - activeExposure - pendingExposure)
  );

  const hasOverdueInstallment = activeLoans.some((l) =>
    l.installments.some((inst) => inst.status === 'overdue')
  );

  const firstInstallmentPaidOnActive = activeLoans.every((l) => {
    const first = l.installments.find((inst) => inst.installment_number === 1);
    return first ? first.status === 'paid' : false;
  });

  const hasPendingApplication = pendingApplications.length > 0;

  // Determine current state machine stage
  let stage: LoanStateStage = 'MEMBERSHIP';
  if (shareholder.verification_status === 'approved' && capitalPaidEnough) {
    stage = 'ELIGIBLE';
  }
  if (hasPendingApplication) {
    stage = 'APPLICATION_SUBMITTED';
  }
  if (activeLoans.some((l) => l.status === 'approved')) {
    stage = 'APPROVED';
  }
  if (activeLoans.some((l) => l.status === 'disbursed')) {
    stage = 'DISBURSED';
  }
  if (activeLoans.some((l) => l.status === 'active')) {
    stage = firstInstallmentPaidOnActive ? 'REAPPLICATION_ALLOWED' : 'ACTIVE_LOAN';
  }
  if (higherLoanPrivilege && !hasActiveLoan && !hasPendingApplication) {
    stage = 'HIGHER_LOAN_PRIVILEGE';
  }

  // Gate 1: Membership verification & fixed share capital
  if (shareholder.verification_status !== 'approved' || !capitalPaidEnough) {
    return {
      eligible: false,
      reason: 'Membership verification and full initial share capital payment are required.',
      available_at: null,
      maximum_loan: 0,
      available_credit: 0,
      verified_capital: verifiedCapitalPaid,
      capital_multiplier: capitalMultiplier,
      currency,
      stage: 'MEMBERSHIP',
      reapplication_allowed: false,
      higher_loan_privilege: false,
      withdrawal_blocked: false,
      has_active_loan: hasActiveLoan,
      has_overdue_installment: hasOverdueInstallment,
    };
  }

  // Gate 2: Violation or ban from delayed/overdue payment
  if (eligibilityRecord?.withdrawal_blocked || hasOverdueInstallment) {
    return {
      eligible: false,
      reason:
        eligibilityRecord?.restriction_reason ||
        'Loan withdrawal privileges are suspended due to an overdue installment.',
      available_at: eligibilityRecord?.next_eligible_at ?? null,
      maximum_loan: maximumLoan,
      available_credit: availableCredit,
      verified_capital: verifiedCapitalPaid,
      capital_multiplier: capitalMultiplier,
      currency,
      stage: 'WITHDRAWAL_SUSPENDED',
      reapplication_allowed: false,
      higher_loan_privilege: higherLoanPrivilege,
      withdrawal_blocked: true,
      has_active_loan: hasActiveLoan,
      has_overdue_installment: hasOverdueInstallment,
    };
  }

  // Gate 3: 7-day cooling ban after overdue settlement
  if (
    eligibilityRecord?.next_eligible_at &&
    new Date(nowIso).getTime() < new Date(eligibilityRecord.next_eligible_at).getTime()
  ) {
    return {
      eligible: false,
      reason: '7-day waiting period after overdue settlement is active.',
      available_at: eligibilityRecord.next_eligible_at,
      maximum_loan: maximumLoan,
      available_credit: availableCredit,
      verified_capital: verifiedCapitalPaid,
      capital_multiplier: capitalMultiplier,
      currency,
      stage: 'WAITING_PERIOD',
      reapplication_allowed: false,
      higher_loan_privilege: higherLoanPrivilege,
      withdrawal_blocked: false,
      has_active_loan: hasActiveLoan,
      has_overdue_installment: false,
    };
  }

  // Gate 4: Credit ceiling reached
  if (availableCredit <= 0) {
    return {
      eligible: false,
      reason: `Loan credit ceiling (${capitalMultiplier} × verified share capital) has been reached.`,
      available_at: null,
      maximum_loan: maximumLoan,
      available_credit: 0,
      verified_capital: verifiedCapitalPaid,
      capital_multiplier: capitalMultiplier,
      currency,
      stage,
      reapplication_allowed: false,
      higher_loan_privilege: higherLoanPrivilege,
      withdrawal_blocked: false,
      has_active_loan: hasActiveLoan,
      has_overdue_installment: false,
    };
  }

  return {
    eligible: true,
    available_at: null,
    maximum_loan: maximumLoan,
    available_credit: availableCredit,
    verified_capital: verifiedCapitalPaid,
    capital_multiplier: capitalMultiplier,
    currency,
    stage,
    reapplication_allowed: true,
    higher_loan_privilege: higherLoanPrivilege,
    withdrawal_blocked: false,
    has_active_loan: hasActiveLoan,
    has_overdue_installment: false,
  };
}

export function checkSyncEventConflict(
  processedEventIds: Set<string>,
  incoming: OfflineSyncEventPayload,
  stockLookup: (productId: string) => { name: string; stockBase: number } | undefined
):
  | { status: 'duplicate_ignored' }
  | {
      status: 'conflict';
      conflictItem: {
        productId: string;
        productName: string;
        requestedBaseQty: number;
        availableBaseQty: number;
      };
    }
  | { status: 'ready' } {
  if (processedEventIds.has(incoming.event_id)) {
    return { status: 'duplicate_ignored' };
  }

  const requestedStock = new Map<string, number>();
  for (const item of incoming.payload.items) {
    const requested = roundQuantity((requestedStock.get(item.product_id) ?? 0) + item.quantity_base);
    const product = stockLookup(item.product_id);
    if (!product) {
      return {
        status: 'conflict',
        conflictItem: {
          productId: item.product_id,
          productName: item.product_name,
          requestedBaseQty: requested,
          availableBaseQty: 0,
        },
      };
    }
    const check = validateStockAvailability(requested, product.stockBase);
    if (!check.ok) {
      return {
        status: 'conflict',
        conflictItem: {
          productId: item.product_id,
          productName: product.name,
          requestedBaseQty: requested,
          availableBaseQty: product.stockBase,
        },
      };
    }
    requestedStock.set(item.product_id, requested);
  }

  return { status: 'ready' };
}
