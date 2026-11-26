import type { ReportTabView } from '../../lib/reportExport';
import type { ReportPeriod } from '../../lib/reportPeriods';
import type { LedgerOptions } from './ReportLedger';

export interface ReportPreset {
  tab: ReportTabView;
  period: ReportPeriod;
  segment: string;
  searchColumn: string;
  ledger: LedgerOptions;
}

const storageKey = (userId: string) => `argivit:report-favorites:${userId}`;

export function readReportFavorites(userId: string): ReportPreset[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((preset): preset is ReportPreset =>
      preset &&
      ['overview', 'pos', 'loans'].includes(preset.tab) &&
      ['daily', 'weekly', 'monthly', 'annually'].includes(preset.period) &&
      typeof preset.segment === 'string' && typeof preset.searchColumn === 'string' &&
      typeof preset.ledger?.search === 'string' && typeof preset.ledger?.sort === 'string' &&
      typeof preset.ledger?.descending === 'boolean'
    );
  } catch {
    return [];
  }
}

export function writeReportFavorites(userId: string, presets: ReportPreset[]): boolean {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}
