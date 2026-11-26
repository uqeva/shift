import { describe, expect, it, vi } from 'vitest';

import type { MemberListRow, MemberStatusVersion } from '@/features/members/services/list';
import {
  SEASON_DATES_MISSING,
  SEASON_END_BEFORE_START,
  SEASON_END_TOO_LATE,
  SEASON_START_BEFORE_SCHEDULED,
  SEASON_START_PAST,
  seasonClosedRequestsOf,
  seasonEarliestOf,
  seasonFailureOf,
  seasonInsertOf,
  seasonLeavesNoAdmin,
  seasonPlanOf,
  seasonRefusalIsDates,
  seasonRefusalMessageKey,
  writeSeason,
  type SeasonContext,
  type SeasonTable,
} from '@/features/members/services/season';
import {
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_SELF,
  MEMBER_STATUS_STALE,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  ORGANIZATION_WOULD_HAVE_NO_ADMIN,
} from '@/features/members/services/wire';

const TODAY = '2026-11-26';

function member(fields: Partial<MemberListRow> = {}): MemberListRow {
  return {
    id: 'member-1',
    organizationId: 'organization-1',
    name: 'Ana Kovač',
    username: 'ana.kovac',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    leaveAllowance: { startingDays: 20, versions: [] },
    leaveYearStart: { month: 1, day: 1 },
    fireRank: null,
    jobRole: null,
    isFloater: false,
    floaterRoleIds: [],
    authUserId: 'account-1',
    statusVersions: [],
    teamVersions: [],
    timeZone: 'Europe/Zagreb',
    ...fields,
  };
}

const CALLER = member({ id: 'admin-1', authUserId: 'account-admin', role: 'admin', name: 'Ivan' });

function context(target: MemberListRow, others: readonly MemberListRow[] = []): SeasonContext {
  return { member: target, members: [CALLER, target, ...others], callerAuthUserId: CALLER.authUserId, today: TODAY };
}

const inactive = (effectiveFrom: string): MemberStatusVersion => ({ active: false, effectiveFrom });
const active = (effectiveFrom: string): MemberStatusVersion => ({ active: true, effectiveFrom });

describe('the rows a season writes (the I/O matrix)', () => {
  it('makes an inactive member active from the start and inactive from the day after the end', () => {
    expect(seasonPlanOf([inactive('2026-10-01')], TODAY, '2027-06-01', '2027-09-30')).toEqual({
      ok: true,
      rows: [active('2027-06-01'), inactive('2027-10-01')],
    });
  });

  it('makes an active member inactive from today until the start, when the season starts later', () => {
    expect(seasonPlanOf([], TODAY, '2026-12-01', '2026-12-31')).toEqual({
      ok: true,
      rows: [inactive(TODAY), active('2026-12-01'), inactive('2027-01-01')],
    });
  });

  it('writes only the end for an active member whose season starts on the earliest date', () => {
    expect(seasonPlanOf([], TODAY, TODAY, '2027-01-15')).toEqual({ ok: true, rows: [inactive('2027-01-16')] });
    // A one-day season.
    expect(seasonPlanOf([], TODAY, TODAY, TODAY)).toEqual({ ok: true, rows: [inactive('2026-11-27')] });
  });

  it('appends after a scheduled change: the earliest date is the day after it', () => {
    const scheduled = [inactive('2026-12-10')];

    expect(seasonEarliestOf(scheduled, TODAY)).toBe('2026-12-11');
    expect(seasonPlanOf(scheduled, TODAY, '2027-03-01', '2027-03-31')).toEqual({
      ok: true,
      rows: [active('2027-03-01'), inactive('2027-04-01')],
    });
    // After a scheduled REACTIVATION the member is active before the season: out from the earliest date first.
    expect(seasonPlanOf([inactive('2026-10-01'), active('2026-12-10')], TODAY, '2027-03-01', '2027-03-31')).toEqual({
      ok: true,
      rows: [inactive('2026-12-11'), active('2027-03-01'), inactive('2027-04-01')],
    });
  });

  it('refuses a start on or before a scheduled change', () => {
    expect(seasonPlanOf([inactive('2026-12-10')], TODAY, '2026-12-10', '2026-12-31')).toEqual({
      ok: false,
      code: SEASON_START_BEFORE_SCHEDULED,
    });
    expect(seasonPlanOf([inactive('9999-12-31')], TODAY, '2027-01-01', '2027-01-02')).toEqual({
      ok: false,
      code: SEASON_START_BEFORE_SCHEDULED,
    });
    expect(seasonEarliestOf([inactive('9999-12-31')], TODAY)).toBeNull();
  });

  it('refuses a bad range: a missing or impossible date, a past start, an end before the start, an end with no next day', () => {
    expect(seasonPlanOf([], TODAY, '', '2027-01-01')).toEqual({ ok: false, code: SEASON_DATES_MISSING });
    expect(seasonPlanOf([], TODAY, '2027-01-01', '')).toEqual({ ok: false, code: SEASON_DATES_MISSING });
    expect(seasonPlanOf([], TODAY, '2027-02-31', '2027-03-01')).toEqual({ ok: false, code: SEASON_DATES_MISSING });
    expect(seasonPlanOf([], TODAY, '2026-11-25', '2027-01-01')).toEqual({ ok: false, code: SEASON_START_PAST });
    expect(seasonPlanOf([], TODAY, '2027-01-10', '2027-01-09')).toEqual({ ok: false, code: SEASON_END_BEFORE_START });
    expect(seasonPlanOf([], TODAY, '2027-01-10', '9999-12-31')).toEqual({ ok: false, code: SEASON_END_TOO_LATE });
    for (const code of [SEASON_DATES_MISSING, SEASON_START_PAST, SEASON_END_BEFORE_START, SEASON_END_TOO_LATE, SEASON_START_BEFORE_SCHEDULED] as const) {
      expect(seasonRefusalIsDates(code)).toBe(true);
    }
    expect(seasonRefusalIsDates(MEMBER_STATUS_STALE)).toBe(false);
  });

  it('alternates on every plan, each row after the one before it', () => {
    const histories: readonly (readonly MemberStatusVersion[])[] = [[], [inactive('2026-10-01')], [inactive('2026-12-10')], [inactive('2026-10-01'), active('2026-12-10')]];

    for (const history of histories) {
      const plan = seasonPlanOf(history, TODAY, '2027-05-01', '2027-05-31');

      if (!plan.ok) throw new Error(plan.code);

      const all = [...history, ...plan.rows];

      for (let index = 1; index < all.length; index += 1) {
        expect(all[index]?.active).not.toBe(all[index - 1]?.active);
        expect((all[index]?.effectiveFrom ?? '') > (all[index - 1]?.effectiveFrom ?? '')).toBe(true);
      }
      expect(history.length === 0 ? true : all[0]?.active).not.toBe(undefined);
      // A member with no version is active: the first written row is a deactivation.
      if (history.length === 0) expect(plan.rows[0]?.active).toBe(false);
    }
  });
});

