import {
  SCHEDULE_SOURCE_MANUAL,
  SCHEDULE_SOURCE_PERSONAL,
  projectedStepId,
  type ScheduleSource,
} from '@shift/domain';

import { typeLettersOf } from '@/features/calendar/utils/month';
import {
  memberActiveOn,
  memberTeamOf,
  type MemberJobRole,
  type MemberListRow,
} from '@/features/members/services/list';
import {
  assignmentInForceOf,
  patternStepsOf,
  teamAssignmentsOf,
  type RotationSnapshot,
} from '@/features/rotation/services/list';
import type { ShiftTypeDisplayRow } from '@/features/shift-types/services/list';
import type { TeamRow } from '@/features/teams/services/list';

/**
 * *Timovi i raspored*'s rules (story 21.26, UX-DR84): what each part of the
 * page draws, derived from the reads the other screens already make — the
 * member list, the teams, the rotation snapshot, the shift types and the
 * calendar snapshot. Nothing here writes, and nothing here decides a write:
 * every change on the page goes through the dialog and the rule it has on
 * its own screen.
 */

/** One chip of a team's rotation strip: the type's letter, its name, and its slot classes. */
export interface StripChip {
  /** The step's position in the strip, from today's step: a stable key. */
  readonly index: number;
  readonly shiftTypeId: string;
  /** `D`, `N`, `S` — `typeLettersOf` over every type, so the letters agree with the calendar's. */
  readonly letter: string;
  readonly name: string;
  readonly chipClass: string;
}

/** A team's rotation as the card shows it. */
export interface TeamStrip {
  /** The pattern from the step the team stands on `from`. */
  readonly chips: readonly StripChip[];
  /** The date the strip starts on: today, or the first date of a rotation only scheduled. */
  readonly from: string;
  /** Whether the rotation is only scheduled (none in force today). */
  readonly scheduled: boolean;
}

/** One member chip on a team's card. */
export interface TeamMemberChip {
  readonly id: string;
  readonly name: string;
  /** The date the member joins (scheduled), or `null` for a member on the team today. */
  readonly joins: string | null;
  /** The date the member leaves the team (scheduled), or `null`. */
  readonly leaves: string | null;
}

/** One active team's card. */
export interface TeamCard {
  readonly team: TeamRow;
  /** The team's members today, then those scheduled to join; by name. */
  readonly members: readonly TeamMemberChip[];
  /** The rotation in force (or scheduled), or `null` for none. */
  readonly strip: TeamStrip | null;
  /** The team's own minimum, else the organization's, else `null` (R10.2 amended, `minimumOf`'s order). */
  readonly minimum: { readonly value: number; readonly own: boolean } | null;
}

/** Hr collation for names, the order every list of people on the page uses. */
function byName(first: { readonly name: string }, second: { readonly name: string }): number {
  return first.name.localeCompare(second.name, 'hr');
}

/**
 * The strip of one team: the pattern in force on `today`, rotated so the step
 * the team stands on today is first — or, with none in force, the earliest
 * version scheduled after today, from its own first date. `null` for a team
 * with no rotation at all, or a pattern with no steps.
 */
export function teamStripOf(
  rotation: RotationSnapshot,
  types: readonly ShiftTypeDisplayRow[],
  teamId: string,
  today: string,
): TeamStrip | null {
  const inForce = assignmentInForceOf(rotation, teamId, today);
  const later =
    inForce === null
      ? ([...teamAssignmentsOf(rotation, teamId)]
          .filter((assignment) => assignment.effectiveFrom > today)
          .sort((one, other) => (one.effectiveFrom < other.effectiveFrom ? -1 : 1))[0] ?? null)
      : null;
  const assignment = inForce ?? later;

  if (assignment === null) return null;

  const from = inForce === null ? assignment.effectiveFrom : today;
  const steps = patternStepsOf(rotation, assignment.patternId);

  if (steps.length === 0) return null;

  const onFrom = projectedStepId(steps, assignment, from);
  const start = Math.max(
    0,
    steps.findIndex((step) => step.id === onFrom),
  );
  const letters = lettersByTypeOf(types);

  return {
    from,
    scheduled: inForce === null,
    chips: steps.map((_, offset) => {
      const step = steps[(start + offset) % steps.length];
      const shiftTypeId = step?.shiftTypeId ?? '';
      const type = types.find((row) => row.type.id === shiftTypeId);

      return {
        index: offset,
        shiftTypeId,
        letter: letters.get(shiftTypeId) ?? '?',
        name: type?.type.name ?? '',
        chipClass: type?.chipClass ?? '',
      };
    }),
  };
}

