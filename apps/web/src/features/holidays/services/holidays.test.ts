import type { NationalHolidayCode } from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  FIRST_IMPORT_YEAR,
  HOLIDAY_DATE_EMPTY,
  HOLIDAY_DATE_INVALID,
  LAST_PICKED_YEAR,
  FIRST_PICKED_YEAR,
  steppedYearOf,
  HOLIDAY_NAME_CONTROL,
  HOLIDAY_NAME_EMPTY,
  HOLIDAY_NAME_TOO_LONG,
  HOLIDAY_TAKEN,
  enteredHolidayNameOf,
  enteredHolidayOf,
  holidaysOfYear,
  holidaysSurfaceStateOf,
  importProposalOf,
  isPastDate,
  nationalHolidayMessageKey,
} from '@/features/holidays/services/holidays';
import { holidayRow, planningSnapshotOf } from '@/features/planning/planning.fixture';
import hr from '@/lib/i18n/locales/hr.json';
import { initLocalization, t } from '@/lib/i18n';

/**
 * STORY 21.17 — the *Blagdani* card's rules: a year's view, the import's
 * proposal (the I/O matrix's import rows and the before-2020 row), and the
 * draft refusals of *Dodaj blagdan* (a taken date, a past date).
 */

const nameOf = (code: NationalHolidayCode): string => t(nationalHolidayMessageKey(code));

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf();
});

