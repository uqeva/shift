import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { JobRoleRow } from '@/features/job-roles/services/list';
import type { MemberListRow } from '@/features/members/services/list';
import {
  FLOATER_SAVE_DENIED,
  FLOATER_SAVE_FAILED,
  FLOATER_SAVE_STALE,
  floaterChangesOf,
  floaterDraftChanges,
  floaterDraftOf,
  floaterDraftWithRole,
  floaterFactsLineOf,
  floaterFactsMessageKey,
  floaterFactsOf,
  floaterRefusalMessageKey,
  floaterRoleOptionsOf,
  floaterStaleOf,
  saveMemberFloater,
  type FloaterFlagTable,
  type FloaterRolesTable,
  type FloaterWriteAnswer,
} from '@/features/members/services/floater';
import { initLocalization, t } from '@/lib/i18n';

vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeAll(async () => {
  await initLocalization();
});

const DISPATCH: JobRoleRow = { id: 'r-dispatch', name: 'Dispečer', archived: false };
const DRIVER: JobRoleRow = { id: 'r-driver', name: 'Vozač', archived: false };
const OLD: JobRoleRow = { id: 'r-old', name: 'Arhivirani', archived: true };
const ROLES = [DRIVER, OLD, DISPATCH];

function member(fields: Partial<MemberListRow> = {}): MemberListRow {
  return {
    id: 'm-1',
    organizationId: 'org',
    name: 'Ana',
    username: 'ana',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    leaveAllowance: { startingDays: 20, versions: [] },
    leaveYearStart: { month: 1, day: 1 },
    fireRank: null,
    jobRole: null,
    isFloater: false,
    floaterRoleIds: [],
    authUserId: 'auth-1',
    statusVersions: [],
    teamVersions: [],
    timeZone: 'Europe/Zagreb',
    ...fields,
  };
}

const OK = (rows: number): FloaterWriteAnswer => ({ data: Array.from({ length: rows }, (_, i) => ({ id: `x${String(i)}` })), error: null });

