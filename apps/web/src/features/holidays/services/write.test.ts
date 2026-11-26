import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHANGE_ADD, CHANGE_FLAG, CHANGE_REMOVE, HOLIDAY_NOTHING_NEW, HOLIDAY_NO_IMPORT, HOLIDAY_STALE } from '@/features/holidays/services/holiday-check';
import {
  HOLIDAY_DATE_EMPTY,
  HOLIDAY_DATE_INVALID,
  HOLIDAY_NAME_CONTROL,
  HOLIDAY_NAME_EMPTY,
  HOLIDAY_NAME_TOO_LONG,
  HOLIDAY_TAKEN,
  HOLIDAYS_TABLE,
} from '@/features/holidays/services/holidays';
import {
  HOLIDAYS_CONFLICT_COLUMNS,
  HOLIDAY_ADDED,
  HOLIDAY_IMPORTED,
  HOLIDAY_REMOVED,
  HOLIDAY_RENAMED,
  HOLIDAY_UNCHECKED,
  HOLIDAY_WRITE_REFUSED,
  HOLIDAY_WRITE_UNAVAILABLE,
  holidayMessageKey,
  holidaySavedMessageKey,
  holidaySavedOf,
  holidayWriteFailureOf,
  holidayWriteTablesOf,
  marksHolidayDate,
  marksHolidayName,
  renameHoliday,
  teamHolidayFlagMessageKey,
  writeHolidayChange,
  type HolidayWriteAnswer,
  type HolidayWriteTables,
} from '@/features/holidays/services/write';
import { initLocalization, t } from '@/lib/i18n';

/**
 * STORY 21.17 — a holiday's and a team flag's writes, over a stubbed client:
 * one insert by hand, the import's ONE insert that skips the dates already
 * present, a rename of the name alone, a delete, the team's flag; zero rows
 * is stale where a row was expected; and the refusal map.
 */

