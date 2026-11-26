import {
  SCHEDULE_SOURCE_MANUAL,
  SCHEDULE_SOURCE_PERSONAL,
  SCHEDULE_SOURCE_TEAM,
  checkScheduleVersions,
  scheduleSourceOn,
  type RotationStep,
  type ScheduleSource,
  type ScheduleVersion,
} from '@shift/domain';

import type { CalendarMember, CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, erasuresOutcomeOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { manualPreviewOf, type ManualPreview } from '@/features/planning/services/manual-preview';
import { ROTATION_PATTERNS_TABLE, ROTATION_STEPS_TABLE } from '@/features/rotation/services/list';
import {
  discardUnassignedPattern,
  type RotationPatternTable,
  type RotationWriteAnswer,
} from '@/features/rotation/services/write';
import {
  configurationReportOf,
  horizonWindowOf,
  unknownReportOf,
  type ShortStaffedReport,
  type StaffingWindow,
} from '@/features/staffing/services/short-staffed';
import { isIsoDate } from '@/lib/i18n/format';

/**
 * *RASPORED OSOBE* (story 21.10; R15, AD-26, AD-5 as amended 2026-11-25;
 * UX-DR75): how one member is scheduled from a date — their team's rotation,
 * a rotation of their own, or nothing but what *Ručni raspored* assigns — as
 * a `.ts` the node suite executes (AD-15). The member page's card and its
 * dialogs only draw what this module decides.
 *
 * THE VERSION is one `member_schedule_versions` row (0079): from a date on,
 * never before the organization's today, after the member's latest version,
 * while none of theirs is scheduled after today, and never a repeat of the
 * source in force (a `PERSONAL` one re-anchors, so it always changes
 * something). These are 0079's insert policy, said before anything is sent
 * ({@link scheduleSourceRefusalOf}). Only the latest version, still ahead, is
 * cancelled (*Povuci*).
 *
 * A PERSONAL ROTATION names a pattern of the organization's (R15.5): one of
 * the distinct step sequences its patterns hold ({@link patternOptionsOf}),
 * or a new one built from step rows (a shift type, working or not, times a
 * count). A new sequence equal to an offered one reuses that pattern; only a
 * truly new one is written — the pattern, its steps, then the version, the
 * rotation builder's three writes (not atomic). A definite refusal of the
 * version removes the new pattern again (`discardUnassignedPattern`). The
 * start step (*Početni korak*) is the step the member stands on at *Vrijedi
 * od*: the version is its own anchor (21.9 Design Note 1).
 *
 * THE CHECK (AD-5) reads the three core reads afresh and derives, over the
 * year from *Vrijedi od* ({@link horizonWindowOf}), *Što se mijenja* (the
 * grid's `manualPreviewOf`: the shifts lost and gained, new double bookings
 * and no-rest duties, and the roster overrides the version leaves inert,
 * R15.8), the short-staffed block, and the erasures from *Vrijedi od* on. Only
 * an erasure waits for a confirmation. Never throws.
 */

/** 0079's table. */
export const SCHEDULE_VERSIONS_TABLE = 'member_schedule_versions';

/** The longest pattern a member's own rotation may be defined with here: eight weeks. */
export const MAX_PERSONAL_PATTERN_DAYS = 56;

/** The pattern choice that builds a new one from step rows. */
export const NEW_PATTERN = 'new';

/** Logged when a check, a write or the re-read after it could not be settled. */
export const SCHEDULE_SOURCE_UNAVAILABLE = 'SCHEDULE_SOURCE_UNAVAILABLE';

/** A select's value for "nothing chosen yet": no pattern, or a step row with no type. */
export const NO_CHOICE = '';

/** A new step row: no type yet, one day. */
export const EMPTY_PATTERN_ROW: PatternRowDraft = { shiftTypeId: NO_CHOICE, count: '1' };

/** A synthetic pattern id for a sequence not yet written, so the domain can project it in the check. */
export const DRAFT_PATTERN_ID = 'draft-pattern';

/** A synthetic step id of {@link DRAFT_PATTERN_ID}. */
export function draftStepIdOf(index: number): string {
  return `draft-step-${String(index)}`;
}

// ------------------------------------------------------------- patterns

/** A run of one shift type in a pattern: `Dan ×5`. */
export interface PatternRun {
  readonly shiftTypeId: string;
  readonly count: number;
}

/** One pattern the dialog offers: its id, its steps in order, and its runs. */
export interface PatternOption {
  readonly patternId: string;
  readonly stepIds: readonly string[];
  readonly shiftTypeIds: readonly string[];
  readonly runs: readonly PatternRun[];
}

/** `[Dan, Dan, Noć]` as `[Dan ×2, Noć ×1]`. */
export function runsOf(shiftTypeIds: readonly string[]): readonly PatternRun[] {
  const runs: PatternRun[] = [];

  for (const shiftTypeId of shiftTypeIds) {
    const last = runs.at(-1);

    if (last !== undefined && last.shiftTypeId === shiftTypeId) runs[runs.length - 1] = { shiftTypeId, count: last.count + 1 };
    else runs.push({ shiftTypeId, count: 1 });
  }

  return runs;
}

/** Each pattern's steps by position. */
function stepsByPatternOf(steps: readonly RotationStep[]): ReadonlyMap<string, readonly RotationStep[]> {
  const byPattern = new Map<string, RotationStep[]>();

  for (const step of steps) {
    const known = byPattern.get(step.patternId);

    if (known === undefined) byPattern.set(step.patternId, [step]);
    else known.push(step);
  }

  for (const list of byPattern.values()) list.sort((left, right) => left.position - right.position);

  return byPattern;
}

/**
 * The patterns a member's rotation may name: each DISTINCT step sequence among
 * the organization's patterns whose every type is known and not archived
 * (0039 refuses a version onto one with an archived type), once — a team
 * rotation's own pattern first, then one a member's version names, then by
 * id, so the same sequence always offers the same pattern.
 */
export function patternOptionsOf(calendar: CalendarSnapshot): readonly PatternOption[] {
  const usable = new Set(calendar.types.filter((type) => !type.archived).map((type) => type.id));
  const teams = new Set(calendar.assignments.map((assignment) => assignment.patternId));
  const members = new Set(
    calendar.members.flatMap((member) => member.scheduleVersions.flatMap((version) => (version.patternId === null ? [] : [version.patternId]))),
  );
  const rank = (patternId: string): number => (teams.has(patternId) ? 0 : members.has(patternId) ? 1 : 2);
  const patterns = [...stepsByPatternOf(calendar.steps)]
    .filter(([, steps]) => steps.length > 0 && steps.every((step) => usable.has(step.shiftTypeId)))
    .sort(([left], [right]) => rank(left) - rank(right) || (left < right ? -1 : left > right ? 1 : 0));
  const seen = new Set<string>();
  const options: PatternOption[] = [];

  for (const [patternId, steps] of patterns) {
    const shiftTypeIds = steps.map((step) => step.shiftTypeId);
    const key = JSON.stringify(shiftTypeIds);

    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ patternId, stepIds: steps.map((step) => step.id), shiftTypeIds, runs: runsOf(shiftTypeIds) });
  }

  return options;
}

