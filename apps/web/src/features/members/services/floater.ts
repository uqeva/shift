import { compareJobRoles, type JobRoleRow } from '@/features/job-roles/services/list';
import type { MemberListRow, PostgrestFailure } from '@/features/members/services/list';
import { formatList } from '@/lib/i18n/format';

/**
 * A MEMBER AS A FLOATER (story 21.13; R16.1, UX-DR77): the *Zamjena* card's
 * facts, its dialog's options, and its one save, in a `.ts` that renders
 * nothing (AD-15).
 *
 * WHAT IS STORED (0084): `members.is_floater`, and one `floater_roles` row per
 * job role the floater may cover. Both are admin-only data that only decides
 * who *Za odluku* suggests: nothing derives from them, nothing notifies and
 * no AD-5 guard reads them (E-3).
 *
 * THE SAVE is three PostgREST calls and no RPC (Design Note 5), ordered so a
 * partial save never suggests a floater for a role nobody chose: turning the
 * flag ON writes the roles first (drop, then add) and the flag LAST; turning
 * it OFF clears the flag FIRST, then drops every role; an unchanged flag
 * writes the roles alone. A role row of a member whose flag is off is inert
 * (eligibility reads the flag first).
 * A call refused after an earlier one landed is a PARTIAL save, said as such:
 * the caller re-reads the member list on every outcome, and the next save
 * completes what is missing. A role the cached list lacks (archived or added
 * since) is kept as it is: only a role the dialog offered is dropped.
 */

/** The table the roles are written to (0084). */
export const FLOATER_ROLES_TABLE = 'floater_roles';

/** The member's own row, for the flag (0084's column grant). */
export const FLOATER_FLAG_COLUMN = 'is_floater';

/** The caller may not change it: 42501, or the policy's silent zero rows. */
export const FLOATER_SAVE_DENIED = 'denied';
/** Anything else: a network error, a malformed answer, a role listed meanwhile (23505), the unforeseen. */
export const FLOATER_SAVE_FAILED = 'failed';
/** The member's flag or roles changed since the dialog opened (another admin): nothing written, the dialog re-seeded. */
export const FLOATER_SAVE_STALE = 'stale';

export type FloaterSaveFailure = typeof FLOATER_SAVE_DENIED | typeof FLOATER_SAVE_FAILED | typeof FLOATER_SAVE_STALE;

export type FloaterSaveOutcome =
  | { readonly ok: true }
  /** `partial`: an earlier call of the three landed before this one was refused. */
  | { readonly ok: false; readonly code: FloaterSaveFailure; readonly partial: boolean };

/** What the dialog saves: whether the member is a floater, and the roles they cover. */
export interface FloaterDraft {
  readonly isFloater: boolean;
  readonly roleIds: readonly string[];
}

/** The three calls a save makes, as far as the draft decides them. */
export interface FloaterChanges {
  /** The flag to write, or `null` when it is unchanged. */
  readonly flag: boolean | null;
  /** The listed roles to drop, sorted. */
  readonly dropped: readonly string[];
  /** The roles to list, sorted. */
  readonly added: readonly string[];
}

/**
 * Whether the member's stored flag or roles moved between `opened` (the row
 * the dialog opened on) and `current` (the latest read): another admin saved
 * meanwhile, so a save would overwrite what they wrote.
 */
export function floaterStaleOf(opened: MemberListRow, current: MemberListRow): boolean {
  return (
    opened.isFloater !== current.isFloater ||
    opened.floaterRoleIds.length !== current.floaterRoleIds.length ||
    opened.floaterRoleIds.some((id, index) => current.floaterRoleIds[index] !== id)
  );
}

/** The draft the dialog opens on: the member as stored. */
export function floaterDraftOf(member: MemberListRow): FloaterDraft {
  return { isFloater: member.isFloater, roleIds: member.floaterRoleIds };
}

/**
 * The calls `draft` makes against `member` as stored: the flag when it
 * changed, and the roles' difference. A draft that is no floater covers no
 * role, so every listed role is dropped.
 */
export function floaterChangesOf(member: MemberListRow, draft: FloaterDraft): FloaterChanges {
  const wanted = new Set(draft.isFloater ? draft.roleIds : []);
  const held = new Set(member.floaterRoleIds);

  return {
    flag: draft.isFloater === member.isFloater ? null : draft.isFloater,
    dropped: [...held].filter((id) => !wanted.has(id)).sort(),
    added: [...wanted].filter((id) => !held.has(id)).sort(),
  };
}

