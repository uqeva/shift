import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobRoleRow } from '@/features/job-roles/services/list';
import {
  JOB_ROLE_ADDED,
  JOB_ROLE_ARCHIVED,
  JOB_ROLE_NAME_CONTROL,
  JOB_ROLE_NAME_EMPTY,
  JOB_ROLE_NAME_TAKEN,
  JOB_ROLE_NAME_TOO_LONG,
  JOB_ROLE_RESTORED,
  JOB_ROLE_SAVED,
  JOB_ROLE_STALE,
  JOB_ROLE_WRITE_REFUSED,
  JOB_ROLE_WRITE_UNAVAILABLE,
  createJobRole,
  enteredJobRoleOf,
  jobRoleArchiveSavedOf,
  jobRoleSavedMessageKey,
  jobRoleSavedOf,
  jobRoleWriteFailureOf,
  jobRoleWriteMessageKey,
  marksJobRoleName,
  renameJobRole,
  setJobRoleArchived,
  type JobRoleWriteAnswer,
  type JobRoleWriteFailure,
  type JobRoleWriteTable,
} from '@/features/job-roles/services/write';

/** Story 21.12: adding, renaming, archiving and restoring a job role, against a stubbed table. */

const ORG = '11111111-1111-4111-8111-111111111111';
const ROLE = '33333333-3333-4333-8333-333333333333';
const live: JobRoleRow = { id: ROLE, name: 'Dispečer', archived: false };
const archived: JobRoleRow = { ...live, archived: true };

interface Recorded {
  readonly verb: 'insert' | 'update';
  readonly values: Readonly<Record<string, unknown>>;
  readonly filters: (readonly [string, string])[];
  readonly selected: string[];
}

function tableAnswering(answer: JobRoleWriteAnswer | 'rejects'): JobRoleWriteTable & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const settle = (): Promise<JobRoleWriteAnswer> =>
    answer === 'rejects' ? Promise.reject(new Error('network')) : Promise.resolve(answer);

  return {
    calls,
    insert: (values) => {
      const call: Recorded = { verb: 'insert', values, filters: [], selected: [] };

      calls.push(call);

      return {
        select: (columns: string) => {
          call.selected.push(columns);

          return settle();
        },
      };
    },
    update: (values) => {
      const call: Recorded = { verb: 'update', values, filters: [], selected: [] };

      calls.push(call);

      return {
        eq: (column: string, value: string) => {
          call.filters.push([column, value]);

          return {
            select: (columns: string) => {
              call.selected.push(columns);

              return settle();
            },
          };
        },
      };
    },
  };
}

const ONE_ROW: JobRoleWriteAnswer = { data: [{ id: ROLE }], error: null };
const NO_ROWS: JobRoleWriteAnswer = { data: [], error: null };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the name', () => {
  it('is trimmed, and refused blank, too long or holding a control character inside', () => {
    expect(enteredJobRoleOf('  Dispečer ')).toEqual({ ok: true, name: 'Dispečer' });
    expect(enteredJobRoleOf('   ')).toEqual({ ok: false, code: JOB_ROLE_NAME_EMPTY });
    expect(enteredJobRoleOf('a'.repeat(101))).toEqual({ ok: false, code: JOB_ROLE_NAME_TOO_LONG });
    expect(enteredJobRoleOf('a'.repeat(100))).toEqual({ ok: true, name: 'a'.repeat(100) });
    expect(enteredJobRoleOf('Dis\npečer')).toEqual({ ok: false, code: JOB_ROLE_NAME_CONTROL });
  });
});

