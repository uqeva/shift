import { randomBytes } from 'node:crypto';

import { ManualSchedulePage } from '../../pages/manual-schedule.page.ts';
import {
  archiveShiftType,
  holdRotation,
  personalAssignmentsOfInSql,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, weekdayShort } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Stories 21.4 and 21.5: *Ručni raspored*'s whole save, end to end (the
 * 21.4 review's verification gap, deferred-work): *Popuni uzorkom* and
 * *Kopiraj* into the draft, *Spremi* → *Što se mijenja* → one
 * `save_personal_assignments`; an `OFF` over a queued conflict through the
 * erasure confirmation; and a 22023 answer that keeps the draft and re-reads
 * the calendar, after which the save lands.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`), so its types exist,
 * with a crew member on it; a student is on no team. Everything written —
 * the seed (with every assignment naming its types), the members with their
 * assignments and leave, and the team — is removed in the `afterEach`.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const words = hr.rucniRaspored;

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

  // The seed first: it deletes the assignments naming its types.
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
  readonly crew: SeededLeaveMember;
  readonly student: SeededLeaveMember;
}

/** The hold, a team with the seeded rotation and its crew member, and a student on no team. */
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
  const student = await seedLeaveMember(slug, null, rotation.today, 0);
  own.members.push(student.id);

  return { rotation, crew, student };
}

/** *Što se mijenja*'s line for a teamless shift `type` gained on `date`, with its times. */
function gainedNoTeam(date: string, type: string, range: string): string {
  return fill(words.preview.gainedNoTeam, { weekday: weekdayShort(date), date: dayMonth(date), type, range });
}

test('a pattern fill and a week copy go into the draft, show in Što se mijenja and save in one write each', async ({
  page,
  fixture,
}) => {
  test.slow();
  const { rotation, student } = await setUp(fixture.slug);
  const screen = new ManualSchedulePage(page);
  const [dan] = rotation.steps;
  const [danRange] = rotation.ranges;
  const first = addDays(rotation.today, 1);
  const last = addDays(first, 5);

  await screen.gotoMonth(first.slice(0, 7));
  await expect(screen.cellOf(student.id, first)).toBeVisible();

  // POPUNI UZORKOM: Dan ×2, Slobodno ×1 over six days, from the cycle's first day.
  await screen.fillButton.click();
  const fillDialog = screen.fillDialog;
  await expect(fillDialog).toBeVisible();
  await screen.personIn(fillDialog, student.name).check();
  await fillDialog.getByLabel(words.fill.from, { exact: true }).fill(first);
  await fillDialog.getByLabel(words.fill.to, { exact: true }).fill(last);
  await screen.stepChoiceIn(fillDialog, 1).selectOption({ label: dan });
  await screen.stepCountIn(fillDialog, 1).fill('2');
  await fillDialog.getByRole('button', { name: words.fill.add, exact: true }).click();
  await screen.stepChoiceIn(fillDialog, 2).selectOption({ label: words.fill.off });
  await screen.stepCountIn(fillDialog, 2).fill('1');
  await fillDialog.getByRole('button', { name: words.fill.submit, exact: true }).click();
  await expect(fillDialog).toHaveCount(0);

  // INTO THE DRAFT: six cells, assigned and unsaved, nothing written yet.
  await expect(screen.unsaved(6)).toBeVisible();
  await expect(screen.placedLine(6)).toBeVisible();
  await expect(screen.cellOf(student.id, first)).toHaveAttribute('aria-label', new RegExp(`${dan}.*${words.cell.assigned}.*${words.cell.changed}`));
  expect(await personalAssignmentsOfInSql(fixture.slug, student.id)).toEqual([]);

  // EVERY CELL STAYS EDITABLE: the picker opens on a filled one.
  await screen.cellOf(student.id, first).click();
  const picker = screen.pickerOf(student.name, first);
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: words.picker.close }).click();
  await expect(picker).toHaveCount(0);

  // SPREMI → ŠTO SE MIJENJA → ONE WRITE.
  await screen.saveButton.click();
  await expect(screen.preview).toBeVisible();
  await expect(screen.preview).toContainText(student.name);
  await expect(screen.preview).toContainText(gainedNoTeam(first, dan, danRange ?? ''));
  await screen.previewSave.click();
  await expect(screen.preview).toHaveCount(0);
  await expect(screen.savedLine(6)).toBeVisible();
  // The fill's line went with the save.
  await expect(screen.placedLine(6)).toHaveCount(0);
  await expect
    .poll(async () => (await personalAssignmentsOfInSql(fixture.slug, student.id)).map((row) => [row.date, row.kind]))
    .toEqual([0, 1, 2, 3, 4, 5].map((day) => [addDays(first, day), day % 3 === 2 ? 'OFF' : 'SHIFT']));

  // KOPIRAJ TJEDAN: the saved week a week later; its seventh day had none, and clears nothing.
  await screen.copyButton.click();
  const copyDialog = screen.copyDialog;
  await expect(copyDialog).toBeVisible();
  // NOBODY IS PRE-CHECKED with no selection on the grid.
  await expect(screen.personIn(copyDialog, student.name)).not.toBeChecked();
  await screen.personIn(copyDialog, student.name).check();
  // A REFUSAL stays in the dialog and drafts nothing: the target is the source.
  await copyDialog.getByLabel(words.copy.sourceWeek, { exact: true }).fill(first);
  await copyDialog.getByLabel(words.copy.targetWeek, { exact: true }).fill(first);
  await copyDialog.getByRole('button', { name: words.copy.submit, exact: true }).click();
  await expect(copyDialog.getByRole('alert')).toHaveText(words.plan.error.same);
  await expect(copyDialog).toBeVisible();
  await copyDialog.getByLabel(words.copy.targetWeek, { exact: true }).fill(addDays(first, 7));
  await expect(copyDialog.getByRole('alert')).toHaveCount(0);
  await copyDialog.getByRole('button', { name: words.copy.submit, exact: true }).click();
  await expect(copyDialog).toHaveCount(0);
  await expect(screen.unsaved(6)).toBeVisible();
  await expect(screen.placedLine(6)).toBeVisible();

  await screen.saveButton.click();
  await expect(screen.preview).toBeVisible();
  await screen.previewSave.click();
  await expect(screen.savedLine(6)).toBeVisible();
  await expect.poll(async () => (await personalAssignmentsOfInSql(fixture.slug, student.id)).length).toBe(12);

  // AN ARCHIVED TYPE IS LEFT OUT FIRST: a copy naming it drafts only the days off.
  await archiveShiftType(fixture.slug, dan);
  await screen.gotoMonth(first.slice(0, 7));
  await screen.copyButton.click();
  await expect(copyDialog).toBeVisible();
  await copyDialog.getByLabel(words.copy.sourceWeek, { exact: true }).fill(first);
  await copyDialog.getByLabel(words.copy.targetWeek, { exact: true }).fill(addDays(first, 14));
  await screen.personIn(copyDialog, student.name).check();
  await copyDialog.getByRole('button', { name: words.copy.submit, exact: true }).click();
  await expect(screen.skippedLine(4)).toBeVisible();
  // Two days off; the seventh day's clear had nothing to clear.
  await expect(screen.unsaved(2)).toBeVisible();
});

test('an OFF over a queued conflict waits for the erasure confirmation, then the queue loses it', async ({
  page,
  fixture,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, crew } = await setUp(fixture.slug);
  const screen = new ManualSchedulePage(page);
  // Today + 4 is a Dan of the seeded rotation; the crew member is on leave then.
  const date = addDays(rotation.today, 4);
  await seedLeaveRecord(fixture.slug, crew.id, date, date);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(crew.name)).toHaveCount(1);

  await screen.gotoMonth(date.slice(0, 7));
  await expect(screen.cellOf(crew.id, date)).toHaveAttribute('aria-label', new RegExp(words.cell.rotation));
  await screen.cellOf(crew.id, date).click();
  const picker = screen.pickerOf(crew.name, date);
  await expect(picker).toBeVisible();
  await screen.choiceIn(picker, words.picker.off).click();
  await expect(screen.unsaved(1)).toBeVisible();

  await screen.saveButton.click();
  await expect(screen.preview).toBeVisible();
  await expect(screen.preview).toContainText(plural(words.preview.erasures, 1));
  await screen.previewSave.click();

  // THE ONE THING THAT WAITS: nothing is written until the erasure is confirmed.
  const parts = screen.erasures;
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  expect(await personalAssignmentsOfInSql(fixture.slug, crew.id)).toEqual([]);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(parts.saveIn(dialog)).toHaveAttribute('aria-disabled', 'true');
  await parts.confirmIn(rows.nth(0)).click();
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(screen.savedLine(1)).toBeVisible();
  await expect
    .poll(async () => (await personalAssignmentsOfInSql(fixture.slug, crew.id)).map((row) => [row.date, row.kind]))
    .toEqual([[date, 'OFF']]);

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(crew.name)).toHaveCount(0);
});

test('a save refused as stale (22023) keeps the draft and re-reads the calendar, and the next save lands', async ({
  page,
  fixture,
}) => {
  test.slow();
  const { rotation, student } = await setUp(fixture.slug);
  const screen = new ManualSchedulePage(page);
  const [dan] = rotation.steps;
  const date = addDays(rotation.today, 2);
  const write = '**/rest/v1/rpc/save_personal_assignments*';
  let refused = false;

  await screen.gotoMonth(date.slice(0, 7));
  await screen.cellOf(student.id, date).click();
  const picker = screen.pickerOf(student.name, date);
  await expect(picker).toBeVisible();
  await screen.choiceIn(picker, dan).click();
  await expect(screen.unsaved(1)).toBeVisible();

  // 0077 REFUSES THE BATCH as the database would when a type was archived meanwhile.
  await page.route(write, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    refused = true;

    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: '22023', message: 'PERSONAL_ASSIGNMENTS_INVALID', details: null, hint: null }),
    });
  });
  const reread = page.waitForRequest((request) => refused && request.url().includes('/rest/v1/rpc/calendar_personal_assignments'));

  await screen.saveButton.click();
  await expect(screen.preview).toBeVisible();
  await screen.previewSave.click();

  await expect(screen.alert.filter({ hasText: words.error.stale })).toBeVisible();
  await reread;
  // THE DRAFT IS KEPT: the cell is still unsaved, and nothing was written.
  await expect(screen.unsaved(1)).toBeVisible();
  await expect(screen.cellOf(student.id, date)).toHaveAttribute('aria-label', new RegExp(words.cell.changed));
  expect(await personalAssignmentsOfInSql(fixture.slug, student.id)).toEqual([]);

  await page.unroute(write);
  await screen.saveButton.click();
  await expect(screen.preview).toBeVisible();
  await screen.previewSave.click();
  await expect(screen.savedLine(1)).toBeVisible();
  await expect
    .poll(async () => (await personalAssignmentsOfInSql(fixture.slug, student.id)).map((row) => [row.date, row.kind]))
    .toEqual([[date, 'SHIFT']]);
});