// ---------------------------------------------------------------- facts

/** One version as the card says it: its source, its date (`null` for "no version": team rotation always), and a personal rotation's pattern and start. */
export interface ScheduleSourceFact {
  readonly source: ScheduleSource;
  readonly effectiveFrom: string | null;
  /** A personal rotation's runs, or `null`. */
  readonly runs: readonly PatternRun[] | null;
  /** A personal rotation's start step, 1-based, or `null`. */
  readonly startStep: number | null;
}

export interface ScheduleSourceFacts {
  /** The source in force today. */
  readonly current: ScheduleSourceFact;
  /** The version scheduled after today, cancellable, or `null`. */
  readonly scheduled: ScheduleSourceFact | null;
}

function factOf(calendar: CalendarSnapshot, version: ScheduleVersion | null): ScheduleSourceFact {
  if (version === null) return { source: SCHEDULE_SOURCE_TEAM, effectiveFrom: null, runs: null, startStep: null };

  if (version.source !== SCHEDULE_SOURCE_PERSONAL || version.patternId === null) {
    return { source: version.source, effectiveFrom: version.effectiveFrom, runs: null, startStep: null };
  }

  const steps = stepsByPatternOf(calendar.steps).get(version.patternId) ?? [];
  const index = steps.findIndex((step) => step.id === version.offsetStepId);

  return {
    source: version.source,
    effectiveFrom: version.effectiveFrom,
    runs: steps.length === 0 ? null : runsOf(steps.map((step) => step.shiftTypeId)),
    startStep: index < 0 ? null : index + 1,
  };
}