/** Each type's letter, over every type the list holds, as the calendar letters them. */
export function lettersByTypeOf(types: readonly ShiftTypeDisplayRow[]): ReadonlyMap<string, string> {
  const letters = typeLettersOf(types.map((row) => row.type.name));

  return new Map(types.map((row, index) => [row.type.id, letters[index] ?? '?']));
}

/**
 * The members of one team as its card shows them, from the member list:
 * every ACTIVE member on the team today (with the date they leave, when a
 * move off it is scheduled), then every active member scheduled to join it,
 * each group by name.
 */
export function teamMembersOf(members: readonly MemberListRow[], teamId: string, today: string): readonly TeamMemberChip[] {
  const now: TeamMemberChip[] = [];
  const joining: TeamMemberChip[] = [];

  for (const member of members) {
    if (!memberActiveOn(member, today)) continue;

    const state = memberTeamOf(member, today);
    const scheduledTeam = state.scheduled === null ? undefined : (state.scheduled.team?.id ?? null);

    if (state.team?.id === teamId) {
      now.push({
        id: member.id,
        name: member.name,
        joins: null,
        leaves: state.scheduled !== null && scheduledTeam !== teamId ? state.scheduled.from : null,
      });
    } else if (state.scheduled !== null && scheduledTeam === teamId) {
      joining.push({ id: member.id, name: member.name, joins: state.scheduled.from, leaves: null });
    }
  }

  return [...now.sort(byName), ...joining.sort(byName)];
}

/** Every active team's card, in the teams list's order. */
export function teamCardsOf(input: {
  readonly teams: readonly TeamRow[];
  readonly members: readonly MemberListRow[];
  readonly rotation: RotationSnapshot | null;
  readonly types: readonly ShiftTypeDisplayRow[];
  readonly organizationMinimum: number | null;
  readonly today: string;
}): readonly TeamCard[] {
  return input.teams
    .filter((team) => !team.archived)
    .map((team) => ({
      team,
      members: teamMembersOf(input.members, team.id, input.today),
      strip: input.rotation === null ? null : teamStripOf(input.rotation, input.types, team.id, input.today),
      minimum:
        team.minimumMembers !== null
          ? { value: team.minimumMembers, own: true }
          : input.organizationMinimum === null
            ? null
            : { value: input.organizationMinimum, own: false },
    }));
}

/**
 * A member's schedule source today and the change scheduled after it, as
 * the member page reads them (21.10's `scheduleSourceFactsOf`), handed in by
 * the page: `Fact` is that page's fact, of which only `source` is read here.
 */
export interface SourceFacts<Fact extends { readonly source: ScheduleSource }> {
  readonly current: Fact;
  readonly scheduled: Fact | null;
}

/** One person of *Ljudi bez turnusa*. */
export interface UnrotatedPerson<Fact extends { readonly source: ScheduleSource }> {
  readonly member: MemberListRow;
  /** The source in force today: a personal rotation or manual only. */
  readonly fact: Fact;
  /** The change scheduled after today, or `null`. */
  readonly scheduled: Fact | null;
}

/** One job role's group of *Ljudi bez turnusa*; `role` `null` is *Bez posla*. */
export interface UnrotatedGroup<Fact extends { readonly source: ScheduleSource }> {
  readonly role: MemberJobRole | null;
  readonly people: readonly UnrotatedPerson<Fact>[];
}

