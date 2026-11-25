import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JOB_ROLES_COLUMNS,
  JOB_ROLES_COUNT,
  JOB_ROLES_LIST_KEY,
  JOB_ROLES_TABLE,
  JOB_ROLES_UNAVAILABLE,
  NO_JOB_ROLE,
  chosenJobRoleId,
  jobRoleEditOf,
  jobRoleOpenedWithOf,
  jobRoleInitialValue,
  jobRoleOptionsFor,
  jobRoleRowOf,
  jobRolesMessageKey,
  jobRolesNoticeOf,
  jobRolesOffered,
  jobRolesQueryOptions,
  jobRolesSurfaceStateOf,
  orderedJobRoles,
  readJobRoles,
  type JobRoleRow,
  type JobRolesAnswer,
  type JobRolesTable,
} from '@/features/job-roles/services/list';

/** Story 21.12: the job role list, read, ordered and offered with no database (stubbed table). */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const DISPATCH = '33333333-3333-4333-8333-333333333333';
const CLEANER = '44444444-4444-4444-8444-444444444444';
const SEASONAL = '55555555-5555-4555-8555-555555555555';

const dispatchRow = { organization_id: ORG, id: DISPATCH, name: 'Dispečer', archived: false };
const cleanerRow = { organization_id: ORG, id: CLEANER, name: 'Čistačica', archived: false };
const seasonalRow = { organization_id: ORG, id: SEASONAL, name: 'Sezonac', archived: true };

const dispatch: JobRoleRow = { id: DISPATCH, name: 'Dispečer', archived: false };
const cleaner: JobRoleRow = { id: CLEANER, name: 'Čistačica', archived: false };
const seasonal: JobRoleRow = { id: SEASONAL, name: 'Sezonac', archived: true };

const REJECTS = 'rejects';

function tableAnswering(answer: JobRolesAnswer | typeof REJECTS): JobRolesTable & { calls: unknown[][] } {
  const calls: unknown[][] = [];

  return {
    calls,
    select: (...args: unknown[]) => {
      calls.push(args);

      return answer === REJECTS ? Promise.reject(new Error('network')) : Promise.resolve(answer);
    },
  };
}

const rowsAnswer = (rows: unknown[]): JobRolesAnswer => ({ data: rows, error: null, count: rows.length });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the read', () => {
  it('names its own table and key, and selects four columns with an exact count', async () => {
    expect(JOB_ROLES_TABLE).toBe('job_roles');
    expect(JOB_ROLES_LIST_KEY).toEqual(['jobRoles']);

    const table = tableAnswering(rowsAnswer([]));

    await readJobRoles(table);

    expect(table.calls).toEqual([[JOB_ROLES_COLUMNS, JOB_ROLES_COUNT]]);
    expect(JOB_ROLES_COLUMNS).toBe('organization_id,id,name,archived');
  });

  it('answers no roles as an empty list, never a refusal (nothing is seeded)', async () => {
    expect(await readJobRoles(tableAnswering(rowsAnswer([])))).toEqual({ ok: true, roles: [] });
  });

  it('orders live roles by name in Croatian collation, then archived ones', async () => {
    expect(await readJobRoles(tableAnswering(rowsAnswer([seasonalRow, dispatchRow, cleanerRow])))).toEqual({
      ok: true,
      roles: [cleaner, dispatch, seasonal],
    });
  });

  it.each([
    ['a rejected call', REJECTS],
    ['an error', { data: null, error: { code: 'PGRST' }, count: null }],
    ['a missing count', { data: [dispatchRow], error: null, count: null }],
    ['a count the rows disagree with', { data: [dispatchRow], error: null, count: 2 }],
    ['a malformed row', rowsAnswer([{ ...dispatchRow, archived: 'no' }])],
    ['a row with no name', rowsAnswer([{ ...dispatchRow, name: null }])],
    ['two rows sharing an id', rowsAnswer([dispatchRow, dispatchRow])],
    ['two organizations', rowsAnswer([dispatchRow, { ...cleanerRow, organization_id: OTHER_ORG }])],
    ['a row with no organization', rowsAnswer([{ id: DISPATCH, name: 'Dispečer', archived: false }])],
  ] as const)('is unavailable on %s', async (_, answer) => {
    expect(await readJobRoles(tableAnswering(answer as JobRolesAnswer | typeof REJECTS))).toEqual({
      ok: false,
      code: JOB_ROLES_UNAVAILABLE,
    });
  });

  it('parses a row as its three fields', () => {
    expect(jobRoleRowOf(dispatchRow)).toEqual(dispatch);
    expect(jobRoleRowOf([dispatchRow])).toBeNull();
    expect(jobRoleRowOf({ ...dispatchRow, id: '' })).toBeNull();
  });

  it('rejects through the query options on unavailable', async () => {
    const options = jobRolesQueryOptions(() => tableAnswering(REJECTS));
    const queryFn = options.queryFn as () => Promise<unknown>;

    await expect(queryFn()).rejects.toThrow(JOB_ROLES_UNAVAILABLE);
  });

  it('keeps the order total over a shared name', () => {
    const twin = { ...dispatch, id: CLEANER };

    expect(orderedJobRoles([dispatch, twin])).toEqual(orderedJobRoles([twin, dispatch]));
  });
});