/** Stub tables that record every call, answering in turn. */
function tables(answers: { flag?: FloaterWriteAnswer; drop?: FloaterWriteAnswer; add?: FloaterWriteAnswer | Error } = {}) {
  const calls: unknown[] = [];
  const members: FloaterFlagTable = {
    update(values) {
      return {
        eq(column, value) {
          return {
            select(columns) {
              calls.push(['update', values, column, value, columns]);
              return Promise.resolve(answers.flag ?? OK(1));
            },
          };
        },
      };
    },
  };
  const roles: FloaterRolesTable = {
    delete() {
      return {
        eq(c1, v1) {
          return {
            eq(c2, v2) {
              return {
                in(c3, values) {
                  return {
                    select() {
                      calls.push(['delete', c1, v1, c2, v2, c3, values]);
                      return Promise.resolve(answers.drop ?? OK(values.length));
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    insert(rows) {
      return {
        select() {
          calls.push(['insert', rows]);
          const answer = answers.add;
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? OK(rows.length));
        },
      };
    },
  };

  return { members, roles, calls };
}

describe('the draft and its changes', () => {
  it('opens on the member as stored, and changes nothing until edited', () => {
    const floater = member({ isFloater: true, floaterRoleIds: ['r-dispatch'] });

    expect(floaterDraftOf(floater)).toEqual({ isFloater: true, roleIds: ['r-dispatch'] });
    expect(floaterDraftChanges(floater, floaterDraftOf(floater))).toBe(false);
  });

  it('writes the flag, drops and adds roles', () => {
    const floater = member({ isFloater: true, floaterRoleIds: ['r-dispatch', 'r-old'] });

    expect(floaterChangesOf(floater, { isFloater: true, roleIds: ['r-driver', 'r-dispatch'] })).toEqual({
      flag: null,
      dropped: ['r-old'],
      added: ['r-driver'],
    });
    expect(floaterChangesOf(member(), { isFloater: true, roleIds: ['r-driver'] })).toEqual({
      flag: true,
      dropped: [],
      added: ['r-driver'],
    });
  });

  it('drops every role when the flag is turned off', () => {
    const floater = member({ isFloater: true, floaterRoleIds: ['r-dispatch', 'r-driver'] });

    expect(floaterChangesOf(floater, { isFloater: false, roleIds: ['r-dispatch', 'r-driver'] })).toEqual({
      flag: false,
      dropped: ['r-dispatch', 'r-driver'],
      added: [],
    });
  });

  it('checks and unchecks a role, sorted', () => {
    const draft = floaterDraftWithRole({ isFloater: true, roleIds: ['r-old'] }, 'r-driver', true);

    expect(draft.roleIds).toEqual(['r-driver', 'r-old']);
    expect(floaterDraftWithRole(draft, 'r-old', false).roleIds).toEqual(['r-driver']);
  });
});

describe('the options and the facts', () => {
  it('offers every live role and the archived ones the member covers, in the roles card\'s order', () => {
    expect(floaterRoleOptionsOf(ROLES, member()).map((role) => role.id)).toEqual(['r-dispatch', 'r-driver']);
    expect(floaterRoleOptionsOf(ROLES, member({ floaterRoleIds: ['r-old'] })).map((role) => role.id)).toEqual([
      'r-dispatch',
      'r-driver',
      'r-old',
    ]);
  });

  it('states no floater, a floater for anyone with no role, loading, and the roles by name', () => {
    expect(floaterFactsOf(member(), ROLES)).toEqual({ kind: 'none' });
    expect(floaterFactsOf(member({ isFloater: true }), ROLES)).toEqual({ kind: 'any' });
    expect(floaterFactsOf(member({ isFloater: true, floaterRoleIds: ['r-driver'] }), null)).toEqual({ kind: 'loading' });
    expect(floaterFactsMessageKey({ kind: 'loading' })).toBe('ljudi.floater.factsLoading');
    expect(floaterFactsOf(member({ isFloater: true, floaterRoleIds: ['r-driver', 'r-dispatch', 'r-gone'] }), ROLES)).toEqual({
      kind: 'roles',
      names: ['Dispečer', 'Vozač'],
      unknown: 1,
    });
    expect(floaterFactsMessageKey({ kind: 'roles', names: [], unknown: 2 })).toBe('ljudi.floater.rolesUnknown');
    expect(floaterFactsMessageKey({ kind: 'roles', names: ['Vozač'], unknown: 1 })).toBe('ljudi.floater.rolesPartlyUnknown');
    expect(floaterFactsMessageKey({ kind: 'roles', names: ['Vozač'], unknown: 0 })).toBe('ljudi.floater.roles');
    expect(t(floaterFactsMessageKey({ kind: 'none' }))).toBe('Ne uskače kao zamjena.');
  });

  it('says za posao for one role and za poslove for more', () => {
    const one = floaterFactsLineOf({ kind: 'roles', names: ['Vozač'], unknown: 0 });
    const two = floaterFactsLineOf({ kind: 'roles', names: ['Dispečer', 'Vozač'], unknown: 0 });

    expect(one.values?.count).toBe(1);
    expect(t(one.key, one.values ?? {})).toBe('Uskače kao zamjena za posao: Vozač.');
    expect(t(two.key, two.values ?? {})).toMatch(/^Uskače kao zamjena za poslove: Dispečer.*Vozač\.$/);
  });
});

describe('the member as opened (another admin saved meanwhile)', () => {
  it('is stale when the stored flag or roles moved, and not otherwise', () => {
    const opened = member({ isFloater: true, floaterRoleIds: ['r-dispatch'] });

    expect(floaterStaleOf(opened, member({ isFloater: true, floaterRoleIds: ['r-dispatch'] }))).toBe(false);
    expect(floaterStaleOf(opened, member({ isFloater: false, floaterRoleIds: ['r-dispatch'] }))).toBe(true);
    expect(floaterStaleOf(opened, member({ isFloater: true, floaterRoleIds: ['r-dispatch', 'r-driver'] }))).toBe(true);
    expect(floaterStaleOf(opened, member({ isFloater: true, floaterRoleIds: ['r-driver'] }))).toBe(true);
    expect(floaterRefusalMessageKey({ ok: false, code: FLOATER_SAVE_STALE, partial: false })).toBe('ljudi.floater.error.stale');
  });
});

describe('the save (Design Note 5)', () => {
  it('turning the flag ON writes the roles first and the flag LAST', async () => {
    const { members, roles, calls } = tables();
    const floater = member({ isFloater: false, floaterRoleIds: ['r-old'] });

    await expect(saveMemberFloater(members, roles, floater, { isFloater: true, roleIds: ['r-driver'] })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ['delete', 'organization_id', 'org', 'member_id', 'm-1', 'job_role_id', ['r-old']],
      ['insert', [{ organization_id: 'org', member_id: 'm-1', job_role_id: 'r-driver' }]],
      ['update', { is_floater: true }, 'id', 'm-1', 'id'],
    ]);
  });

  it('turning the flag OFF clears it FIRST, then drops every role', async () => {
    const { members, roles, calls } = tables();
    const floater = member({ isFloater: true, floaterRoleIds: ['r-dispatch', 'r-driver'] });

    await expect(saveMemberFloater(members, roles, floater, { isFloater: false, roleIds: ['r-dispatch'] })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ['update', { is_floater: false }, 'id', 'm-1', 'id'],
      ['delete', 'organization_id', 'org', 'member_id', 'm-1', 'job_role_id', ['r-dispatch', 'r-driver']],
    ]);
  });

  it('an unchanged flag writes the roles alone', async () => {
    const { members, roles, calls } = tables();
    const floater = member({ isFloater: true, floaterRoleIds: ['r-old'] });

    await expect(saveMemberFloater(members, roles, floater, { isFloater: true, roleIds: ['r-driver'] })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ['delete', 'organization_id', 'org', 'member_id', 'm-1', 'job_role_id', ['r-old']],
      ['insert', [{ organization_id: 'org', member_id: 'm-1', job_role_id: 'r-driver' }]],
    ]);
  });

  it('sends nothing for nothing changed', async () => {
    const { members, roles, calls } = tables();

    await expect(saveMemberFloater(members, roles, member(), { isFloater: false, roleIds: [] })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it('is denied when the flag update answers no row (the policy), and a partial save when the roles landed first', async () => {
    const { members, roles, calls } = tables({ flag: OK(0) });
    const outcome = await saveMemberFloater(members, roles, member(), { isFloater: true, roleIds: ['r-driver'] });

    expect(outcome).toEqual({ ok: false, code: FLOATER_SAVE_DENIED, partial: true });
    expect(calls).toHaveLength(2);
    if (!outcome.ok) expect(floaterRefusalMessageKey(outcome)).toBe('ljudi.floater.error.partial');

    const off = tables({ flag: OK(0) });

    await expect(
      saveMemberFloater(off.members, off.roles, member({ isFloater: true, floaterRoleIds: ['r-old'] }), { isFloater: false, roleIds: [] }),
    ).resolves.toEqual({ ok: false, code: FLOATER_SAVE_DENIED, partial: false });
    expect(off.calls, 'a refused flag-off still dropped the roles').toHaveLength(1);
  });

  it('is denied when a delete removes fewer rows than it targeted (RLS filtered them), and sends nothing after', async () => {
    const { members, roles, calls } = tables({ drop: OK(1) });
    const floater = member({ isFloater: true, floaterRoleIds: ['r-dispatch', 'r-old'] });

    await expect(saveMemberFloater(members, roles, floater, { isFloater: true, roleIds: ['r-driver'] })).resolves.toEqual({
      ok: false,
      code: FLOATER_SAVE_DENIED,
      partial: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('maps a 42501 to denied, a throw to failed, and a short insert to denied', async () => {
    const floater = member({ isFloater: true });
    const refused = tables({ add: { data: null, error: { code: '42501' } } });

    await expect(saveMemberFloater(refused.members, refused.roles, floater, { isFloater: true, roleIds: ['r-driver'] })).resolves.toEqual({
      ok: false,
      code: FLOATER_SAVE_DENIED,
      partial: false,
    });

    const thrown = tables({ add: new Error('network') });

    await expect(saveMemberFloater(thrown.members, thrown.roles, floater, { isFloater: true, roleIds: ['r-driver'] })).resolves.toEqual({
      ok: false,
      code: FLOATER_SAVE_FAILED,
      partial: false,
    });

    const short = tables({ add: OK(1) });

    await expect(
      saveMemberFloater(short.members, short.roles, floater, { isFloater: true, roleIds: ['r-dispatch', 'r-driver'] }),
    ).resolves.toEqual({ ok: false, code: FLOATER_SAVE_DENIED, partial: false });
  });

  it('words each refusal', () => {
    expect(floaterRefusalMessageKey({ ok: false, code: FLOATER_SAVE_DENIED, partial: false })).toBe('ljudi.floater.error.denied');
    expect(t('ljudi.floater.error.denied')).toBe('Nemaš ovlasti mijenjati zamjene.');
    expect(floaterRefusalMessageKey({ ok: false, code: FLOATER_SAVE_FAILED, partial: false })).toBe('ljudi.floater.error.failed');
  });
});