/** The member's source today and the version scheduled after it, or `null` for a member the snapshot lacks. */
export function scheduleSourceFactsOf(calendar: CalendarSnapshot, memberId: string, today: string): ScheduleSourceFacts | null {
  const member = calendar.members.find((candidate) => candidate.id === memberId);

  if (member === undefined) return null;

  const inForce = [...member.scheduleVersions].filter((version) => version.effectiveFrom <= today).at(-1) ?? null;
  const scheduled = member.scheduleVersions.find((version) => version.effectiveFrom > today) ?? null;

  return { current: factOf(calendar, inForce), scheduled: scheduled === null ? null : factOf(calendar, scheduled) };
}

// ---------------------------------------------------------------- draft

/** One step row of a new pattern: a shift type, working or not, times a count. */
export interface PatternRowDraft {
  readonly shiftTypeId: string;
  /** As typed: a whole number from 1. */
  readonly count: string;
}

/** What the dialog holds. */
export interface ScheduleSourceDraft {
  readonly source: ScheduleSource;
  /** *Vrijedi od*, `YYYY-MM-DD`, or `''` until chosen. */
  readonly effectiveFrom: string;
  /** An offered pattern's id, or {@link NEW_PATTERN}; `null` until chosen. */
  readonly patternId: string | null;
  /** A new pattern's rows, read only with {@link NEW_PATTERN}. */
  readonly rows: readonly PatternRowDraft[];
  /** *Početni korak*, 0-based into the pattern's days. */
  readonly startStep: number;
}

/** The dialog's opening draft: a personal rotation (the card's common case), no date, no pattern, one empty row. */
export const EMPTY_SCHEDULE_DRAFT: ScheduleSourceDraft = {
  source: SCHEDULE_SOURCE_PERSONAL,
  effectiveFrom: '',
  patternId: null,
  rows: [EMPTY_PATTERN_ROW],
  startStep: 0,
};

/** No *Vrijedi od* yet. */
export const SOURCE_UNCHOSEN = 'unchosen';
/** *Vrijedi od* before the organization's today. */
export const SOURCE_PAST = 'past';
/** A version of theirs is already scheduled: it is cancelled first. */
export const SOURCE_SCHEDULED = 'scheduled';
/** A version of theirs already starts on or after that date. */
export const SOURCE_TAKEN = 'taken';
/** The source in force from that date is the same. */
export const SOURCE_UNCHANGED = 'unchanged';
/** No pattern chosen, or a new one with no step. */
export const SOURCE_NO_PATTERN = 'noPattern';
/** A count that is not a whole number from 1, or a step row with no type. */
export const SOURCE_BAD_ROW = 'badRow';
/** Longer than {@link MAX_PERSONAL_PATTERN_DAYS} days. */
export const SOURCE_TOO_LONG = 'tooLong';
/** A type of the pattern is archived, or unknown. */
export const SOURCE_ARCHIVED = 'archived';
/** The start step is not a day of the pattern. */
export const SOURCE_BAD_START = 'badStart';
/** The member, the pattern or their versions changed meanwhile: the screen is behind. */
export const SOURCE_STALE = 'stale';

export type ScheduleSourceRefusal =
  | typeof SOURCE_UNCHOSEN
  | typeof SOURCE_PAST
  | typeof SOURCE_SCHEDULED
  | typeof SOURCE_TAKEN
  | typeof SOURCE_UNCHANGED
  | typeof SOURCE_NO_PATTERN
  | typeof SOURCE_BAD_ROW
  | typeof SOURCE_TOO_LONG
  | typeof SOURCE_ARCHIVED
  | typeof SOURCE_BAD_START
  | typeof SOURCE_STALE;

/** A whole number from 1, or `null`. */
function countOf(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;

  const count = Number(text.trim());

  return count >= 1 ? count : null;
}

/**
 * The shift types of a personal draft's pattern, one per day, or a refusal:
 * an offered pattern's steps; a new one's rows expanded.
 */
