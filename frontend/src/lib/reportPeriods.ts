export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'annually';

export interface ReportPeriodRange {
  period: ReportPeriod;
  label: string;
  startIso: string;
  endIso: string;
}

export function getPeriodDateRange(
  period: ReportPeriod,
  referenceDate: Date = new Date()
): ReportPeriodRange {
  const end = new Date(referenceDate);
  end.setUTCHours(23, 59, 59, 999);

  const start = new Date(referenceDate);
  let label = 'Daily Report';

  switch (period) {
    case 'daily': {
      start.setUTCHours(0, 0, 0, 0);
      label = `Daily (${start.toISOString().slice(0, 10)})`;
      break;
    }
    case 'weekly': {
      start.setUTCDate(start.getUTCDate() - 6);
      start.setUTCHours(0, 0, 0, 0);
      label = `Weekly (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})`;
      break;
    }
    case 'monthly': {
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      label = `Monthly (${start.toISOString().slice(0, 7)})`;
      break;
    }
    case 'annually': {
      start.setUTCMonth(0, 1);
      start.setUTCHours(0, 0, 0, 0);
      label = `Annual (${start.getUTCFullYear()})`;
      break;
    }
  }

  return {
    period,
    label,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function isIsoDateWithinRange(
  isoString: string | null | undefined,
  startIso: string,
  endIso: string
): boolean {
  if (!isoString) return false;
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return false;
  return ts >= Date.parse(startIso) && ts <= Date.parse(endIso);
}
