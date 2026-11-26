import { randomBytes } from 'node:crypto';

import {
  cleanUpJobRolesInSql,
  conflictResolutionsOfInSql,
  floaterOfInSql,
  holdRotation,
  personalAssignmentsOfInSql,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedFloaterInSql,
  seedJobRoleInSql,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays } from '../../utils/dates.ts';
import { hr } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 21.13 (R16.2, R16.3, UX-DR77): *Za odluku* suggests a free floater
 * first for an uncovered shift, and a pick covers it by the floater's own
 * assignment counted with the conflict's team, a team rotation shift's too.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`), with a crew member
 * on it, who is on leave over a Dan; a student on no team is a floater with no
 * role (so any absent member with no role is theirs to cover). Everything
 * written — the seed, the members with their assignments, leave, floater
 * roles and decisions, and the team — is removed in the `afterEach`.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const resolution = hr.zaOdluku.resolution;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { readonly slug: string; members: string[]; teams: string[] } | null = null;
/** The job roles a test wrote, swept with every floater row and member holding them. */
let roles: { readonly slug: string; names: string[] } | null = null;

test.afterEach(async () => {
  // EVERY STEP RUNS, whichever fails; the first failure is reported once all have run.
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

  // The seed first: it deletes the assignments naming its types, and the decisions on them.
  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
  const ownRoles = roles;
  if (ownRoles !== null) await attempt(() => cleanUpJobRolesInSql(ownRoles.slug, ownRoles.names));
  seed = null;
  written = null;
  roles = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

interface Setup {
  readonly rotation: SeededRotation;
  readonly teamId: string;
  readonly crew: SeededLeaveMember;
  readonly floater: SeededLeaveMember;
  /** A Dan of the team, four days on (the cycle's first step again). */
  readonly date: string;
}

/** The hold, a team with the seeded rotation, its crew member on leave over a Dan, and a floater on no team. */
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
  const crew = await seedLeaveMember(slug, team.id, rotation.today, 20);
  own.members.push(crew.id);
  const floater = await seedLeaveMember(slug, null, rotation.today, 0);
  own.members.push(floater.id);
  await seedFloaterInSql(slug, floater.id);
  const date = addDays(rotation.today, 4);
  await seedLeaveRecord(slug, crew.id, date, date);

  return { rotation, teamId: team.id, crew, floater, date };
}

test('a free floater is suggested first, and picking them covers the team’s Dan by their own assignment counted with the team', async ({
  page,
  fixture,
  conflictsPage,
  resolutionPage,
}) => {
  test.slow();
  const { teamId, crew, floater, date } = await setUp(fixture.slug);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(crew.name);
  await expect(rows).toHaveCount(1);
  await conflictsPage.rowLink(rows.nth(0)).click();
  await expect(page).toHaveURL(new RegExp(`/za-odluku/${crew.id}/${date}/${teamId}$`));

  // PREDLOŽENE ZAMJENE, first, with the floater's shifts this month; never again in another group.
  await resolutionPage.replaceOption.click();
  const suggested = resolutionPage.candidateGroup(resolution.suggestions);
  await expect(suggested).toBeVisible();
  await expect(suggested.getByRole('radio', { name: new RegExp(`^${floater.name} · `) })).toHaveCount(1);
  await expect(resolutionPage.candidates.getByRole('radio').first()).toHaveAccessibleName(new RegExp(`^${floater.name} · `));
  await expect(resolutionPage.candidate(floater.name)).toHaveCount(1);
  await expect(resolutionPage.candidates.getByRole('radio', { checked: true })).toHaveCount(0);

  // A SUGGESTED PICK (R16.3): the floater's SHIFT assignment counted with the team, and the decision naming it.
  await resolutionPage.candidate(floater.name).click();
  await resolutionPage.saveButton.click();
  await expect(page).toHaveURL('/za-odluku');
  await expect(conflictsPage.savedStatus).toContainText(floater.name);
  await expect(conflictsPage.rowsOf(crew.name)).toHaveCount(0);
  await expect
    .poll(async () => (await personalAssignmentsOfInSql(fixture.slug, floater.id)).map((row) => [row.date, row.kind, row.teamId]))
    .toEqual([[date, 'SHIFT', teamId]]);
  expect(await conflictResolutionsOfInSql(fixture.slug, crew.id)).toEqual([
    { date, teamId, kind: 'replace_member', assignmentMember: floater.id },
  ]);
});

test('a floater on leave that date is not suggested, and the screen says nobody is free', async ({
  page,
  fixture,
  conflictsPage,
  resolutionPage,
}) => {
  test.slow();
  const { teamId, crew, floater, date } = await setUp(fixture.slug);
  await seedLeaveRecord(fixture.slug, floater.id, date, date);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(crew.name);
  await expect(rows).toHaveCount(1);
  await conflictsPage.rowLink(rows.nth(0)).click();
  await expect(page).toHaveURL(new RegExp(`/za-odluku/${crew.id}/${date}/${teamId}$`));

  await resolutionPage.replaceOption.click();
  // The crew member has no job role: the line names none.
  await expect(resolutionPage.noSuggestionLine).toBeVisible();
  await expect(resolutionPage.candidateGroup(resolution.suggestions)).toHaveCount(0);
  // Still offered, in their own group: a suggestion only narrows, it never hides a candidate.
  await expect(resolutionPage.candidateGroup(resolution.candidates.onLeave).getByRole('radio', { name: new RegExp(`^${floater.name}`) })).toHaveCount(1);
});

test('an absent member with a job role is covered by the floater who lists it', async ({
  page,
  fixture,
  conflictsPage,
  resolutionPage,
}) => {
  test.slow();
  const { teamId, crew, floater, date } = await setUp(fixture.slug);
  const role = await seedJobRoleInSql(fixture.slug, randomBytes(3).toString('hex'), crew.id);
  roles = { slug: fixture.slug, names: [role.name] };

  // Listing no role, the floater covers only an absent member with none (R16.1): nobody is suggested.
  await page.goto(`/za-odluku/${crew.id}/${date}/${teamId}`);
  await resolutionPage.replaceOption.click();
  await expect(resolutionPage.candidateGroup(resolution.suggestions)).toHaveCount(0);

  // Listing the crew member's role, they are.
  await seedFloaterInSql(fixture.slug, floater.id, [role.id]);
  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(crew.name);
  await expect(rows).toHaveCount(1);
  await conflictsPage.rowLink(rows.nth(0)).click();
  await resolutionPage.replaceOption.click();
  await expect(
    resolutionPage.candidateGroup(resolution.suggestions).getByRole('radio', { name: new RegExp(`^${floater.name} · `) }),
  ).toHaveCount(1);
});

test('the member page marks a member a floater with one role, and stores the flag and the role', async ({ fixture, peoplePage }) => {
  test.slow();
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug: fixture.slug, members: [], teams: [] };
  written = own;
  // A member on no team: no team join, so no date (as `history.spec.ts` seeds one).
  const member = await seedLeaveMember(fixture.slug, null, '', 0);
  own.members.push(member.id);
  const role = await seedJobRoleInSql(fixture.slug, randomBytes(3).toString('hex'));
  roles = { slug: fixture.slug, names: [role.name] };

  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.floaterCard).toContainText(hr.ljudi.floater.none);
  await peoplePage.floaterChangeButton(member.name).click();
  await expect(peoplePage.floaterDialog).toBeVisible();
  await peoplePage.floaterFlag.check();
  await peoplePage.floaterRole(role.name).check();
  await peoplePage.floaterSaveButton.click();
  await expect(peoplePage.floaterDialog).toHaveCount(0);
  await expect(peoplePage.floaterCard).toContainText(role.name);
  await expect(peoplePage.floaterCard).toContainText(hr.ljudi.floater.saved);
  await expect.poll(async () => floaterOfInSql(fixture.slug, member.id)).toEqual({ isFloater: true, roleIds: [role.id] });
});