/** Whether `draft` changes anything: Spremi with nothing changed closes the dialog and writes nothing. */
export function floaterDraftChanges(member: MemberListRow, draft: FloaterDraft): boolean {
  const changes = floaterChangesOf(member, draft);

  return changes.flag !== null || changes.dropped.length > 0 || changes.added.length > 0;
}

/** The draft with `roleId` covered or not. */
export function floaterDraftWithRole(draft: FloaterDraft, roleId: string, covered: boolean): FloaterDraft {
  const ids = new Set(draft.roleIds);

  if (covered) ids.add(roleId);
  else ids.delete(roleId);

  return { ...draft, roleIds: [...ids].sort() };
}

/**
 * The roles the dialog offers, in the roles card's order: every live role,
 * and each one the member lists whatever its state, so an archived role they
 * cover can still be dropped.
 */
export function floaterRoleOptionsOf(roles: readonly JobRoleRow[], member: MemberListRow): readonly JobRoleRow[] {
  const listed = new Set(member.floaterRoleIds);

  return roles.filter((role) => !role.archived || listed.has(role.id)).sort(compareJobRoles);
}

/** What the *Zamjena* card states (UX-DR77). */
export type FloaterFacts =
  | { readonly kind: 'none' }
  /** A floater covering only an absent member with no role (R16.1). */
  | { readonly kind: 'any' }
  /** A floater with roles, while the roles are still being read: their names are not known yet. */
  | { readonly kind: 'loading' }
  /** A floater covering these roles, by name in the roles card's order; `unknown` the ids the read lacks. */
  | { readonly kind: 'roles'; readonly names: readonly string[]; readonly unknown: number };

/** The card's facts for `member`, naming their roles from `roles` (`null` while unread: loading). */
export function floaterFactsOf(member: MemberListRow, roles: readonly JobRoleRow[] | null): FloaterFacts {
  if (!member.isFloater) return { kind: 'none' };
  if (member.floaterRoleIds.length === 0) return { kind: 'any' };
  if (roles === null) return { kind: 'loading' };

  const listed = new Set(member.floaterRoleIds);
  const named = roles.filter((role) => listed.has(role.id)).sort(compareJobRoles);

  return { kind: 'roles', names: named.map((role) => role.name), unknown: listed.size - named.length };
}

/** The card's line, by its facts. Exhaustive. */
export function floaterFactsMessageKey(
  facts: FloaterFacts,
):
  | 'ljudi.floater.none'
  | 'ljudi.floater.any'
  | 'ljudi.floater.factsLoading'
  | 'ljudi.floater.roles'
  | 'ljudi.floater.rolesPartlyUnknown'
  | 'ljudi.floater.rolesUnknown' {
  switch (facts.kind) {
    case 'none':
      return 'ljudi.floater.none';
    case 'any':
      return 'ljudi.floater.any';
    case 'loading':
      return 'ljudi.floater.factsLoading';
    case 'roles':
      if (facts.names.length === 0) return 'ljudi.floater.rolesUnknown';

      return facts.unknown > 0 ? 'ljudi.floater.rolesPartlyUnknown' : 'ljudi.floater.roles';
    default: {
      const unhandled: never = facts;

      return unhandled;
    }
  }
}

/**
 * The card's line as `t()` takes it: its key, and when it names roles their
 * names as one list with their `count` (the plural *za posao* / *za poslove*).
 */
export function floaterFactsLineOf(facts: FloaterFacts): {
  readonly key: ReturnType<typeof floaterFactsMessageKey>;
  readonly values?: { readonly roles: string; readonly count: number };
} {
  const key = floaterFactsMessageKey(facts);

  return facts.kind === 'roles' && facts.names.length > 0
    ? { key, values: { roles: formatList(facts.names), count: facts.names.length } }
    : { key };
}

/** A refusal's line: denied, failed, or a partial save of either. */
export function floaterRefusalMessageKey(
  outcome: Extract<FloaterSaveOutcome, { readonly ok: false }>,
): 'ljudi.floater.error.denied' | 'ljudi.floater.error.failed' | 'ljudi.floater.error.partial' | 'ljudi.floater.error.stale' {
  if (outcome.code === FLOATER_SAVE_STALE) return 'ljudi.floater.error.stale';
  if (outcome.partial) return 'ljudi.floater.error.partial';

  return outcome.code === FLOATER_SAVE_DENIED ? 'ljudi.floater.error.denied' : 'ljudi.floater.error.failed';
}

// ----------------------------------------------------------------- the seams

/** What a PostgREST write resolves to. */
export interface FloaterWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: PostgrestFailure | null;
}

