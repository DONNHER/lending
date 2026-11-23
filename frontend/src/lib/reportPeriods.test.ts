import test from 'node:test';
import assert from 'node:assert/strict';
import { getPeriodDateRange, isIsoDateWithinRange } from './reportPeriods';

test('getPeriodDateRange computes accurate daily, weekly, monthly, and annual boundaries', () => {
  const ref = new Date('2026-11-15T14:30:00.000Z');

  const daily = getPeriodDateRange('daily', ref);
  assert.equal(daily.startIso, '2026-11-15T00:00:00.000Z');
  assert.equal(daily.endIso, '2026-11-15T23:59:59.999Z');

  const weekly = getPeriodDateRange('weekly', ref);
  assert.equal(weekly.startIso, '2026-11-09T00:00:00.000Z');
  assert.equal(weekly.endIso, '2026-11-15T23:59:59.999Z');

  const monthly = getPeriodDateRange('monthly', ref);
  assert.equal(monthly.startIso, '2026-11-01T00:00:00.000Z');
  assert.equal(monthly.endIso, '2026-11-15T23:59:59.999Z');

  const annually = getPeriodDateRange('annually', ref);
  assert.equal(annually.startIso, '2026-01-01T00:00:00.000Z');
  assert.equal(annually.endIso, '2026-11-15T23:59:59.999Z');
});

test('isIsoDateWithinRange matches timestamps cleanly inside bounds', () => {
  const ref = new Date('2026-11-15T14:30:00.000Z');
  const weekly = getPeriodDateRange('weekly', ref);

  assert.equal(isIsoDateWithinRange('2026-11-13T10:00:00.000Z', weekly.startIso, weekly.endIso), true);
  assert.equal(isIsoDateWithinRange('2026-11-01T10:00:00.000Z', weekly.startIso, weekly.endIso), false);
  assert.equal(isIsoDateWithinRange(null, weekly.startIso, weekly.endIso), false);
});