const ORGANIZATION = '00000000-0000-4000-8000-0000000000aa';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function answering(answer: HolidayWriteAnswer | Error): { readonly tables: HolidayWriteTables; readonly calls: Call[] } {
  const calls: Call[] = [];
  const selecting = {
    select: (columns: string) => {
      calls.push({ method: 'select', args: [columns] });

      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const byId = {
    eq: (column: string, value: string) => {
      calls.push({ method: 'eq', args: [column, value] });

      return {
        ...selecting,
        eq: (next: string, live: boolean) => {
          calls.push({ method: 'eq', args: [next, live] });

          return selecting;
        },
      };
    },
  };
  const table = (name: string) => ({
    insert: (values: unknown) => {
      calls.push({ method: `${name}.insert`, args: [values] });

      return selecting;
    },
    upsert: (values: unknown, options: unknown) => {
      calls.push({ method: `${name}.upsert`, args: [values, options] });

      return selecting;
    },
    update: (values: unknown) => {
      calls.push({ method: `${name}.update`, args: [values] });

      return byId;
    },
    delete: () => {
      calls.push({ method: `${name}.delete`, args: [] });

      return byId;
    },
  });

  return { tables: holidayWriteTablesOf({ from: table }), calls };
}

const rows = (count: number): HolidayWriteAnswer => ({ data: Array.from({ length: count }, (_, index) => ({ id: `h-${String(index)}` })), error: null });

beforeEach(async () => {
  await initLocalization();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the tables', () => {
  it("are 0080's holidays and the teams", () => {
    const named: string[] = [];

    holidayWriteTablesOf({
      from: (name) => {
        named.push(name);

        return {};
      },
    });
    expect(named).toEqual([HOLIDAYS_TABLE, 'teams']);
  });
});

describe('a holiday added by hand', () => {
  it('is one insert of the tenant, the date and the name', async () => {
    const { tables, calls } = answering(rows(1));
    const outcome = await writeHolidayChange(tables, ORGANIZATION, {
      kind: CHANGE_ADD,
      holidays: [{ date: '2026-09-15', name: 'Prošli' }],
      year: null,
    });

    expect(outcome).toEqual({ ok: true, rows: 1 });
    expect(calls).toEqual([
      { method: 'organization_holidays.insert', args: [{ organization_id: ORGANIZATION, date: '2026-09-15', name: 'Prošli' }] },
      { method: 'select', args: ['id'] },
    ]);
  });

  it('on a date taken meanwhile: 23505 is the date taken', async () => {
    const { tables } = answering({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "organization_holidays_organization_date_key"' } });

    expect(await writeHolidayChange(tables, ORGANIZATION, { kind: CHANGE_ADD, holidays: [{ date: '2026-10-08', name: 'B' }], year: null })).toEqual({
      ok: false,
      code: HOLIDAY_TAKEN,
    });
  });
});

describe('the import', () => {
  const missing = Array.from({ length: 14 }, (_, index) => ({ date: `2027-01-${String(index + 1).padStart(2, '0')}`, name: `B${String(index)}` }));

  it('is ONE insert of the missing dates that skips any already present', async () => {
    const { tables, calls } = answering(rows(14));
    const outcome = await writeHolidayChange(tables, ORGANIZATION, { kind: CHANGE_ADD, holidays: missing, year: 2027 });

    expect(outcome).toEqual({ ok: true, rows: 14 });
    expect(calls.filter((call) => call.method.endsWith('upsert'))).toHaveLength(1);
    expect(calls[0]?.args[1]).toEqual({ onConflict: 'organization_id,date', ignoreDuplicates: true });
    expect(HOLIDAYS_CONFLICT_COLUMNS).toBe('organization_id,date');
    expect(calls[0]?.args[0]).toHaveLength(14);
    expect((calls[0]?.args[0] as readonly Record<string, unknown>[])[0]).toEqual({ organization_id: ORGANIZATION, date: '2027-01-01', name: 'B0' });
  });

  it('a partial year sends the 11 missing; a second import landing on stored dates adds nothing, and is no refusal', async () => {
    const partial = answering(rows(11));

    expect(await writeHolidayChange(partial.tables, ORGANIZATION, { kind: CHANGE_ADD, holidays: missing.slice(3), year: 2027 })).toEqual({ ok: true, rows: 11 });
    expect(partial.calls[0]?.args[0]).toHaveLength(11);

    const again = answering(rows(0));

    expect(await writeHolidayChange(again.tables, ORGANIZATION, { kind: CHANGE_ADD, holidays: missing, year: 2027 })).toEqual({ ok: true, rows: 0 });
  });

  it('even of one date stays the one skipping insert', async () => {
    const { tables, calls } = answering(rows(1));

    await writeHolidayChange(tables, ORGANIZATION, { kind: CHANGE_ADD, holidays: missing.slice(0, 1), year: 2027 });
    expect(calls[0]?.method).toBe('organization_holidays.upsert');
  });
});

describe('a removal', () => {
  it('deletes by id; zero rows is stale (removed elsewhere)', async () => {
    const landed = answering(rows(1));

    expect(await writeHolidayChange(landed.tables, ORGANIZATION, { kind: CHANGE_REMOVE, id: 'h-1', date: '2026-10-08', name: 'B' })).toEqual({ ok: true, rows: 1 });
    expect(landed.calls).toEqual([
      { method: 'organization_holidays.delete', args: [] },
      { method: 'eq', args: ['id', 'h-1'] },
      { method: 'select', args: ['id'] },
    ]);

    const gone = answering(rows(0));

    expect(await writeHolidayChange(gone.tables, ORGANIZATION, { kind: CHANGE_REMOVE, id: 'h-1', date: '2026-10-08', name: 'B' })).toEqual({
      ok: false,
      code: HOLIDAY_STALE,
    });
  });
});

describe("a team's flag", () => {
  it('writes off_on_holidays by id; 42501 is refused; zero rows stale', async () => {
    const landed = answering(rows(1));

    expect(await writeHolidayChange(landed.tables, ORGANIZATION, { kind: CHANGE_FLAG, teamId: 'team-c', value: true })).toEqual({ ok: true, rows: 1 });
    expect(landed.calls).toEqual([
      { method: 'teams.update', args: [{ off_on_holidays: true }] },
      { method: 'eq', args: ['id', 'team-c'] },
      // A live team only: an archived one answers zero rows, stale.
      { method: 'eq', args: ['archived', false] },
      { method: 'select', args: ['id'] },
    ]);

    const refused = answering({ data: null, error: { code: '42501', message: 'permission denied for table teams' } });

    expect(await writeHolidayChange(refused.tables, ORGANIZATION, { kind: CHANGE_FLAG, teamId: 'team-c', value: true })).toEqual({
      ok: false,
      code: HOLIDAY_WRITE_REFUSED,
    });
    expect(t(teamHolidayFlagMessageKey(HOLIDAY_WRITE_REFUSED))).toBe(t('smjene.offOnHolidays.error.refused'));

    const gone = answering(rows(0));

    expect(await writeHolidayChange(gone.tables, ORGANIZATION, { kind: CHANGE_FLAG, teamId: 'team-c', value: false })).toEqual({ ok: false, code: HOLIDAY_STALE });
  });
});

describe('a rename', () => {
  it('updates the name alone, trimmed; no check', async () => {
    const { tables, calls } = answering(rows(1));

    expect(await renameHoliday(tables.holidays, { id: 'h-1' }, '  Dan grada  ')).toEqual({ ok: true, rows: 1 });
    expect(calls).toEqual([
      { method: 'organization_holidays.update', args: [{ name: 'Dan grada' }] },
      { method: 'eq', args: ['id', 'h-1'] },
      { method: 'select', args: ['id'] },
    ]);
  });

  it('refuses a bad name before anything is sent, and zero rows is stale', async () => {
    const { tables, calls } = answering(rows(1));

    expect(await renameHoliday(tables.holidays, { id: 'h-1' }, ' ')).toEqual({ ok: false, code: HOLIDAY_NAME_EMPTY });
    expect(await renameHoliday(tables.holidays, { id: 'h-1' }, 'x'.repeat(101))).toEqual({ ok: false, code: HOLIDAY_NAME_TOO_LONG });
    expect(await renameHoliday(tables.holidays, { id: 'h-1' }, 'a\tb')).toEqual({ ok: false, code: HOLIDAY_NAME_CONTROL });
    expect(calls).toEqual([]);

    const gone = answering(rows(0));

    expect(await renameHoliday(gone.tables.holidays, { id: 'h-1' }, 'Dan')).toEqual({ ok: false, code: HOLIDAY_STALE });
  });
});

describe('the refusal map', () => {
  it('23505 taken; 23514 by constraint the name rule; 42501 refused; else unavailable', () => {
    expect(holidayWriteFailureOf({ code: '23505' })).toBe(HOLIDAY_TAKEN);
    expect(holidayWriteFailureOf({ code: '23514', message: 'new row violates check constraint "organization_holidays_name_not_blank"' })).toBe(HOLIDAY_NAME_EMPTY);
    expect(holidayWriteFailureOf({ code: '23514', message: 'violates check constraint "organization_holidays_name_length"' })).toBe(HOLIDAY_NAME_TOO_LONG);
    expect(holidayWriteFailureOf({ code: '23514', message: 'violates check constraint "organization_holidays_name_characters"' })).toBe(HOLIDAY_NAME_CONTROL);
    expect(holidayWriteFailureOf({ code: '23514', message: 'violates check constraint "organization_holidays_date_finite"' })).toBe(HOLIDAY_WRITE_UNAVAILABLE);
    expect(holidayWriteFailureOf({ code: '42501' })).toBe(HOLIDAY_WRITE_REFUSED);
    expect(holidayWriteFailureOf({ code: 'PGRST301' })).toBe(HOLIDAY_WRITE_UNAVAILABLE);
  });

  it('a thrown call or a malformed answer is the service', async () => {
    expect(await writeHolidayChange(answering(new Error('down')).tables, ORGANIZATION, { kind: CHANGE_REMOVE, id: 'h', date: '2026-01-01', name: 'B' })).toEqual({
      ok: false,
      code: HOLIDAY_WRITE_UNAVAILABLE,
    });
    expect(
      await writeHolidayChange(answering({ data: {} as unknown as readonly unknown[], error: null }).tables, ORGANIZATION, {
        kind: CHANGE_REMOVE,
        id: 'h',
        date: '2026-01-01',
        name: 'B',
      }),
    ).toEqual({ ok: false, code: HOLIDAY_WRITE_UNAVAILABLE });
  });
});

describe('the words', () => {
  it('every failure has its message, and the field marks follow the failure', () => {
    for (const code of [
      HOLIDAY_DATE_EMPTY,
      HOLIDAY_DATE_INVALID,
      HOLIDAY_NAME_EMPTY,
      HOLIDAY_NAME_TOO_LONG,
      HOLIDAY_NAME_CONTROL,
      HOLIDAY_TAKEN,
      HOLIDAY_STALE,
      HOLIDAY_NOTHING_NEW,
      HOLIDAY_NO_IMPORT,
      HOLIDAY_WRITE_REFUSED,
      HOLIDAY_WRITE_UNAVAILABLE,
      HOLIDAY_UNCHECKED,
    ] as const) {
      expect(t(holidayMessageKey(code)), code).not.toBe(holidayMessageKey(code));
    }
    expect(marksHolidayName(HOLIDAY_NAME_EMPTY)).toBe(true);
    expect(marksHolidayName(HOLIDAY_TAKEN)).toBe(false);
    expect(marksHolidayDate(HOLIDAY_TAKEN)).toBe(true);
    expect(marksHolidayDate(null)).toBe(false);
  });

  it('a landed change says what it did', () => {
    expect(holidaySavedOf({ kind: CHANGE_ADD, holidays: [], year: null })).toBe(HOLIDAY_ADDED);
    expect(holidaySavedOf({ kind: CHANGE_ADD, holidays: [], year: 2027 })).toBe(HOLIDAY_IMPORTED);
    expect(holidaySavedOf({ kind: CHANGE_REMOVE, id: 'h', date: '2026-01-01', name: 'B' })).toBe(HOLIDAY_REMOVED);
    // A flag change is the team dialog's: the card has no confirmation for it.
    expect(() => holidaySavedOf({ kind: CHANGE_FLAG, teamId: 'team-c', value: true })).toThrow(RangeError);
    expect(t(holidaySavedMessageKey(HOLIDAY_IMPORTED), { count: 14 })).toBe('Uvezeno je 14 blagdana.');
    expect(t(holidaySavedMessageKey(HOLIDAY_RENAMED))).toBe('Naziv blagdana je spremljen.');
  });
});