describe('the writes', () => {
  it('adds a role with the session’s organization and the trimmed name', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await createJobRole(table, ORG, ' Vod ')).toEqual({ ok: true });
    expect(table.calls).toEqual([{ verb: 'insert', values: { organization_id: ORG, name: 'Vod' }, filters: [], selected: ['id'] }]);
  });

  it('sends nothing for a name refused before the write, and keeps the input to the dialog', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await createJobRole(table, ORG, ' ')).toEqual({ ok: false, code: JOB_ROLE_NAME_EMPTY });
    expect(table.calls).toEqual([]);
  });

  it('renames, archives and restores by id', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await renameJobRole(table, live, 'Dispečerka')).toEqual({ ok: true });
    expect(await setJobRoleArchived(table, live, true)).toEqual({ ok: true });
    expect(await setJobRoleArchived(table, archived, false)).toEqual({ ok: true });
    expect(table.calls.map((call) => [call.values, call.filters])).toEqual([
      [{ name: 'Dispečerka' }, [['id', ROLE]]],
      [{ archived: true }, [['id', ROLE]]],
      [{ archived: false }, [['id', ROLE]]],
    ]);
  });

  it('is stale on zero rows or a role already in the asked state, unavailable on an insert of zero rows', async () => {
    expect(await renameJobRole(tableAnswering(NO_ROWS), live, 'Vod')).toEqual({ ok: false, code: JOB_ROLE_STALE });
    expect(await setJobRoleArchived(tableAnswering(ONE_ROW), archived, true)).toEqual({ ok: false, code: JOB_ROLE_STALE });
    expect(await createJobRole(tableAnswering(NO_ROWS), ORG, 'Vod')).toEqual({ ok: false, code: JOB_ROLE_WRITE_UNAVAILABLE });
    expect(await createJobRole(tableAnswering('rejects'), ORG, 'Vod')).toEqual({ ok: false, code: JOB_ROLE_WRITE_UNAVAILABLE });
  });

  it('reads a restore over a live role of the same name as the name taken', async () => {
    const table = tableAnswering({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "job_roles_organization_name_key"' },
    });

    expect(await setJobRoleArchived(table, archived, false)).toEqual({ ok: false, code: JOB_ROLE_NAME_TAKEN });
  });
});

describe('a refusal', () => {
  const check = (name: string) => ({ code: '23514', message: `new row violates check constraint "${name}"` });

  it.each([
    [{ code: '23505', message: 'violates unique constraint "job_roles_organization_name_key"' }, JOB_ROLE_NAME_TAKEN],
    [check('job_roles_name_not_blank'), JOB_ROLE_NAME_EMPTY],
    [check('job_roles_name_length'), JOB_ROLE_NAME_TOO_LONG],
    [check('job_roles_name_characters'), JOB_ROLE_NAME_CONTROL],
    [check('another_check'), JOB_ROLE_WRITE_UNAVAILABLE],
    [{ code: '23505', message: 'violates unique constraint "job_roles_pkey"' }, JOB_ROLE_WRITE_UNAVAILABLE],
    [{ code: '42501', message: 'new row violates row-level security policy' }, JOB_ROLE_WRITE_REFUSED],
    [{ code: 'PGRST301' }, JOB_ROLE_WRITE_UNAVAILABLE],
  ] as const)('%o reads as %s', (error, code) => {
    expect(jobRoleWriteFailureOf(error)).toBe(code);
  });

  it('never reads a constraint name out of the details a person typed', () => {
    expect(
      jobRoleWriteFailureOf({ code: '23514', message: 'check', details: 'Failing row contains ("job_roles_name_length")' }),
    ).toBe(JOB_ROLE_WRITE_UNAVAILABLE);
  });

  it('has a message for every code, and marks the name for the name’s own refusals', () => {
    const codes: JobRoleWriteFailure[] = [
      JOB_ROLE_NAME_EMPTY,
      JOB_ROLE_NAME_TOO_LONG,
      JOB_ROLE_NAME_CONTROL,
      JOB_ROLE_NAME_TAKEN,
      JOB_ROLE_STALE,
      JOB_ROLE_WRITE_REFUSED,
      JOB_ROLE_WRITE_UNAVAILABLE,
    ];

    expect(new Set(codes.map(jobRoleWriteMessageKey)).size).toBe(codes.length);
    expect(codes.filter(marksJobRoleName)).toEqual([
      JOB_ROLE_NAME_EMPTY,
      JOB_ROLE_NAME_TOO_LONG,
      JOB_ROLE_NAME_CONTROL,
      JOB_ROLE_NAME_TAKEN,
    ]);
    expect(marksJobRoleName(null)).toBe(false);
  });
});

describe('what a landed write says', () => {
  it('says an add, a rename, an archive or a restore', () => {
    expect(jobRoleSavedOf(null)).toBe(JOB_ROLE_ADDED);
    expect(jobRoleSavedOf(live)).toBe(JOB_ROLE_SAVED);
    expect(jobRoleArchiveSavedOf(true)).toBe(JOB_ROLE_ARCHIVED);
    expect(jobRoleArchiveSavedOf(false)).toBe(JOB_ROLE_RESTORED);
    expect(
      ([JOB_ROLE_ADDED, JOB_ROLE_SAVED, JOB_ROLE_ARCHIVED, JOB_ROLE_RESTORED] as const).map((saved) => jobRoleSavedMessageKey(saved)),
    ).toEqual([
      'organization.jobRoles.added',
      'organization.jobRoles.saved',
      'organization.jobRoles.archivedDone',
      'organization.jobRoles.restoredDone',
    ]);
  });
});