/**
 * *Ljudi bez turnusa*: every active member whose schedule source today is a
 * personal rotation or manual only (`factsOf`, the member page's facts), grouped
 * by job role — the roles by name, *Bez posla* last — and by name in each.
 */
export function unrotatedGroupsOf<Fact extends { readonly source: ScheduleSource }>(
  members: readonly MemberListRow[],
  factsOf: (memberId: string) => SourceFacts<Fact> | null,
  today: string,
): readonly UnrotatedGroup<Fact>[] {
  const groups = new Map<string, { role: MemberJobRole | null; people: UnrotatedPerson<Fact>[] }>();

  for (const member of members) {
    if (!memberActiveOn(member, today)) continue;

    const facts = factsOf(member.id);

    if (facts === null) continue;
    if (facts.current.source !== SCHEDULE_SOURCE_PERSONAL && facts.current.source !== SCHEDULE_SOURCE_MANUAL) continue;

    const key = member.jobRole?.id ?? '';
    const group = groups.get(key) ?? { role: member.jobRole, people: [] };

    group.people.push({ member, fact: facts.current, scheduled: facts.scheduled });
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({ role: group.role, people: [...group.people].sort((one, other) => byName(one.member, other.member)) }))
    .sort((one, other) => {
      if (one.role === null) return other.role === null ? 0 : 1;
      if (other.role === null) return -1;

      return byName(one.role, other.role);
    });
}

/** The members the *Dodaj člana* picker offers for a team: active, and neither on it today nor joining it. */
export function joinableMembersOf(
  members: readonly MemberListRow[],
  card: Pick<TeamCard, 'members'>,
  today: string,
): readonly MemberListRow[] {
  const taken = new Set(card.members.map((member) => member.id));

  return members.filter((member) => memberActiveOn(member, today) && !taken.has(member.id)).sort(byName);
}

/** The active members, by name: the *Raspored osobe* picker's choices. */
export function activeMembersOf(members: readonly MemberListRow[], today: string): readonly MemberListRow[] {
  return members.filter((member) => memberActiveOn(member, today)).sort(byName);
}

/** The guided first run's four steps, in their order (UX-DR84). */
export const FIRST_RUN_TYPES = 'types';
export const FIRST_RUN_TEAM = 'team';
export const FIRST_RUN_PEOPLE = 'people';
export const FIRST_RUN_ROTATION = 'rotation';

export type FirstRunStep =
  | typeof FIRST_RUN_TYPES
  | typeof FIRST_RUN_TEAM
  | typeof FIRST_RUN_PEOPLE
  | typeof FIRST_RUN_ROTATION;

export const FIRST_RUN_ORDER: readonly FirstRunStep[] = [
  FIRST_RUN_TYPES,
  FIRST_RUN_TEAM,
  FIRST_RUN_PEOPLE,
  FIRST_RUN_ROTATION,
];

/** One step of *Prvi koraci*: done, the next one, or waiting on an earlier one. */
export interface FirstRunEntry {
  readonly step: FirstRunStep;
  readonly done: boolean;
  /** The first step not done: its action is the one offered. */
  readonly next: boolean;
}

/**
 * *Prvi koraci*, or `null` once every step is done: a shift type in use, an
 * active team, somebody on an active team (today or scheduled) or without a
 * turnus, and a rotation in force or scheduled for an active team.
 */