describe('the last admin', () => {
  const admin = member({ role: 'admin' });

  it('refuses a season leaving no other admin active from its first inactive date', () => {
    const rows = [inactive(TODAY), active('2026-12-01'), inactive('2027-01-01')];

    // The caller is the only other admin and stays active: allowed.
    expect(seasonLeavesNoAdmin(admin, [CALLER, admin], rows)).toBe(false);
    // The caller is scheduled out after today: nobody covers.
    const leaving = { ...CALLER, statusVersions: [inactive('2026-12-15')] };
    expect(seasonLeavesNoAdmin(admin, [leaving, admin], rows)).toBe(true);
    // A non-admin target never consults the rule.
    expect(seasonLeavesNoAdmin(member(), [leaving, member()], rows)).toBe(false);
  });
});

describe('the requests a season closes', () => {
  /** A pending request row as *Za odluku*'s read answers it: `to` included. */
  function request(id: string, from: string, toExclusive: string, memberId = 'member-1'): unknown {
    return {
      id,
      member_id: memberId,
      during: `[${from},${toExclusive})`,
      closed_at: null,
      created_at: '2026-11-01T10:00:00Z',
      leave_request_decisions: [],
    };
  }

  it('names a request reaching an inactive row unless a later row governs it whole', () => {
    // Out from today, back on 01.12., out from 01.01.
    const rows = [inactive(TODAY), active('2026-12-01'), inactive('2027-01-01')];
    const read = [
      request('before', '2026-11-28', '2026-11-30'),
      request('inside', '2026-12-05', '2026-12-08'),
      request('straddles-start', '2026-11-30', '2026-12-03'),
      request('straddles-end', '2026-12-30', '2027-01-03'),
      request('after', '2027-02-01', '2027-02-03'),
      request('colleague', '2026-11-28', '2026-11-30', 'member-2'),
    ];

    expect(seasonClosedRequestsOf(read, 'member-1', rows)?.map((found) => found.id).sort()).toEqual([
      'after',
      'before',
      'straddles-end',
      'straddles-start',
    ]);
    // An inactive member's season (active from 01.12.) closes only what reaches past its end.
    expect(
      seasonClosedRequestsOf(read, 'member-1', [active('2026-12-01'), inactive('2027-01-01')])?.map((found) => found.id).sort(),
    ).toEqual(['after', 'straddles-end']);
  });

  it('names nothing while the read is not answered', () => {
    expect(seasonClosedRequestsOf(null, 'member-1', [inactive(TODAY)])).toBeNull();
  });
});