describe('the year view', () => {
  it("lists only the year's holidays, by date, and none for an empty year", async () => {
    const calendar = await planningSnapshotOf({
      holidays: [holidayRow('h-2', '2027-01-06', 'Sveta tri kralja'), holidayRow('h-1', '2026-12-25', 'Božić'), holidayRow('h-3', '2027-01-01', 'Nova godina')],
    });

    expect(holidaysOfYear(calendar, 2027).map((holiday) => holiday.date)).toEqual(['2027-01-01', '2027-01-06']);
    expect(holidaysOfYear(calendar, 2026).map((holiday) => holiday.name)).toEqual(['Božić']);
    expect(holidaysOfYear(calendar, 2028)).toEqual([]);
  });

  it('reads the snapshot answer as the card draws it', () => {
    expect(holidaysSurfaceStateOf({ data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' })).toEqual({
      calendar: null,
      unavailable: false,
      loading: true,
    });
    expect(holidaysSurfaceStateOf({ data: undefined, isError: true, isPending: false, fetchStatus: 'idle' }).unavailable).toBe(true);
    expect(holidaysSurfaceStateOf({ data: undefined, isError: false, isPending: true, fetchStatus: 'paused' }).unavailable).toBe(true);
    expect(holidaysSurfaceStateOf({ data: plain, isError: false, isPending: false, fetchStatus: 'idle' })).toEqual({
      calendar: plain,
      unavailable: false,
      loading: false,
    });
  });
});

describe('the import proposal (R13.6)', () => {
  it('a fresh year: the 14 holidays of 2027, each with its official name, none stored', () => {
    const proposal = importProposalOf(plain, 2027, '2026-10-01', nameOf);

    expect(proposal?.rows).toHaveLength(14);
    expect(proposal?.missing).toHaveLength(14);
    expect(proposal?.rows.every((row) => row.stored === null && !row.past)).toBe(true);
    expect(proposal?.rows[0]).toMatchObject({ date: '2027-01-01', code: 'NEW_YEAR', name: 'Nova godina' });
    expect(proposal?.rows.find((row) => row.code === 'EASTER_MONDAY')).toMatchObject({ date: '2027-03-29', name: 'Uskrsni ponedjeljak' });
    expect(proposal?.rows.find((row) => row.code === 'CORPUS_CHRISTI')).toMatchObject({ date: '2027-05-27', name: 'Tijelovo' });
  });

  it('every official name is a name the database takes', () => {
    for (const name of Object.values(hr.organization.holidays.national)) {
      expect(enteredHolidayNameOf(name), name).toEqual({ ok: true, name });
    }
  });

  it('every code has exactly one official name in hr.json', () => {
    const codes = (importProposalOf(plain, 2027, null, nameOf)?.rows ?? []).map((row) => row.code);
    const named = Object.keys(hr.organization.holidays.national).sort();

    expect([...codes].sort()).toEqual(named);
    for (const code of codes) expect(nameOf(code), code).not.toBe(nationalHolidayMessageKey(code));
  });

  it('again: all stored, one renamed — nothing new, the stored names kept', async () => {
    const all = importProposalOf(plain, 2027, null, nameOf)?.rows ?? [];
    const calendar = await planningSnapshotOf({
      holidays: all.map((row, index) => holidayRow(`h-${String(index)}`, row.date, index === 0 ? 'Nova godina (preimenovano)' : row.name)),
    });
    const proposal = importProposalOf(calendar, 2027, null, nameOf);

    expect(proposal?.missing).toEqual([]);
    expect(proposal?.rows.every((row) => row.stored !== null)).toBe(true);
    expect(proposal?.rows[0]?.stored?.name).toBe('Nova godina (preimenovano)');
  });

  it('partial: 3 of 14 stored are marked, 11 are missing', async () => {
    const calendar = await planningSnapshotOf({
      holidays: [holidayRow('h-1', '2027-01-01'), holidayRow('h-2', '2027-08-05'), holidayRow('h-3', '2027-12-25')],
    });
    const proposal = importProposalOf(calendar, 2027, null, nameOf);

    expect(proposal?.rows.filter((row) => row.stored !== null).map((row) => row.date)).toEqual(['2027-01-01', '2027-08-05', '2027-12-25']);
    expect(proposal?.missing).toHaveLength(11);
  });

  it('marks past dates, never refusing them', () => {
    const proposal = importProposalOf(plain, 2026, '2026-10-01', nameOf);

    expect(proposal?.missing).toHaveLength(14);
    expect(proposal?.rows.filter((row) => row.past).map((row) => row.date).at(-1)).toBe('2026-08-15');
    expect(proposal?.rows.filter((row) => !row.past).map((row) => row.date)).toEqual(['2026-11-01', '2026-11-18', '2026-12-25', '2026-12-26']);
  });

  it('before 2020: no import is offered', () => {
    expect(FIRST_IMPORT_YEAR).toBe(2020);
    expect(importProposalOf(plain, 2019, null, nameOf)).toBeNull();
    expect(importProposalOf(plain, 2020, null, nameOf)).not.toBeNull();
  });

  it('a Corpus Christi on a fixed holiday is listed once, under the fixed name (Design Note 2)', () => {
    const proposal = importProposalOf(plain, 2024, null, nameOf);

    expect(proposal?.rows).toHaveLength(13);
    expect(proposal?.rows.find((row) => row.date === '2024-05-30')).toMatchObject({ code: 'STATEHOOD_DAY', name: 'Dan državnosti' });
  });
});

describe('the year picker', () => {
  it('steps within 1–9999', () => {
    expect(steppedYearOf(2026, 1)).toBe(2027);
    expect(steppedYearOf(FIRST_PICKED_YEAR, -1)).toBe(1);
    expect(steppedYearOf(LAST_PICKED_YEAR, 1)).toBe(9999);
  });
});

describe('a holiday entered by hand', () => {
  it('refuses a taken date before any write, then a blank, long or broken name', async () => {
    const calendar = await planningSnapshotOf({ holidays: [holidayRow('h-1', '2026-12-25', 'Božić')] });

    expect(enteredHolidayOf(calendar, '2026-12-25', 'Drugi')).toEqual({ ok: false, code: HOLIDAY_TAKEN });
    expect(enteredHolidayOf(calendar, '', 'Dan')).toEqual({ ok: false, code: HOLIDAY_DATE_EMPTY });
    // A date written as one that names no day has its own refusal.
    expect(enteredHolidayOf(calendar, '2026-02-31', 'Dan')).toEqual({ ok: false, code: HOLIDAY_DATE_INVALID });
    expect(enteredHolidayOf(calendar, 'sutra', 'Dan')).toEqual({ ok: false, code: HOLIDAY_DATE_EMPTY });
    expect(enteredHolidayOf(calendar, '2026-12-24', '   ')).toEqual({ ok: false, code: HOLIDAY_NAME_EMPTY });
    expect(enteredHolidayOf(calendar, '2026-12-24', 'x'.repeat(101))).toEqual({ ok: false, code: HOLIDAY_NAME_TOO_LONG });
    expect(enteredHolidayOf(calendar, '2026-12-24', 'Badnji\ndan')).toEqual({ ok: false, code: HOLIDAY_NAME_CONTROL });
    expect(enteredHolidayOf(calendar, '2026-12-24', '  Badnjak  ')).toEqual({ ok: true, holiday: { date: '2026-12-24', name: 'Badnjak' } });
    expect(enteredHolidayNameOf('x'.repeat(100))).toEqual({ ok: true, name: 'x'.repeat(100) });
  });

  it('a past date is a warning, not a refusal', () => {
    expect(isPastDate('2026-09-30', '2026-10-01')).toBe(true);
    expect(isPastDate('2026-10-01', '2026-10-01')).toBe(false);
    expect(isPastDate('2026-09-30', null)).toBe(false);
    expect(enteredHolidayOf(plain, '2026-09-30', 'Prošli').ok).toBe(true);
  });
});