export function draftSequenceOf(
  calendar: CalendarSnapshot,
  draft: ScheduleSourceDraft,
): { readonly ok: true; readonly shiftTypeIds: readonly string[] } | { readonly ok: false; readonly code: ScheduleSourceRefusal } {
  if (draft.patternId === null) return { ok: false, code: SOURCE_NO_PATTERN };

  if (draft.patternId !== NEW_PATTERN) {
    const option = patternOptionsOf(calendar).find((candidate) => candidate.patternId === draft.patternId);

    return option === undefined ? { ok: false, code: SOURCE_STALE } : { ok: true, shiftTypeIds: option.shiftTypeIds };
  }

  const shiftTypeIds: string[] = [];

  for (const row of draft.rows) {
    const count = countOf(row.count);

    if (row.shiftTypeId === NO_CHOICE || count === null) return { ok: false, code: SOURCE_BAD_ROW };

    const type = calendar.types.find((candidate) => candidate.id === row.shiftTypeId);

    if (type === undefined || type.archived) return { ok: false, code: SOURCE_ARCHIVED };
    if (shiftTypeIds.length + count > MAX_PERSONAL_PATTERN_DAYS) return { ok: false, code: SOURCE_TOO_LONG };

    for (let day = 0; day < count; day += 1) shiftTypeIds.push(row.shiftTypeId);
  }

  return shiftTypeIds.length === 0 ? { ok: false, code: SOURCE_NO_PATTERN } : { ok: true, shiftTypeIds };
}

/**
 * Why `draft` cannot be saved for `memberId` against `calendar`, as 0079's
 * insert policy would refuse it, or `null`.
 */
export function scheduleSourceRefusalOf(
  calendar: CalendarSnapshot,
  memberId: string,
  draft: ScheduleSourceDraft,
  today: string,
): ScheduleSourceRefusal | null {
  const member = calendar.members.find((candidate) => candidate.id === memberId);

  if (member === undefined) return SOURCE_STALE;
  if (!isIsoDate(draft.effectiveFrom)) return SOURCE_UNCHOSEN;
  if (draft.effectiveFrom < today) return SOURCE_PAST;
  if (member.scheduleVersions.some((version) => version.effectiveFrom > today)) return SOURCE_SCHEDULED;
  if (member.scheduleVersions.some((version) => version.effectiveFrom >= draft.effectiveFrom)) return SOURCE_TAKEN;

  if (draft.source !== SCHEDULE_SOURCE_PERSONAL) {
    return scheduleSourceOn(member.scheduleVersions, draft.effectiveFrom).source === draft.source ? SOURCE_UNCHANGED : null;
  }

  const sequence = draftSequenceOf(calendar, draft);

  if (!sequence.ok) return sequence.code;
  if (!Number.isInteger(draft.startStep) || draft.startStep < 0 || draft.startStep >= sequence.shiftTypeIds.length) {
    return SOURCE_BAD_START;
  }

  return null;
}

/**
 * What a draft writes: the version, and the pattern it needs written first
 * (`null` when it names one the organization holds). A new sequence equal to
 * an offered one reuses it.
 */
export interface ResolvedScheduleVersion {
  readonly version: ScheduleVersion;
  /** The new pattern's shift types, one per position, or `null`. */
  readonly newPattern: readonly string[] | null;
  /** *Početni korak*, 0-based: the new pattern's step the version names. */
  readonly startStep: number;
}

/**
 * {@link ResolvedScheduleVersion} of a draft {@link scheduleSourceRefusalOf}
 * accepts. A new pattern's version names {@link DRAFT_PATTERN_ID} until the
 * write gives it its stored ids.
 *
 * @throws RangeError on a draft the refusal would refuse.
 */
export function resolvedVersionOf(calendar: CalendarSnapshot, draft: ScheduleSourceDraft): ResolvedScheduleVersion {
  if (draft.source !== SCHEDULE_SOURCE_PERSONAL) {
    return {
      version: { effectiveFrom: draft.effectiveFrom, source: draft.source, patternId: null, offsetStepId: null },
      newPattern: null,
      startStep: 0,
    };
  }

  const sequence = draftSequenceOf(calendar, draft);

  if (!sequence.ok) throw new RangeError(`the draft's pattern is refused: ${sequence.code}`);

  const key = JSON.stringify(sequence.shiftTypeIds);
  const offered = patternOptionsOf(calendar).find((option) => JSON.stringify(option.shiftTypeIds) === key);

  if (offered !== undefined) {
    const offsetStepId = offered.stepIds[draft.startStep];

    if (offsetStepId === undefined) throw new RangeError(`the start step ${String(draft.startStep)} is not a day of the pattern`);

    return {
      version: { effectiveFrom: draft.effectiveFrom, source: SCHEDULE_SOURCE_PERSONAL, patternId: offered.patternId, offsetStepId },
      newPattern: null,
      startStep: draft.startStep,
    };
  }

  return {
    version: {
      effectiveFrom: draft.effectiveFrom,
      source: SCHEDULE_SOURCE_PERSONAL,
      patternId: DRAFT_PATTERN_ID,
      offsetStepId: draftStepIdOf(draft.startStep),
    },
    newPattern: sequence.shiftTypeIds,
    startStep: draft.startStep,
  };
}