describe('the one insert', () => {
  function table(error: { code?: string; message?: string } | null) {
    const insert = vi.fn<SeasonTable['insert']>(() => Promise.resolve({ error }));

    return { insert, table: { insert } satisfies SeasonTable };
  }

  it('sends every row in one call, the four columns a session may name', async () => {
    const stub = table(null);
    const rows = [inactive(TODAY), active('2026-12-01'), inactive('2027-01-01')];

    expect(await writeSeason(stub.table, 'organization-1', 'member-1', { rows, start: '2026-12-01', end: '2026-12-31' }, context(member()))).toEqual({
      ok: true,
    });
    expect(stub.insert).toHaveBeenCalledTimes(1);
    expect(stub.insert.mock.calls[0]?.[0]).toEqual(seasonInsertOf('organization-1', 'member-1', rows));
    expect(seasonInsertOf('organization-1', 'member-1', rows)[1]).toEqual({
      organization_id: 'organization-1',
      member_id: 'member-1',
      active: true,
      effective_from: '2026-12-01',
    });
  });

  it('sends nothing without a row, and reads a thrown call as unavailable', async () => {
    const stub = table(null);

    expect(await writeSeason(stub.table, 'o', 'm', { rows: [], start: '', end: '' }, null)).toEqual({ ok: false, code: MEMBER_WRITE_INVALID });
    expect(stub.insert).not.toHaveBeenCalled();

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown: SeasonTable = { insert: () => Promise.reject(new Error('offline')) };
    expect(await writeSeason(thrown, 'o', 'm', { rows: [inactive(TODAY)], start: TODAY, end: TODAY }, null)).toEqual({
      ok: false,
      code: MEMBER_WRITE_UNAVAILABLE,
    });
    vi.restoreAllMocks();
  });

  it("reads 0085's 42501 against what was sent", () => {
    const rows = [inactive(TODAY), active('2026-12-01'), inactive('2027-01-01')];
    const refused = { code: '42501' };

    expect(seasonFailureOf(refused, rows, '2026-12-01', '2026-12-31', context(member()))).toBe(MEMBER_STATUS_STALE);
    expect(seasonFailureOf(refused, rows, '2026-11-01', '2026-12-31', context(member()))).toBe(SEASON_START_PAST);
    expect(seasonFailureOf(refused, rows, '2026-12-01', '2026-12-31', context(member({ authUserId: CALLER.authUserId })))).toBe(
      MEMBER_STATUS_SELF,
    );
    const admin = member({ role: 'admin' });
    const leaving = { ...CALLER, statusVersions: [inactive('2026-12-15')] };
    expect(seasonFailureOf(refused, rows, '2026-12-01', '2026-12-31', { ...context(admin), members: [leaving, admin] })).toBe(
      ORGANIZATION_WOULD_HAVE_NO_ADMIN,
    );
    expect(seasonFailureOf({ code: '23514', message: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN' }, rows, '2026-12-01', '2026-12-31', context(member()))).toBe(
      ORGANIZATION_WOULD_HAVE_NO_ADMIN,
    );
    expect(seasonFailureOf({ code: '23505' }, rows, '2026-12-01', '2026-12-31', context(member()))).toBe(MEMBER_STATUS_DATE_TAKEN);
    expect(seasonFailureOf({ code: '22007' }, rows, '2026-12-01', '2026-12-31', context(member()))).toBe(MEMBER_WRITE_INVALID);
    expect(seasonFailureOf({ code: 'PGRST301' }, rows, '2026-12-01', '2026-12-31', context(member()))).toBe(MEMBER_WRITE_UNAVAILABLE);
  });

  it('reads a refused season of a member just created as stale', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stub = table({ code: '42501' });

    expect(await writeSeason(stub.table, 'o', 'm', { rows: [inactive(TODAY)], start: TODAY, end: TODAY }, null)).toEqual({
      ok: false,
      code: MEMBER_STATUS_STALE,
    });
    vi.restoreAllMocks();
  });

  it('names every refusal with a season key', () => {
    for (const code of [
      SEASON_DATES_MISSING,
      SEASON_START_PAST,
      SEASON_START_BEFORE_SCHEDULED,
      SEASON_END_BEFORE_START,
      SEASON_END_TOO_LATE,
      MEMBER_STATUS_SELF,
      MEMBER_STATUS_DATE_TAKEN,
      MEMBER_STATUS_STALE,
      ORGANIZATION_WOULD_HAVE_NO_ADMIN,
      MEMBER_WRITE_INVALID,
      MEMBER_WRITE_UNAVAILABLE,
    ] as const) {
      expect(seasonRefusalMessageKey(code)).toMatch(/^ljudi\.season\.error\./);
    }
  });
});
