import { SCHEDULE_SOURCE_MANUAL, SCHEDULE_SOURCE_PERSONAL, SCHEDULE_SOURCE_TEAM, type ScheduleSource } from '@shift/domain';
import { describe, expect, it } from 'vitest';

import type { MemberJobRole, MemberListRow, MemberTeamVersion } from '@/features/members/services/list';
import type { RotationSnapshot } from '@/features/rotation/services/list';
import {
  FIRST_RUN_PEOPLE,
  FIRST_RUN_ROTATION,
  FIRST_RUN_TEAM,
  FIRST_RUN_TYPES,
  activeMembersOf,
  firstRunOf,
  joinableMembersOf,
  lettersByTypeOf,
  teamCardsOf,
  teamMembersOf,
  teamStripOf,
  unrotatedGroupsOf,
  type SourceFacts,
} from '@/features/setup/services/setup';
import type { ShiftTypeDisplayRow } from '@/features/shift-types/services/list';
import type { TeamRow } from '@/features/teams/services/list';

const TODAY = '2026-11-26';
const ORG = 'org-1';

function team(id: string, name: string, extra: Partial<TeamRow> = {}): TeamRow {
  return { id, organizationId: ORG, name, archived: false, offOnHolidays: false, minimumMembers: null, ...extra } as TeamRow;
}

function member(
  id: string,
  name: string,
  teamVersions: readonly MemberTeamVersion[] = [],
  extra: { readonly active?: boolean; readonly jobRole?: MemberJobRole | null } = {},
): MemberListRow {
  return {
    id,
    organizationId: ORG,
    name,
    username: id,
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    fireRank: null,
    jobRole: extra.jobRole ?? null,
    isFloater: false,
    floaterRoleIds: [],
    authUserId: `auth-${id}`,
    statusVersions: extra.active === false ? [{ active: false, effectiveFrom: '2026-01-01' }] : [],
    teamVersions,
    timeZone: 'Europe/Zagreb',
  } as unknown as MemberListRow;
}

function on(teamId: string | null, name: string, from: string): MemberTeamVersion {
  return { team: teamId === null ? null : { id: teamId, name }, position: null, effectiveFrom: from };
}

function type(id: string, name: string, isWorking = true): ShiftTypeDisplayRow {
  return {
    type: { id, name, isWorking, archived: false },
    slot: null,
    chipClass: `chip-${id}`,
    times: null,
    scheduled: null,
  } as unknown as ShiftTypeDisplayRow;
}

const TYPES = [type('d', 'Dan'), type('n', 'Noć'), type('s', 'Slobodno', false)];

/** `D N S S`, team A on step 1 from the anchor, team B on step 3. */
function rotation(assignments: RotationSnapshot['assignments']): RotationSnapshot {
  return {
    organizationId: ORG,
    timeZone: 'Europe/Zagreb',
    teams: [],
    types: [],
    steps: [
      { id: 'p-0', patternId: 'p', position: 0, shiftTypeId: 'd' },
      { id: 'p-1', patternId: 'p', position: 1, shiftTypeId: 'n' },
      { id: 'p-2', patternId: 'p', position: 2, shiftTypeId: 's' },
      { id: 'p-3', patternId: 'p', position: 3, shiftTypeId: 's' },
    ],
    assignments,
    history: [],
    authors: [],
    overrides: [],
    rosterOverrides: [],
  } as unknown as RotationSnapshot;
}

const ROTATION = rotation([
  { teamId: 'a', patternId: 'p', offsetStepId: 'p-0', anchorDate: TODAY, effectiveFrom: '2026-01-01' },
  { teamId: 'b', patternId: 'p', offsetStepId: 'p-2', anchorDate: TODAY, effectiveFrom: '2026-01-01' },
  { teamId: 'c', patternId: 'p', offsetStepId: 'p-1', anchorDate: '2026-12-01', effectiveFrom: '2026-12-01' },
]);

describe('teamStripOf', () => {
  it('starts the pattern on the step the team stands on today, with the calendar letters', () => {
    const strip = teamStripOf(ROTATION, TYPES, 'b', TODAY);

    expect(strip?.scheduled).toBe(false);
    expect(strip?.from).toBe(TODAY);
    expect(strip?.chips.map((chip) => chip.letter)).toEqual(['S', 'S', 'D', 'N']);
    expect(strip?.chips.map((chip) => chip.name)).toEqual(['Slobodno', 'Slobodno', 'Dan', 'Noć']);
    expect(teamStripOf(ROTATION, TYPES, 'a', '2026-11-27')?.chips.map((chip) => chip.letter)).toEqual(['N', 'S', 'S', 'D']);
  });

  it('shows a rotation only scheduled from its own first date', () => {
    const strip = teamStripOf(ROTATION, TYPES, 'c', TODAY);

    expect(strip).toMatchObject({ scheduled: true, from: '2026-12-01' });
    expect(strip?.chips.map((chip) => chip.letter)).toEqual(['N', 'S', 'S', 'D']);
  });

  it('is null for a team with no rotation, or a pattern with no steps', () => {
    expect(teamStripOf(ROTATION, TYPES, 'none', TODAY)).toBeNull();
    expect(
      teamStripOf(
        { ...ROTATION, steps: [] },
        TYPES,
        'a',
        TODAY,
      ),
    ).toBeNull();
  });

  it('letters collide the way the calendar widens them', () => {
    expect([...lettersByTypeOf([type('d', 'Dan'), type('e', 'Dežurstvo')]).values()]).toEqual(['DA', 'DE']);
  });
});