// --------------------------------------------------------------- change

/** A version set from a date. */
export const CHANGE_SET = 'set';
/** The scheduled version cancelled (*Povuci*). */
export const CHANGE_CANCEL = 'cancel';

export type ScheduleSourceChange =
  | { readonly kind: typeof CHANGE_SET; readonly memberId: string; readonly resolved: ResolvedScheduleVersion }
  | { readonly kind: typeof CHANGE_CANCEL; readonly memberId: string; readonly effectiveFrom: string };

/** The date a change applies from. */
export function changeFromOf(change: ScheduleSourceChange): string {
  return change.kind === CHANGE_SET ? change.resolved.version.effectiveFrom : change.effectiveFrom;
}

function withVersions(member: CalendarMember, versions: readonly ScheduleVersion[]): CalendarMember {
  checkScheduleVersions(versions);

  return { ...member, scheduleVersions: [...versions].sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : 1)) };
}

/**
 * The calendar with `change` applied: the member's versions with the new one
 * (a new pattern's steps added under synthetic ids) or without the cancelled
 * one, on their entry and on the viewer when it is them. A new object, so the
 * calendar's per-snapshot standings are worked out afresh for it.
 *
 * @throws RangeError when the snapshot lacks the member, or the versions would be malformed.
 */
export function scheduleChangeAppliedOf(calendar: CalendarSnapshot, change: ScheduleSourceChange): CalendarSnapshot {
  const member = calendar.members.find((candidate) => candidate.id === change.memberId);

  if (member === undefined) throw new RangeError(`member ${change.memberId} is not in the snapshot`);

  const versions =
    change.kind === CHANGE_SET
      ? [...member.scheduleVersions, change.resolved.version]
      : member.scheduleVersions.filter((version) => version.effectiveFrom !== change.effectiveFrom);
  const changed = withVersions(member, versions);
  const added: RotationStep[] =
    change.kind === CHANGE_SET && change.resolved.newPattern !== null
      ? change.resolved.newPattern.map((shiftTypeId, position) => ({
          id: draftStepIdOf(position),
          patternId: DRAFT_PATTERN_ID,
          position,
          shiftTypeId,
        }))
      : [];

  return {
    ...calendar,
    steps: [...calendar.steps, ...added],
    members: calendar.members.map((candidate) => (candidate.id === member.id ? changed : candidate)),
    viewer: calendar.viewer.memberId === member.id ? { ...calendar.viewer, scheduleVersions: changed.scheduleVersions } : calendar.viewer,
  };
}

// ---------------------------------------------------------------- check

/** What the fresh check derived. */
export interface ScheduleSourceReady {
  readonly kind: typeof CHECK_READY;
  readonly rows: readonly ErasureRow[];
  readonly preview: ManualPreview;
  readonly shortStaffed: ShortStaffedReport | null;
  /** The change the check stood on: the write sends exactly it. */
  readonly change: ScheduleSourceChange;
  /** The year it was derived over. */
  readonly window: StaffingWindow;
}

export type ScheduleSourceCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: ScheduleSourceRefusal }
  | ScheduleSourceReady;

/** What a dialog asks to check: a draft to set, or the scheduled version to cancel. */
export type ScheduleSourceAsk =
  | { readonly kind: typeof CHANGE_SET; readonly memberId: string; readonly draft: ScheduleSourceDraft }
  | { readonly kind: typeof CHANGE_CANCEL; readonly memberId: string; readonly effectiveFrom: string };