export function firstRunOf(input: {
  readonly activeTypes: number;
  readonly cards: readonly TeamCard[];
  readonly unrotated: readonly { readonly people: readonly unknown[] }[];
}): readonly FirstRunEntry[] | null {
  const done: Record<FirstRunStep, boolean> = {
    [FIRST_RUN_TYPES]: input.activeTypes > 0,
    [FIRST_RUN_TEAM]: input.cards.length > 0,
    [FIRST_RUN_PEOPLE]:
      input.cards.some((card) => card.members.length > 0) || input.unrotated.some((group) => group.people.length > 0),
    [FIRST_RUN_ROTATION]: input.cards.some((card) => card.strip !== null),
  };

  if (FIRST_RUN_ORDER.every((step) => done[step])) return null;

  const next = FIRST_RUN_ORDER.find((step) => !done[step]);

  return FIRST_RUN_ORDER.map((step) => ({ step, done: done[step], next: step === next }));
}

/** A first-run step's title. */
export function firstRunTitleMessageKey(
  step: FirstRunStep,
):
  | 'postaviRaspored.firstRun.types.title'
  | 'postaviRaspored.firstRun.team.title'
  | 'postaviRaspored.firstRun.people.title'
  | 'postaviRaspored.firstRun.rotation.title' {
  switch (step) {
    case FIRST_RUN_TYPES:
      return 'postaviRaspored.firstRun.types.title';
    case FIRST_RUN_TEAM:
      return 'postaviRaspored.firstRun.team.title';
    case FIRST_RUN_PEOPLE:
      return 'postaviRaspored.firstRun.people.title';
    case FIRST_RUN_ROTATION:
      return 'postaviRaspored.firstRun.rotation.title';
  }
}

/** A first-run step's one-line hint. */
export function firstRunHintMessageKey(
  step: FirstRunStep,
):
  | 'postaviRaspored.firstRun.types.hint'
  | 'postaviRaspored.firstRun.team.hint'
  | 'postaviRaspored.firstRun.people.hint'
  | 'postaviRaspored.firstRun.rotation.hint' {
  switch (step) {
    case FIRST_RUN_TYPES:
      return 'postaviRaspored.firstRun.types.hint';
    case FIRST_RUN_TEAM:
      return 'postaviRaspored.firstRun.team.hint';
    case FIRST_RUN_PEOPLE:
      return 'postaviRaspored.firstRun.people.hint';
    case FIRST_RUN_ROTATION:
      return 'postaviRaspored.firstRun.rotation.hint';
  }
}

/** A first-run step's action, the page's own button for it. */
export function firstRunActionMessageKey(
  step: FirstRunStep,
):
  | 'postaviRaspored.firstRun.types.action'
  | 'postaviRaspored.firstRun.team.action'
  | 'postaviRaspored.firstRun.people.action'
  | 'postaviRaspored.firstRun.rotation.action' {
  switch (step) {
    case FIRST_RUN_TYPES:
      return 'postaviRaspored.firstRun.types.action';
    case FIRST_RUN_TEAM:
      return 'postaviRaspored.firstRun.team.action';
    case FIRST_RUN_PEOPLE:
      return 'postaviRaspored.firstRun.people.action';
    case FIRST_RUN_ROTATION:
      return 'postaviRaspored.firstRun.rotation.action';
  }
}

// ---------------------------------------------------------------- element ids

/** The *Timovi* heading: focus falls back to it when an opener is gone. */
export const SETUP_TEAMS_HEADING_ID = 'setup-teams-heading';

/** The *Tipovi smjena* heading, likewise. */
export const SETUP_TYPES_HEADING_ID = 'setup-types-heading';

/** The *Ljudi bez turnusa* heading, likewise. */
export const SETUP_PEOPLE_HEADING_ID = 'setup-people-heading';

/** A team card's heading: where focus lands when the chip that opened a dialog is gone. */
export function setupTeamHeadingId(teamId: string): string {
  return `setup-team-${teamId}`;
}

/** The person picker's `<select>` and its refusal. */
export const SETUP_PICK_MEMBER_ID = 'setup-pick-member';
export const SETUP_PICK_ERROR_ID = 'setup-pick-error';

/** A letter for a type the list does not hold: never drawn for a type it has. */
export const NO_LETTER = '?';

/** The picker's placeholder value: no person chosen. */
export const NO_PICK = '';
