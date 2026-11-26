import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { escapeRegExp, hr } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * STORY 21.25 (UX-DR83), *Kalendar kao papir*: *Svi timovi* from 640 px reads
 * like the paper roster — a column per date, the teams' rows first, then the
 * people on a personal or manual schedule grouped by job role — and a cell
 * opens the day detail. Under the run's rotation hold, a team of the test's
 * own gets the seeded rotation from today, with a crew member on it; a
 * student is on no team. Everything written is removed in the `afterEach`,
 * every step whichever fails, and the hold released last.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const paper = hr.kalendar.paper;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { readonly slug: string; members: string[]; teams: string[] } | null = null;

test.afterEach(async () => {
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (cause) {
      failures.push(cause);
    }
  };
  const seeded = seed;
  const own = written;

  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
  seed = null;
  written = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

interface Setup {
  readonly rotation: SeededRotation;
  readonly team: { readonly id: string; readonly name: string };
  readonly crew: SeededLeaveMember;
  readonly student: SeededLeaveMember;
}

async function setUp(slug: string): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const crew = await seedLeaveMember(slug, team.id, rotation.today, 0);
  own.members.push(crew.id);
  const student = await seedLeaveMember(slug, null, rotation.today, 0);
  own.members.push(student.id);

  return { rotation, team, crew, student };
}

test('the month reads like paper: dates across, the team’s row, then a person on no team under their role', async ({
  page,
  calendarPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { rotation, team, crew, student } = await setUp(fixture.slug);

  await calendarPage.goto(`?prikaz=sve&mjesec=${rotation.today.slice(0, 7)}`);
  await expect(calendarPage.teamHeader(team.name)).toBeVisible();
  // A column per date, today's marked current.
  expect(await calendarPage.dateCount()).toBeGreaterThanOrEqual(28);
  await expect(calendarPage.todayColumnAnywhere).toHaveCount(1);
  // The team's cell names its type; its crew member is read on its row, never as a person.
  const cell = await calendarPage.cellOf(team.name, rotation.today);
  await expect(cell).toHaveAccessibleName(calendarPage.typeNamed(rotation.steps[0] ?? ''));
  await expect(calendarPage.personRow(crew.name)).toHaveCount(0);
  // The student is a person's row, with no team, under the people with no role
  // (or their role's heading, should another spec have given one meanwhile).
  const studentRow = calendarPage.personRow(student.name);
  await expect(studentRow).toHaveCount(1);
  await expect(studentRow.getByRole('rowheader')).toContainText(paper.noTeam);
  // A person's cell is named in full and opens a day detail.
  const studentCell = studentRow.getByRole('gridcell').nth(Number(rotation.today.slice(8, 10)) - 1);
  await expect(studentCell).toHaveAccessibleName(new RegExp(`, ${escapeRegExp(student.name)}, ${escapeRegExp(paper.cell.none)}`));
  await studentCell.click();
  await expect(calendarPage.dialog()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(calendarPage.dialog()).toHaveCount(0);
  // The page never scrolls sideways; the grid's own scroller does.
  await expectNoHorizontalScroll(page);
});