/** The change an ask makes against a fresh calendar, or its refusal. */
function changeOf(
  calendar: CalendarSnapshot,
  ask: ScheduleSourceAsk,
  today: string,
): { readonly ok: true; readonly change: ScheduleSourceChange } | { readonly ok: false; readonly code: ScheduleSourceRefusal } {
  if (ask.kind === CHANGE_SET) {
    const refusal = scheduleSourceRefusalOf(calendar, ask.memberId, ask.draft, today);

    return refusal === null
      ? { ok: true, change: { kind: CHANGE_SET, memberId: ask.memberId, resolved: resolvedVersionOf(calendar, ask.draft) } }
      : { ok: false, code: refusal };
  }

  const member = calendar.members.find((candidate) => candidate.id === ask.memberId);
  const latest = member?.scheduleVersions.at(-1);

  // 0079's delete: only the member's latest version, while it is still ahead.
  if (latest === undefined || latest.effectiveFrom !== ask.effectiveFrom || latest.effectiveFrom <= today) {
    return { ok: false, code: SOURCE_STALE };
  }

  return { ok: true, change: { kind: CHANGE_CANCEL, memberId: ask.memberId, effectiveFrom: ask.effectiveFrom } };
}

function shortStaffedOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  window: StaffingWindow,
  records: readonly unknown[],
): ShortStaffedReport | null {
  try {
    return configurationReportOf(before, after, window, { isPending: false, isError: false, data: records });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    return unknownReportOf(cause);
  }
}

/** The check's decision over reads already fetched (see the module's header). */
export function scheduleSourceCheckFromReads(reads: ErasureReads, ask: ScheduleSourceAsk, today: string): ScheduleSourceCheck {
  const { calendar, records, resolutions } = reads;
  const decided = changeOf(calendar, ask, today);

  if (!decided.ok) return { kind: CHECK_REFUSED, code: decided.code };

  const from = changeFromOf(decided.change);
  const after = scheduleChangeAppliedOf(calendar, decided.change);
  const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, after, from, records, resolutions));

  if (!outcome.ok) return { kind: CHECK_UNAVAILABLE };

  const window = horizonWindowOf(from);
  const leave = organizationLeaveRecordsOf(
    records,
    calendar.members.map((member) => member.id),
  );

  return {
    kind: CHECK_READY,
    rows: outcome.rows,
    preview: manualPreviewOf(calendar, after, [ask.memberId], window, leave),
    shortStaffed: shortStaffedOf(calendar, after, window, records),
    change: decided.change,
    window,
  };
}

/** THE CHECK, over `read`'s fresh answer. Never throws. */
export function scheduleSourceCheckOf(
  read: () => Promise<ErasureReads>,
  ask: ScheduleSourceAsk,
  today: string,
  online: boolean,
): Promise<ScheduleSourceCheck> {
  return checkedOf(read, (reads) => scheduleSourceCheckFromReads(reads, ask, today), online);
}

/** What *Što se mijenja* says, as one comparable key: a stale preview is never written unseen. */
export function scheduleSourcePreviewKeyOf(check: Pick<ScheduleSourceReady, 'preview' | 'shortStaffed' | 'change'>): string {
  return JSON.stringify([check.preview, check.shortStaffed, check.change]);
}

// --------------------------------------------------------------- writes

/** The database refused the write (42501, 23503): the screen is behind, or the caller is no active admin. */
export const SOURCE_WRITE_REFUSED = 'refused';
/** 0079's one version per member and date (23505). */
export const SOURCE_WRITE_TAKEN = 'writeTaken';
/** 0039's archived type in the pattern (23514). */
export const SOURCE_WRITE_ARCHIVED = 'writeArchived';
/** Anything else: try again. */
export const SOURCE_WRITE_FAILED = 'failed';

export type ScheduleSourceWriteFailure =
  | typeof SOURCE_WRITE_REFUSED
  | typeof SOURCE_WRITE_TAKEN
  | typeof SOURCE_WRITE_ARCHIVED
  | typeof SOURCE_WRITE_FAILED;

export type ScheduleSourceWriteOutcome = { readonly ok: true } | { readonly ok: false; readonly code: ScheduleSourceWriteFailure };

interface Selecting {
  select(columns: string): PromiseLike<RotationWriteAnswer>;
}

interface FilteringByDate {
  eq(column: string, value: string): Selecting;
}

interface FilteringByMember {
  eq(column: string, value: string): FilteringByDate;
}

interface FilteringByTenant {
  eq(column: string, value: string): FilteringByMember;
}

/** The two calls on `member_schedule_versions`: one insert, and the cancel's delete by tenant, member and date. */
export interface ScheduleVersionsTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  delete(): FilteringByTenant;
}

export interface ScheduleSourceTables {
  readonly patterns: RotationPatternTable;
  readonly steps: RotationPatternTable;
  readonly versions: ScheduleVersionsTable;
}

