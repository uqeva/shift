import { describe, expect, it } from 'vitest';

import { MAX_REMINDER_LEADS, REMINDER_LEADS, isReminderLead, reminderLeadsOf } from '../src/index.js';

/** Story 17.1: the closed set of reminder leads (AD-18, D-S6). */
describe('reminder leads', () => {
  it('are the six codes, shortest first and the evening last, at most two on', () => {
    expect(REMINDER_LEADS).toEqual(['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE']);
    expect(MAX_REMINDER_LEADS).toBe(2);
  });

  it('recognizes a lead and nothing else', () => {
    for (const lead of REMINDER_LEADS) expect(isReminderLead(lead)).toBe(true);
    for (const value of ['h1', 'H24', '', 'EVENING', null, undefined, 1, ['H1']]) expect(isReminderLead(value)).toBe(false);
  });

  it('reads a list in canonical order, duplicates dropped', () => {
    expect(reminderLeadsOf([])).toEqual([]);
    expect(reminderLeadsOf(['EVENING_BEFORE', 'H2'])).toEqual(['H2', 'EVENING_BEFORE']);
    expect(reminderLeadsOf(['H12', 'H12'])).toEqual(['H12']);
    expect(reminderLeadsOf(['H6', 'H1', 'H6'])).toEqual(['H1', 'H6']);
  });

  it('refuses a list of more than two leads, an unknown code or a non-array', () => {
    expect(reminderLeadsOf(['H1', 'H2', 'H3'])).toBeNull();
    expect(reminderLeadsOf(['H1', 'H4'])).toBeNull();
    expect(reminderLeadsOf(['H1', null])).toBeNull();
    expect(reminderLeadsOf('H1')).toBeNull();
    expect(reminderLeadsOf(null)).toBeNull();
    expect(reminderLeadsOf(undefined)).toBeNull();
    expect(reminderLeadsOf({ 0: 'H1', length: 1 })).toBeNull();
  });
});
