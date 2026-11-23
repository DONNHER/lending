import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateLoanPayment,
  calculateLoanLedgerBalance,
  checkSyncEventConflict,
  computeSaleTotals,
  computeShareCapitalStatus,
  convertToBaseUnit,
  evaluateLoanEligibility,
  generateInstallmentSchedule,
  validateStockAvailability,
} from './domainRules';

test('dual-unit conversion converts sacks and kg to base kg accurately', () => {
  assert.equal(convertToBaseUnit(2, 50), 100);
  assert.equal(convertToBaseUnit(3.5, 1), 3.5);
  assert.throws(() => convertToBaseUnit(0, 50));
});

test('stock availability validates base quantity thresholds', () => {
  assert.deepEqual(validateStockAvailability(100, 150), { ok: true, shortfall: 0 });
  assert.deepEqual(validateStockAvailability(160, 150), { ok: false, shortfall: 10 });
});

test('computeSaleTotals sums currency and base unit quantities', () => {
  const res = computeSaleTotals([
    { quantity: 2, conversionFactor: 50, unitPrice: 1250 },
    { quantity: 5, conversionFactor: 1, unitPrice: 28 },
  ]);
  assert.equal(res.totalAmount, 2640);
  assert.equal(res.totalBaseQuantity, 105);
});

test('fixed share capital status computes strictly from verified payment records', () => {
  const partial = computeShareCapitalStatus(5000, [
    { amount: 2500, status: 'verified' },
    { amount: 2500, status: 'pending' },
  ]);
  assert.equal(partial.paidAmount, 2500);
  assert.equal(partial.remainingAmount, 2500);
  assert.equal(partial.status, 'partial');

  const paid = computeShareCapitalStatus(5000, [
    { amount: 2500, status: 'verified' },
    { amount: 2500, status: 'verified' },
  ]);
  assert.equal(paid.paidAmount, 5000);
  assert.equal(paid.remainingAmount, 0);
  assert.equal(paid.status, 'paid');
});