/** The flag's update: `.update({ is_floater }).eq('id', …).select('id')`. */
export interface FloaterFlagTable {
  update(values: { readonly is_floater: boolean }): {
    eq(column: 'id', value: string): { select(columns: 'id'): PromiseLike<FloaterWriteAnswer> };
  };
}

/** One row inserted: 0084's three writable columns. */
export interface FloaterRoleInsertRow {
  readonly organization_id: string;
  readonly member_id: string;
  readonly job_role_id: string;
}

/** The roles' delete and insert, named structurally so they can be stubbed. */
export interface FloaterRolesTable {
  delete(): {
    eq(
      column: 'organization_id',
      value: string,
    ): {
      eq(
        column: 'member_id',
        value: string,
      ): { in(column: 'job_role_id', values: readonly string[]): { select(columns: 'id'): PromiseLike<FloaterWriteAnswer> } };
    };
  };
  insert(rows: readonly FloaterRoleInsertRow[]): { select(columns: 'id'): PromiseLike<FloaterWriteAnswer> };
}

const INSUFFICIENT_PRIVILEGE = '42501';

/** One call, settled: a thrown or malformed answer is failed, a 42501 denied. `rows` checks a landed answer's rows. */
async function settled(
  call: () => PromiseLike<FloaterWriteAnswer>,
  rows: (data: readonly unknown[]) => boolean,
): Promise<FloaterSaveFailure | null> {
  let answered: unknown;

  try {
    answered = await call();
  } catch (cause) {
    console.error(FLOATER_SAVE_FAILED, cause);

    return FLOATER_SAVE_FAILED;
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(FLOATER_SAVE_FAILED, typeof answered);

    return FLOATER_SAVE_FAILED;
  }

  const { data, error } = answered as Record<string, unknown>;

  if (error !== null) {
    const code = typeof error === 'object' && error !== undefined ? (error as PostgrestFailure).code : undefined;

    console.error(FLOATER_SAVE_FAILED, code);

    return code === INSUFFICIENT_PRIVILEGE ? FLOATER_SAVE_DENIED : FLOATER_SAVE_FAILED;
  }

  if (!Array.isArray(data)) {
    console.error(FLOATER_SAVE_FAILED, 'no rows');

    return FLOATER_SAVE_FAILED;
  }

  return rows(data as readonly unknown[]) ? null : FLOATER_SAVE_DENIED;
}

/**
 * Save `draft` for `member` (as stored): each call only when there is
 * something to write, in the order of the header — roles then the flag when
 * it turns on, the flag then the roles when it turns off, roles alone when it
 * is unchanged. Stops at the first refusal, saying whether an earlier call
 * landed. Every call reads its rows back: an update answering no row, a
 * delete removing fewer rows than it targeted, or an insert answering fewer
 * than it sent is the policy's silent refusal (denied).
 */
export async function saveMemberFloater(
  members: FloaterFlagTable,
  roles: FloaterRolesTable,
  member: MemberListRow,
  draft: FloaterDraft,
): Promise<FloaterSaveOutcome> {
  const changes = floaterChangesOf(member, draft);
  const flag = changes.flag;

  const writeFlag = (value: boolean) => (): Promise<FloaterSaveFailure | null> =>
    settled(
      () => members.update({ is_floater: value }).eq('id', member.id).select('id'),
      (rows) => rows.length > 0,
    );
  const dropRoles = (): Promise<FloaterSaveFailure | null> =>
    settled(
      () =>
        roles
          .delete()
          .eq('organization_id', member.organizationId)
          .eq('member_id', member.id)
          .in('job_role_id', changes.dropped)
          .select('id'),
      (rows) => rows.length === changes.dropped.length,
    );
  const addRoles = (): Promise<FloaterSaveFailure | null> =>
    settled(
      () =>
        roles
          .insert(
            changes.added.map((jobRoleId) => ({
              organization_id: member.organizationId,
              member_id: member.id,
              job_role_id: jobRoleId,
            })),
          )
          .select('id'),
      (rows) => rows.length === changes.added.length,
    );

  const steps: (() => Promise<FloaterSaveFailure | null>)[] = [];

  if (flag === false) steps.push(writeFlag(false));
  if (changes.dropped.length > 0) steps.push(dropRoles);
  if (changes.added.length > 0) steps.push(addRoles);
  if (flag === true) steps.push(writeFlag(true));

  let landed = false;

  for (const step of steps) {
    const failure = await step();

    if (failure !== null) return { ok: false, code: failure, partial: landed };
    landed = true;
  }

  return { ok: true };
}
