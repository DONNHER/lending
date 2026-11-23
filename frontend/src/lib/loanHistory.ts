import type { Loan, LoanStatus } from '../types/domain';

export type LoanHistoryStatusFilter = 'all' | LoanStatus;
export type LoanHistorySortOrder = 'desc' | 'asc';

export interface LoanHistoryQueryOptions {
  status: LoanHistoryStatusFilter;
  sortOrder: LoanHistorySortOrder;
  page: number;
  pageSize: number;
}

export interface LoanHistoryQueryResult {
  items: Loan[];
  total: number;
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export function getLoanHistoryDateString(loan: Pick<Loan, 'completed_at' | 'disbursed_at' | 'created_at'>): string {
  return loan.completed_at || loan.disbursed_at || loan.created_at;
}

export function queryShareholderLoanHistory(
  loans: Loan[],
  options: LoanHistoryQueryOptions
): LoanHistoryQueryResult {
  const safePageSize = Math.max(1, Math.floor(options.pageSize));
  const filtered =
    options.status === 'all'
      ? loans.slice()
      : loans.filter((loan) => loan.status === options.status);

  filtered.sort((a, b) => {
    const timeA = Date.parse(getLoanHistoryDateString(a)) || 0;
    const timeB = Date.parse(getLoanHistoryDateString(b)) || 0;
    if (timeA !== timeB) {
      return options.sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    }
    return options.sortOrder === 'asc'
      ? a.loan_number.localeCompare(b.loan_number)
      : b.loan_number.localeCompare(a.loan_number);
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(options.page)), totalPages);
  const startOffset = (page - 1) * safePageSize;
  const items = filtered.slice(startOffset, startOffset + safePageSize);

  return {
    items,
    total,
    page,
    totalPages,
    startIndex: total === 0 ? 0 : startOffset + 1,
    endIndex: startOffset + items.length,
  };
}
