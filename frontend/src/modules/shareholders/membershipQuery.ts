import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { ShareCapitalAccount, ShareCapitalPayment, ShareholderDocument, ShareholderProfile } from '../../types/domain';

export interface ShareholderMembership {
  profile: ShareholderProfile;
  capital_account: ShareCapitalAccount | null;
  capital_payments: ShareCapitalPayment[];
  documents: ShareholderDocument[];
  required_share_capital: number;
  loan_access: boolean;
}

export function membershipQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ['shareholder-me', userId],
    enabled: Boolean(userId),
    queryFn: async ({ signal }) => (await apiRequest<ShareholderMembership | null>('/shareholders/me', { signal })).data,
  });
}