/** The three tables through one client's `from` (the patterns', the steps' and 0079's). */
export function scheduleSourceTablesOf(client: { from(table: string): unknown }): ScheduleSourceTables {
  return {
    patterns: client.from(ROTATION_PATTERNS_TABLE) as RotationPatternTable,
    steps: client.from(ROTATION_STEPS_TABLE) as RotationPatternTable,
    versions: client.from(SCHEDULE_VERSIONS_TABLE) as ScheduleVersionsTable,
  };
}

const RETURNED = 'id';
const STEPS_RETURNED = 'id,position';

/** A refusal as this card's own failure. */
export function scheduleSourceWriteFailureOf(error: { readonly code?: string | undefined }): ScheduleSourceWriteFailure {
  switch (error.code) {
    case '42501':
    case '23503':
      return SOURCE_WRITE_REFUSED;
    case '23505':
      return SOURCE_WRITE_TAKEN;
    case '23514':
      return SOURCE_WRITE_ARCHIVED;
    default:
      return SOURCE_WRITE_FAILED;
  }
}

type Settled =
  | { readonly ok: true; readonly rows: readonly Readonly<Record<string, unknown>>[] }
  | { readonly ok: false; readonly code: ScheduleSourceWriteFailure; readonly refused: boolean };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One call settled: a throw or a malformed answer is the service (its outcome unknown); an error is a refusal. */
async function settled(write: () => PromiseLike<RotationWriteAnswer>, expected: number | null): Promise<Settled> {
  let answered: RotationWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(SOURCE_WRITE_FAILED, cause);

    return { ok: false, code: SOURCE_WRITE_FAILED, refused: false };
  }

  if (!isRecord(answered)) return { ok: false, code: SOURCE_WRITE_FAILED, refused: false };

  if (answered.error !== null && answered.error !== undefined) {
    const code = scheduleSourceWriteFailureOf(answered.error);

    if (code === SOURCE_WRITE_FAILED) console.error(code, answered.error.code);

    return { ok: false, code, refused: true };
  }

  const rows = answered.data;

  if (!Array.isArray(rows) || !rows.every(isRecord) || (expected !== null && rows.length !== expected)) {
    console.error(SOURCE_WRITE_FAILED, 'rows');

    return { ok: false, code: SOURCE_WRITE_FAILED, refused: false };
  }

  return { ok: true, rows };
}

function textOf(row: Readonly<Record<string, unknown>> | undefined, column: string): string | null {
  const value = row?.[column];

  return typeof value === 'string' && value !== '' ? value : null;
}

/** Write a new pattern and its steps; its id and step ids by position, or a failure (the pattern removed again). */
async function writtenPatternOf(
  tables: ScheduleSourceTables,
  organizationId: string,
  shiftTypeIds: readonly string[],
): Promise<{ readonly ok: true; readonly patternId: string; readonly stepIds: readonly string[] } | { readonly ok: false; readonly code: ScheduleSourceWriteFailure }> {
  const pattern = await settled(() => tables.patterns.insert({ organization_id: organizationId }).select(RETURNED), 1);

  if (!pattern.ok) return pattern;

  const patternId = textOf(pattern.rows[0], 'id');

  if (patternId === null) return { ok: false, code: SOURCE_WRITE_FAILED };

  const steps = await settled(
    () =>
      tables.steps
        .insert(
          shiftTypeIds.map((shiftTypeId, position) => ({
            organization_id: organizationId,
            pattern_id: patternId,
            position,
            shift_type_id: shiftTypeId,
          })),
        )
        .select(STEPS_RETURNED),
    shiftTypeIds.length,
  );
  const stepIds: string[] = [];

  if (steps.ok) {
    for (const row of steps.rows) {
      const id = textOf(row, 'id');
      const position = row['position'];

      if (id === null || typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position >= shiftTypeIds.length) break;

      stepIds[position] = id;
    }
  }

  if (!steps.ok || stepIds.filter((id) => id !== undefined).length !== shiftTypeIds.length) {
    await discardUnassignedPattern(tables, organizationId, patternId);

    return { ok: false, code: steps.ok ? SOURCE_WRITE_FAILED : steps.code };
  }

  return { ok: true, patternId, stepIds };
}

/**
 * Write `change` for `organizationId`: a set inserts the version (after its
 * new pattern, when it needs one), a cancel deletes the scheduled version.
 * `created_by` and `created_at` are never sent: 0079's defaults fill them.
 * One deleted row is the cancel; none is the database refusing it.
 */