test('loan eligibility enforces membership, 6x ceiling, available credit withdrawals, overdue ban, and 7-day wait', () => {
  // 1. Unverified shareholder
  const unverified = evaluateLoanEligibility({
    shareholder: { verification_status: 'pending_review' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [],
    applications: [],
  });
  assert.equal(unverified.eligible, false);
  assert.equal(unverified.maximum_loan, 0);
  assert.equal(unverified.stage, 'MEMBERSHIP');

  // 2. Verified + Paid -> 6x ceiling (30,000 PHP)
  const eligible = evaluateLoanEligibility({
    shareholder: { verification_status: 'approved' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [],
    applications: [],
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.maximum_loan, 30000);
  assert.equal(eligible.stage, 'ELIGIBLE');

  // 3. Active loan without overdue or ban -> still eligible to withdraw/apply up to available credit
  const schedule = generateInstallmentSchedule({
    loanId: 'loan-1',
    principal: 10000,
    interestRate: 0.06,
    termMonths: 3,
    startDateIso: '2026-11-01T00:00:00Z',
  });
  const activeNoViolation = evaluateLoanEligibility({
    shareholder: { verification_status: 'approved' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [{ status: 'active', principal: 10000, computed_balance: 10600, installments: schedule }],
    applications: [],
  });
  assert.equal(activeNoViolation.eligible, true);
  assert.equal(activeNoViolation.reapplication_allowed, true);
  assert.equal(activeNoViolation.available_credit, 19400);

  // 4. Pending applications reserve available credit; exhausted ceiling blocks further withdrawals
  const exhaustedByPending = evaluateLoanEligibility({
    shareholder: { verification_status: 'approved' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [{ status: 'active', principal: 10000, computed_balance: 10600, installments: schedule }],
    applications: [{ status: 'submitted', requested_amount: 19400 }],
  });
  assert.equal(exhaustedByPending.eligible, false);
  assert.equal(exhaustedByPending.available_credit, 0);
  assert.match(exhaustedByPending.reason || '', /6 × verified share capital/);

  // 5. Overdue installment triggers withdrawal suspension
  const overdueSchedule = schedule.map((inst, idx) =>
    idx === 0 ? { ...inst, status: 'overdue' as const } : inst
  );
  const suspendedByOverdue = evaluateLoanEligibility({
    shareholder: { verification_status: 'approved' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [{ status: 'overdue', principal: 10000, computed_balance: 10600, installments: overdueSchedule }],
    applications: [],
  });
  assert.equal(suspendedByOverdue.eligible, false);
  assert.equal(suspendedByOverdue.withdrawal_blocked, true);
  assert.equal(suspendedByOverdue.stage, 'WITHDRAWAL_SUSPENDED');

  // 6. Paying first installment keeps credit open as expected
  const firstPayment = allocateLoanPayment(
    schedule,
    schedule[0].amount_due,
    '2026-11-15T00:00:00Z'
  );
  assert.equal(firstPayment.updatedInstallments[0].status, 'paid');
  const balanceAfterFirst = calculateLoanLedgerBalance(
    10000,
    600,
    firstPayment.updatedInstallments
  );
  const activeAfterFirst = evaluateLoanEligibility({
    shareholder: { verification_status: 'approved' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [
      {
        status: 'active',
        principal: 10000,
        computed_balance: balanceAfterFirst.remainingBalance,
        installments: firstPayment.updatedInstallments,
      },
    ],
    applications: [],
  });
  assert.equal(activeAfterFirst.eligible, true);
  assert.equal(activeAfterFirst.reapplication_allowed, true);
  assert.equal(activeAfterFirst.stage, 'REAPPLICATION_ALLOWED');
  assert.ok(activeAfterFirst.available_credit > 20000);

  // 7. 7-day waiting period after overdue settlement
  const waitingPeriod = evaluateLoanEligibility({
    shareholder: { verification_status: 'approved' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [],
    applications: [],
    eligibilityRecord: {
      withdrawal_blocked: false,
      next_eligible_at: '2026-11-20T00:00:00Z',
    },
    nowIso: '2026-11-15T00:00:00Z',
  });
  assert.equal(waitingPeriod.eligible, false);
  assert.equal(waitingPeriod.stage, 'WAITING_PERIOD');

  const afterWaitingPeriod = evaluateLoanEligibility({
    shareholder: { verification_status: 'approved' },
    verifiedCapitalPaid: 5000,
    requiredCapital: 5000,
    capitalMultiplier: 6,
    loans: [{ status: 'fully_paid', principal: 10000, computed_balance: 0, installments: [] }],
    applications: [],
    eligibilityRecord: {
      withdrawal_blocked: false,
      next_eligible_at: '2026-11-20T00:00:00Z',
    },
    nowIso: '2026-11-21T00:00:00Z',
  });
  assert.equal(afterWaitingPeriod.eligible, true);
  assert.equal(afterWaitingPeriod.higher_loan_privilege, true);
  assert.equal(afterWaitingPeriod.stage, 'HIGHER_LOAN_PRIVILEGE');
});

test('offline sync check detects duplicate event_id and stock conflicts', () => {
  const processed = new Set(['evt-1']);
  const baseEvent = {
    event_id: 'evt-1',
    event_type: 'pos.sale.completed' as const,
    terminal_id: 'TERMINAL-001',
    occurred_at: '2026-11-13T10:30:00+08:00',
    payload: {
      sale_id: 'sale-1',
      payment_method: 'cash' as const,
      items: [
        {
          product_id: 'prod-1',
          product_name: 'Fertilizer',
          sku: 'AGR-001',
          unit_id: 'unit-1',
          unit_name: 'sack',
          quantity: 2,
          conversion_factor: 50,
          quantity_base: 100,
          unit_price: 1250,
          line_total: 2500,
        },
      ],
      total: 2500,
    },
  };

  assert.equal(
    checkSyncEventConflict(processed, baseEvent, () => ({ name: 'Fertilizer', stockBase: 500 }))
      .status,
    'duplicate_ignored'
  );

  const conflictRes = checkSyncEventConflict(
    processed,
    { ...baseEvent, event_id: 'evt-2' },
    () => ({ name: 'Fertilizer', stockBase: 40 })
  );
  assert.equal(conflictRes.status, 'conflict');

  const readyRes = checkSyncEventConflict(
    processed,
    { ...baseEvent, event_id: 'evt-3' },
    () => ({ name: 'Fertilizer', stockBase: 500 })
  );
  assert.equal(readyRes.status, 'ready');
});
