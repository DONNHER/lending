import test from 'node:test';
import assert from 'node:assert/strict';
import type { Loan } from '../types/domain';
import { getLoanHistoryDateString, queryShareholderLoanHistory } from './loanHistory';

function makeLoan(overrides: Partial<Loan> & { id: string; loan_number: string }): Loan {
  return {
    shareholder_id: 'sh-1',
    application_id: `app-${overrides.id}`,
    principal: 10000,
    interest_rate: 0.06,
    interest_amount: 600,
    term_months: 3,
    status: 'fully_paid',
    disbursed_at: null,
    disbursement_reference: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    installments: [],
    payments: [],
    computed_total_payable: 10600,
    computed_total_paid: 10600,
    computed_balance: 0,
    ...overrides,
  };
}

const sampleLoans: Loan[] = [
  makeLoan({
    id: 'l1',
    loan_number: 'LN-2026-0001',
    status: 'fully_paid',
    completed_at: '2026-10-03T15:00:00.000Z',
    created_at: '2026-07-02T10:00:00.000Z',
  }),
  makeLoan({
    id: 'l2',
    loan_number: 'LN-2026-0002',
    status: 'active',
    disbursed_at: '2026-11-01T10:00:00.000Z',
    created_at: '2026-10-30T10:00:00.000Z',
  }),
  makeLoan({
    id: 'l3',
    loan_number: 'LN-2026-0003',
    status: 'overdue',
    disbursed_at: '2026-08-15T10:00:00.000Z',
    created_at: '2026-08-14T10:00:00.000Z',
  }),
  makeLoan({
    id: 'l4',
    loan_number: 'LN-2026-0004',
    status: 'fully_paid',
    completed_at: '2026-06-20T12:00:00.000Z',
    created_at: '2026-03-20T12:00:00.000Z',
  }),
  makeLoan({
    id: 'l5',
    loan_number: 'LN-2026-0005',
    status: 'approved',
    created_at: '2026-11-12T08:00:00.000Z',
  }),
  makeLoan({
    id: 'l6',
    loan_number: 'LN-2026-0006',
    status: 'fully_paid',
    completed_at: '2026-11-10T09:00:00.000Z',
    created_at: '2026-09-01T09:00:00.000Z',
  }),
];

test('getLoanHistoryDateString prefers completed_at, then disbursed_at, then created_at', () => {
  assert.equal(
    getLoanHistoryDateString(sampleLoans[0]),
    '2026-10-03T15:00:00.000Z'
  );
  assert.equal(
    getLoanHistoryDateString(sampleLoans[1]),
    '2026-11-01T10:00:00.000Z'
  );
  assert.equal(
    getLoanHistoryDateString(sampleLoans[4]),
    '2026-11-12T08:00:00.000Z'
  );
});

test('queryShareholderLoanHistory filters by status and sorts newest/oldest first', () => {
  const paidDesc = queryShareholderLoanHistory(sampleLoans, {
    status: 'fully_paid',
    sortOrder: 'desc',
    page: 1,
    pageSize: 5,
  });
  assert.equal(paidDesc.total, 3);
  assert.deepEqual(
    paidDesc.items.map((l) => l.loan_number),
    ['LN-2026-0006', 'LN-2026-0001', 'LN-2026-0004']
  );

  const paidAsc = queryShareholderLoanHistory(sampleLoans, {
    status: 'fully_paid',
    sortOrder: 'asc',
    page: 1,
    pageSize: 5,
  });
  assert.deepEqual(
    paidAsc.items.map((l) => l.loan_number),
    ['LN-2026-0004', 'LN-2026-0001', 'LN-2026-0006']
  );
});

test('queryShareholderLoanHistory paginates and clamps out-of-range pages', () => {
  const page1 = queryShareholderLoanHistory(sampleLoans, {
    status: 'all',
    sortOrder: 'desc',
    page: 1,
    pageSize: 4,
  });
  assert.equal(page1.total, 6);
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.startIndex, 1);
  assert.equal(page1.endIndex, 4);
  assert.equal(page1.items.length, 4);

  const page2 = queryShareholderLoanHistory(sampleLoans, {
    status: 'all',
    sortOrder: 'desc',
    page: 5,
    pageSize: 4,
  });
  assert.equal(page2.page, 2);
  assert.equal(page2.startIndex, 5);
  assert.equal(page2.endIndex, 6);
  assert.equal(page2.items.length, 2);
});

test('queryShareholderLoanHistory handles empty matches cleanly', () => {
  const empty = queryShareholderLoanHistory(sampleLoans, {
    status: 'disbursed',
    sortOrder: 'desc',
    page: 1,
    pageSize: 5,
  });
  assert.equal(empty.total, 0);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.page, 1);
  assert.equal(empty.startIndex, 0);
  assert.equal(empty.endIndex, 0);
  assert.deepEqual(empty.items, []);
});
