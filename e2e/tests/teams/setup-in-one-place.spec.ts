import { randomBytes } from 'node:crypto';

import { SetupPage } from '../../pages/setup.page.ts';
import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  scheduleVersionsOfInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { escapeRegExp, fill, hr } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 21.26: *Timovi i raspored*, end to end (UX-DR84).
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`), with one crew
 * member on it, and a second person of the test's own on no team. On the one
 * page the admin sees the team's card — the member chip and the rotation
 * strip — removes the crew member through the member page's own team dialog
 * (opened with *Bez tima* picked), adds the second person to the team
 * through the person picker and the same dialog (opened with the team
 * picked), and gives the second person *Samo ručno* through *Raspored osobe*,
 * after which they are listed under *Ljudi bez turnusa*. Everything written —
 * both people with their versions, the seed and the team — is removed in the
 * `afterEach` whatever happens, the rotation hold released last.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const words = hr.postaviRaspored;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { readonly slug: string; members: string[]; teams: string[] } | null = null;

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

  // The people first (their team and schedule versions with them), then the seed and its pattern, then the team.
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
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
  readonly team: string;
  readonly rotation: SeededRotation;
  readonly crew: SeededLeaveMember;
  readonly loose: SeededLeaveMember;
}

async function setUp(slug: string): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = `Smjena ${suffix}`;
  const created = await seedExtraTeam(slug, team);
  own.teams.push(created.id);
  seed = await seedTeamRotation(slug, created.id, suffix);
  const rotation = seed;
  const crew = await seedLeaveMember(slug, created.id, rotation.today, 20);
  own.members.push(crew.id);
  const loose = await seedLeaveMember(slug, null, rotation.today, 20);
  own.members.push(loose.id);

  return { team, rotation, crew, loose };
}

test('links a team, its rotation and its people on one page, through the member page’s own dialogs', async ({
  fixture,
  page,
}) => {
  test.slow();
  const { team, rotation, crew, loose } = await setUp(fixture.slug);
  const screen = new SetupPage(page);

  await screen.goto();
  await expect(screen.heading(hr.nav.timoviIRaspored, { exact: true })).toBeVisible();

  // THE CARD: the crew member's chip, and the seeded pattern from today's step.
  await expect(screen.membersOf(team)).toContainText(crew.name);
  const strip = screen.stripOf(team);
  await expect(strip.getByRole('listitem')).toHaveCount(4);
  for (const name of rotation.steps) await expect(strip).toContainText(name);

  // REMOVE: the member page's team dialog, with *Bez tima* picked.
  await screen.removeButton(crew.name, team).click();
  const dialog = screen.teamDialog;
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(hr.smjene.membership.team, { exact: true })).toHaveValue('none');
  await dialog.getByRole('button', { name: hr.smjene.membership.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(screen.statusWith(fill(words.host.saved, { name: crew.name }))).toBeVisible();
  // Scheduled off the team (or off it already): no ✕ is offered on the chip any more.
  await expect(screen.removeButton(crew.name, team)).toHaveCount(0);

  // ADD: the picker, then the same dialog with this team picked.
  await screen.addMemberButton(team).click();
  const picker = screen.pickDialog(fill(words.pick.teamTitle, { team }));
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel(words.pick.label, { exact: true }).locator(`option[value="${loose.id}"]`)).toHaveText(
    fill(words.pick.currentTeam, { name: loose.name, team: hr.smjene.membership.none }),
  );
  await picker.getByLabel(words.pick.label, { exact: true }).selectOption(loose.id);
  await picker.getByRole('button', { name: words.pick.next, exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(hr.smjene.membership.team, { exact: true }).locator('option:checked')).toHaveText(team);
  await dialog.getByRole('button', { name: hr.smjene.membership.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(screen.membersOf(team)).toContainText(loose.name);
  // Focus back on *Dodaj člana*, which opened the picker.
  await expect(screen.addMemberButton(team)).toBeFocused();

  // UREDI TIM: the team dialog over this page, closed back to it.
  const editTeam = screen.editTeamButton(team);
  await editTeam.click();
  const teamEdit = screen.teamEditDialog;
  await expect(teamEdit).toBeVisible();
  await teamEdit.getByRole('button', { name: hr.smjene.close, exact: true }).click();
  await expect(teamEdit).toHaveCount(0);
  await expect(page).toHaveURL(/\/timovi-i-raspored$/);
  await expect(editTeam).toBeFocused();

  // RASPORED OSOBE for the same person, *Samo ručno* from today.
  await screen.setScheduleButton.click();
  const schedulePicker = screen.pickDialog(words.pick.scheduleTitle);
  // By id: after the add the person is on the team (today, or from a date).
  await schedulePicker.getByLabel(words.pick.label, { exact: true }).selectOption(loose.id);
  await schedulePicker.getByRole('button', { name: words.pick.next, exact: true }).click();
  const form = screen.scheduleDialog;
  await expect(form).toBeVisible();
  await form.getByRole('radio', { name: new RegExp(`^${escapeRegExp(hr.rasporedOsobe.source.manual)}`) }).click();
  await form.getByLabel(hr.rasporedOsobe.from, { exact: true }).fill(rotation.today);
  await form.getByRole('button', { name: hr.rasporedOsobe.next, exact: true }).click();
  const preview = screen.schedulePreview;
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: hr.rasporedOsobe.preview.save, exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect.poll(() => scheduleVersionsOfInSql(fixture.slug, loose.id)).toEqual([
    expect.objectContaining({ effectiveFrom: rotation.today, source: 'MANUAL' }),
  ]);
  // Listed under *Ljudi bez turnusa*, with *Raspored osobe* named for them.
  await expect(screen.peopleSection).toContainText(loose.name);
  await expect(
    screen.peopleSection.getByRole('button', { name: fill(words.people.scheduleNamed, { name: loose.name }), exact: true }),
  ).toBeVisible();

  await expectNoHorizontalScroll(page);
  // THE PHONE: one column, nothing sideways.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(screen.teamCard(team)).toBeVisible();
  await expectNoHorizontalScroll(page);
});