export async function writeScheduleChange(
  tables: ScheduleSourceTables,
  organizationId: string,
  change: ScheduleSourceChange,
): Promise<ScheduleSourceWriteOutcome> {
  if (change.kind === CHANGE_CANCEL) {
    const removed = await settled(
      () =>
        tables.versions
          .delete()
          .eq('organization_id', organizationId)
          .eq('member_id', change.memberId)
          .eq('effective_from', change.effectiveFrom)
          .select(RETURNED),
      null,
    );

    if (!removed.ok) return removed;

    return removed.rows.length === 1 ? { ok: true } : { ok: false, code: SOURCE_WRITE_REFUSED };
  }

  const { version, newPattern, startStep } = change.resolved;
  let patternId = version.patternId;
  let offsetStepId = version.offsetStepId;
  let written: string | null = null;

  if (newPattern !== null) {
    const pattern = await writtenPatternOf(tables, organizationId, newPattern);

    if (!pattern.ok) return pattern;

    patternId = pattern.patternId;
    offsetStepId = pattern.stepIds[startStep] ?? null;
    written = pattern.patternId;
  }

  const inserted = await settled(
    () =>
      tables.versions
        .insert({
          organization_id: organizationId,
          member_id: change.memberId,
          effective_from: version.effectiveFrom,
          source: version.source,
          pattern_id: patternId,
          offset_step_id: offsetStepId,
        })
        .select(RETURNED),
    1,
  );

  if (!inserted.ok) {
    // Only after a DEFINITE refusal: an insert that threw may still commit.
    if (written !== null && inserted.refused) await discardUnassignedPattern(tables, organizationId, written);

    return { ok: false, code: inserted.code };
  }

  return { ok: true };
}

// ------------------------------------------------------------- messages

/** A source as the card names it. */
export function scheduleSourceMessageKey(
  source: ScheduleSource,
): 'rasporedOsobe.source.team' | 'rasporedOsobe.source.personal' | 'rasporedOsobe.source.manual' {
  switch (source) {
    case SCHEDULE_SOURCE_TEAM:
      return 'rasporedOsobe.source.team';
    case SCHEDULE_SOURCE_PERSONAL:
      return 'rasporedOsobe.source.personal';
    case SCHEDULE_SOURCE_MANUAL:
      return 'rasporedOsobe.source.manual';
  }
}

/** The alert a refusal says. */
export function scheduleSourceRefusalMessageKey(
  code: ScheduleSourceRefusal | ScheduleSourceWriteFailure,
):
  | 'rasporedOsobe.error.unchosen'
  | 'rasporedOsobe.error.past'
  | 'rasporedOsobe.error.scheduled'
  | 'rasporedOsobe.error.taken'
  | 'rasporedOsobe.error.unchanged'
  | 'rasporedOsobe.error.noPattern'
  | 'rasporedOsobe.error.badRow'
  | 'rasporedOsobe.error.tooLong'
  | 'rasporedOsobe.error.archived'
  | 'rasporedOsobe.error.badStart'
  | 'rasporedOsobe.error.stale'
  | 'rasporedOsobe.error.failed' {
  switch (code) {
    case SOURCE_UNCHOSEN:
      return 'rasporedOsobe.error.unchosen';
    case SOURCE_PAST:
      return 'rasporedOsobe.error.past';
    case SOURCE_SCHEDULED:
      return 'rasporedOsobe.error.scheduled';
    case SOURCE_TAKEN:
    case SOURCE_WRITE_TAKEN:
      return 'rasporedOsobe.error.taken';
    case SOURCE_UNCHANGED:
      return 'rasporedOsobe.error.unchanged';
    case SOURCE_NO_PATTERN:
      return 'rasporedOsobe.error.noPattern';
    case SOURCE_BAD_ROW:
      return 'rasporedOsobe.error.badRow';
    case SOURCE_TOO_LONG:
      return 'rasporedOsobe.error.tooLong';
    case SOURCE_ARCHIVED:
    case SOURCE_WRITE_ARCHIVED:
      return 'rasporedOsobe.error.archived';
    case SOURCE_BAD_START:
      return 'rasporedOsobe.error.badStart';
    case SOURCE_STALE:
    case SOURCE_WRITE_REFUSED:
      return 'rasporedOsobe.error.stale';
    case SOURCE_WRITE_FAILED:
      return 'rasporedOsobe.error.failed';
  }
}