describe('teamMembersOf', () => {
  const ana = member('ana', 'Ana', [on('a', 'A', '2026-01-01')]);
  const ivo = member('ivo', 'Ivo', [on('a', 'A', '2026-01-01'), on('b', 'B', '2026-12-01')]);
  const eva = member('eva', 'Eva', [on('b', 'B', '2026-01-01'), on('a', 'A', '2026-12-10')]);
  const old = member('old', 'Bora', [on('a', 'A', '2026-01-01')], { active: false });
  const off = member('off', 'Cvita', [on('a', 'A', '2026-01-01'), on(null, '', '2026-11-01')]);

  it('lists the active members on the team today by name, then those joining, with the dates', () => {
    expect(teamMembersOf([ivo, eva, ana, old, off], 'a', TODAY)).toEqual([
      { id: 'ana', name: 'Ana', joins: null, leaves: null },
      { id: 'ivo', name: 'Ivo', joins: null, leaves: '2026-12-01' },
      { id: 'eva', name: 'Eva', joins: '2026-12-10', leaves: null },
    ]);
  });

  it('offers to join only the active people neither on the team nor joining it', () => {
    const card = { members: teamMembersOf([ivo, eva, ana, old, off], 'a', TODAY) };

    expect(joinableMembersOf([ivo, eva, ana, old, off], card, TODAY).map((row) => row.id)).toEqual(['off']);
    expect(activeMembersOf([ivo, eva, ana, old, off], TODAY).map((row) => row.id)).toEqual(['ana', 'off', 'eva', 'ivo']);
  });
});

describe('teamCardsOf', () => {
  it('draws every active team, its own minimum before the organization’s', () => {
    const cards = teamCardsOf({
      teams: [team('a', 'A', { minimumMembers: 1 }), team('b', 'B'), team('x', 'X', { archived: true })],
      members: [],
      rotation: ROTATION,
      types: TYPES,
      organizationMinimum: 3,
      today: TODAY,
    });

    expect(cards.map((card) => card.team.id)).toEqual(['a', 'b']);
    expect(cards.map((card) => card.minimum)).toEqual([
      { value: 1, own: true },
      { value: 3, own: false },
    ]);
    expect(
      teamCardsOf({ teams: [team('b', 'B')], members: [], rotation: null, types: TYPES, organizationMinimum: null, today: TODAY })[0],
    ).toMatchObject({ minimum: null, strip: null });
  });
});

describe('unrotatedGroupsOf', () => {
  const vozac: MemberJobRole = { id: 'r-v', name: 'Vozač', archived: false };
  const dispecer: MemberJobRole = { id: 'r-d', name: 'Dispečer', archived: false };
  const sources: Record<string, ScheduleSource> = {
    a: SCHEDULE_SOURCE_PERSONAL,
    b: SCHEDULE_SOURCE_MANUAL,
    c: SCHEDULE_SOURCE_TEAM,
    d: SCHEDULE_SOURCE_MANUAL,
    e: SCHEDULE_SOURCE_PERSONAL,
    f: SCHEDULE_SOURCE_MANUAL,
  };
  const factsOf = (id: string): SourceFacts<{ readonly source: ScheduleSource }> | null =>
    sources[id] === undefined ? null : { current: { source: sources[id] }, scheduled: null };

  it('lists the active people on a personal rotation or manual only, by role then name, nobody’s role last', () => {
    const groups = unrotatedGroupsOf(
      [
        member('a', 'Zrinka', [], { jobRole: vozac }),
        member('b', 'Ante', [], { jobRole: vozac }),
        member('c', 'Team', [], { jobRole: vozac }),
        member('d', 'Dora', [], { jobRole: null }),
        member('e', 'Edo', [], { jobRole: dispecer }),
        member('f', 'Gone', [], { jobRole: dispecer, active: false }),
        member('g', 'Unknown'),
      ],
      factsOf,
      TODAY,
    );

    expect(groups.map((group) => [group.role?.name ?? null, group.people.map((person) => person.member.name)])).toEqual([
      ['Dispečer', ['Edo']],
      ['Vozač', ['Ante', 'Zrinka']],
      [null, ['Dora']],
    ]);
  });

  it('is empty when everybody rides their team', () => {
    expect(unrotatedGroupsOf([member('c', 'Team')], factsOf, TODAY)).toEqual([]);
  });
});

describe('firstRunOf', () => {
  const card = (members: number, strip: boolean) =>
    ({
      team: team('a', 'A'),
      members: Array.from({ length: members }, (_, index) => ({ id: String(index), name: '', joins: null, leaves: null })),
      strip: strip ? { chips: [], from: TODAY, scheduled: false } : null,
      minimum: null,
    }) as const;

  it('marks the first unfinished step next, in the order types, team, people, rotation', () => {
    expect(firstRunOf({ activeTypes: 0, cards: [], unrotated: [] })).toEqual([
      { step: FIRST_RUN_TYPES, done: false, next: true },
      { step: FIRST_RUN_TEAM, done: false, next: false },
      { step: FIRST_RUN_PEOPLE, done: false, next: false },
      { step: FIRST_RUN_ROTATION, done: false, next: false },
    ]);
    expect(firstRunOf({ activeTypes: 2, cards: [card(0, false)], unrotated: [] })?.find((entry) => entry.next)?.step).toBe(
      FIRST_RUN_PEOPLE,
    );
    expect(firstRunOf({ activeTypes: 2, cards: [card(1, false)], unrotated: [] })?.find((entry) => entry.next)?.step).toBe(
      FIRST_RUN_ROTATION,
    );
    // Somebody without a turnus counts as placed.
    expect(
      firstRunOf({ activeTypes: 2, cards: [card(0, true)], unrotated: [{ people: [{}] }] }),
    ).toBeNull();
  });

  it('is gone once every step is done', () => {
    expect(firstRunOf({ activeTypes: 1, cards: [card(2, true)], unrotated: [] })).toBeNull();
  });
});