describe('the Posao picker', () => {
  it('offers the live roles, and the archived one only to the member who holds it', () => {
    expect(jobRoleOptionsFor([seasonal, dispatch, cleaner], null)).toEqual([cleaner, dispatch]);
    expect(jobRoleOptionsFor([seasonal, dispatch, cleaner], seasonal)).toEqual([cleaner, dispatch, seasonal]);
  });

  it('offers the held role from the member\'s own row when the cached list lacks it', () => {
    // A stale read, or a role added since: never a picker that opens on Bez posla.
    expect(jobRoleOptionsFor([dispatch], cleaner)).toEqual([cleaner, dispatch]);
    expect(jobRoleOptionsFor([], seasonal)).toEqual([seasonal]);
    // Listed already: offered once, as the list holds it.
    expect(jobRoleOptionsFor([dispatch], dispatch)).toEqual([dispatch]);
  });

  describe('what a basics save writes for the role', () => {
    const options = jobRoleOptionsFor([dispatch, cleaner], seasonal);

    it('reads the value the picker opened with, else its current one', () => {
      expect(jobRoleOpenedWithOf({ dataset: { openedWith: SEASONAL }, value: DISPATCH })).toBe(SEASONAL);
      expect(jobRoleOpenedWithOf({ dataset: {}, value: DISPATCH })).toBe(DISPATCH);
    });

    it('writes nothing for an untouched picker', () => {
      expect(jobRoleEditOf(SEASONAL, SEASONAL, options)).toBeUndefined();
      expect(jobRoleEditOf(NO_JOB_ROLE, NO_JOB_ROLE, options)).toBeUndefined();
    });

    it('writes a changed pick, and Bez posla as null', () => {
      expect(jobRoleEditOf(SEASONAL, DISPATCH, options)).toBe(DISPATCH);
      expect(jobRoleEditOf(NO_JOB_ROLE, CLEANER, options)).toBe(CLEANER);
      expect(jobRoleEditOf(SEASONAL, NO_JOB_ROLE, options)).toBeNull();
    });

    it('writes nothing for a stale pick no longer among the options', () => {
      expect(jobRoleEditOf(SEASONAL, 'role-gone', options)).toBeUndefined();
    });

    it('keeps a held role the list lacks: offered, so the picker opens on it and writes nothing', () => {
      const lacking = jobRoleOptionsFor([dispatch], cleaner);

      expect(lacking.map((role) => role.id)).toContain(CLEANER);
      expect(jobRoleEditOf(CLEANER, CLEANER, lacking)).toBeUndefined();
    });
  });

  it('opens on the held role, or on Bez posla', () => {
    expect(jobRoleInitialValue(DISPATCH)).toBe(DISPATCH);
    expect(jobRoleInitialValue(null)).toBe(NO_JOB_ROLE);
  });

  it('admits only an offered id, Bez posla as null, and a stale value as nothing', () => {
    const options = jobRoleOptionsFor([seasonal, dispatch], null);

    expect(chosenJobRoleId(DISPATCH, options)).toBe(DISPATCH);
    expect(chosenJobRoleId(NO_JOB_ROLE, options)).toBeNull();
    expect(chosenJobRoleId(SEASONAL, options)).toBeUndefined();
  });

  it('is offered only while a role is held or a live one exists', () => {
    expect(jobRolesOffered([], null)).toBe(false);
    expect(jobRolesOffered(null, null)).toBe(false);
    expect(jobRolesOffered([seasonal], null)).toBe(false);
    expect(jobRolesOffered([dispatch], null)).toBe(true);
    expect(jobRolesOffered(null, SEASONAL)).toBe(true);
  });
});

describe('the surface state', () => {
  it('draws the answer, pulses while pending, and is unavailable on a failure or a paused first read', () => {
    expect(jobRolesSurfaceStateOf({ isPending: false, isError: false, fetchStatus: 'idle', data: [dispatch] })).toEqual({
      roles: [dispatch],
      refusal: null,
      loading: false,
      paused: false,
    });
    expect(jobRolesSurfaceStateOf({ isPending: true, isError: false, fetchStatus: 'fetching', data: undefined }).loading).toBe(true);
    expect(jobRolesSurfaceStateOf({ isPending: true, isError: false, fetchStatus: 'paused', data: undefined }).refusal).toBe(
      JOB_ROLES_UNAVAILABLE,
    );
    expect(jobRolesSurfaceStateOf({ isPending: false, isError: true, fetchStatus: 'idle', data: [dispatch] })).toEqual({
      roles: [dispatch],
      refusal: JOB_ROLES_UNAVAILABLE,
      loading: false,
      paused: false,
    });
  });

  it('announces a refetch paused over cached rows', () => {
    const state = jobRolesSurfaceStateOf({ isPending: false, isError: false, fetchStatus: 'paused', data: [dispatch] });

    expect(jobRolesNoticeOf(state)).toBe(JOB_ROLES_UNAVAILABLE);
    expect(jobRolesMessageKey(JOB_ROLES_UNAVAILABLE)).toBe('organization.jobRoles.error.unavailable');
  });
});
