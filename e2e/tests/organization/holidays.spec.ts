import { cleanUpHolidaysInSql, holdRotation, type RotationHold } from '../../utils/database-helper.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { ADMIN_STATE, readFixture } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const holidays = hr.organization.holidays;
const flag = hr.smjene.offOnHolidays;

/**
 * Story 21.17: *Organizacija → Blagdani* and the team dialog's *Ne radi na
 * blagdane*. The run's organization is shared, so the spec works in a far
 * year (2031) no other spec reads, under the run's schedule lock
 * (`holdRotation`'s bounded lock: a holiday and the flag change what every
 * schedule derivation says on those dates), and `afterEach` removes every
 * holiday of the organization and sets every team's flag back
 * (`cleanUpHolidaysInSql`, 21.16) before the lock is released.
 *
 * It imports 2031's official list (14 dates, each with its official name),
 * sees it listed, imports again (nothing new: the button says so and offers
 * nothing), adds one by hand (no past-date warning) and is refused a second
 * on the same date, renames one, removes one, and switches the run's team off on
 * holidays and back, each through *Što se mijenja*. CI only: the shared local
 * stack lacks `0080`.
 */
const YEAR = 2031;

let hold: RotationHold | null = null;

test.beforeEach(async () => {
  hold = holdRotation(readFixture().slug);
  await hold.ready;
});

test.afterEach(async () => {
  try {
    await cleanUpHolidaysInSql(readFixture().slug);
  } finally {
    await hold?.release();
    hold = null;
  }
});

test('imports the official list once, renames and removes a holiday, and switches a team off on holidays and back', async ({
  organizationPage,
  teamsPage,
}) => {
  test.slow(); // the shared schedule lock, and a check over the year's holidays per write
  const fixture = readFixture();
  const region = organizationPage.holidaysRegion;

  // *Blagdani*: the far year, empty.
  await organizationPage.goto();
  await organizationPage.showHolidayYear(YEAR);
  await expect(region.getByText(fill(holidays.none, { year: String(YEAR) }), { exact: true })).toBeVisible();

  // The import: its preview lists every official name; its save inserts the 14.
  await organizationPage.holidayImport(YEAR).click();
  const preview = organizationPage.holidayPreview;

  await expect(preview).toBeVisible();
  await expect(preview.getByText(hr.organization.holidays.national.REMEMBRANCE_DAY, { exact: false })).toBeVisible();
  await preview.getByRole('button', { name: holidays.preview.importSave, exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(organizationPage.holidaysStatus).toHaveText(plural(holidays.imported, 14));
  for (const name of Object.values(hr.organization.holidays.national)) {
    await expect(region.getByText(name, { exact: true })).toBeVisible();
  }

  // Again: nothing new — the button says so and offers nothing.
  await expect(organizationPage.holidayImportNone(YEAR)).toBeDisabled();
  await expect(organizationPage.holidayImport(YEAR)).toHaveCount(0);

  // One by hand: no past-date warning for 2031, the preview, and the save.
  const own = 'Dan grada (E2E)';
  const ownDate = `${String(YEAR)}-03-03`;

  await organizationPage.holidayAdd.click();
  const add = organizationPage.holidayAddDialog;

  await add.getByLabel(holidays.date, { exact: true }).fill(ownDate);
  await add.getByLabel(holidays.name, { exact: true }).fill(own);
  await expect(add.getByText(holidays.pastWarning, { exact: true })).toHaveCount(0);
  await add.getByRole('button', { name: holidays.next, exact: true }).click();
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: holidays.preview.save, exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(organizationPage.holidaysStatus).toHaveText(holidays.added);
  await expect(region.getByText(own, { exact: true })).toBeVisible();

  // A second on the same date is refused in the dialog, before anything is sent.
  await organizationPage.holidayAdd.click();
  await add.getByLabel(holidays.date, { exact: true }).fill(ownDate);
  await add.getByLabel(holidays.name, { exact: true }).fill('Drugi (E2E)');
  await add.getByRole('button', { name: holidays.next, exact: true }).click();
  await expect(add.getByRole('alert')).toHaveText(holidays.error.taken);
  await expect(preview).toHaveCount(0);
  await add.getByRole('button', { name: holidays.cancel, exact: true }).click();
  await expect(add).toHaveCount(0);

  // A rename: the name alone, no check.
  const renamed = 'Božić (E2E)';

  await organizationPage.holidayRename(hr.organization.holidays.national.CHRISTMAS_DAY).click();
  const dialog = organizationPage.holidayRenameDialog;

  await dialog.getByLabel(holidays.name, { exact: true }).fill(renamed);
  await dialog.getByRole('button', { name: holidays.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(organizationPage.holidaysStatus).toHaveText(holidays.renamed);
  await expect(region.getByText(renamed, { exact: true })).toBeVisible();

  // A removal, through *Što se mijenja*.
  await organizationPage.holidayRemove(hr.organization.holidays.national.ST_STEPHENS_DAY).click();
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: holidays.preview.removeSave, exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(organizationPage.holidaysStatus).toHaveText(holidays.removed);
  await expect(region.getByText(hr.organization.holidays.national.ST_STEPHENS_DAY, { exact: true })).toHaveCount(0);
  // One date is missing again, so the import offers it.
  await expect(organizationPage.holidayImport(YEAR)).toBeEnabled();

  // The team dialog: off on holidays, then back, each through its preview.
  await teamsPage.goto();
  await teamsPage.openTeam(fixture.team.name);
  await expect(teamsPage.offOnHolidaysSwitch).not.toBeChecked();
  await teamsPage.offOnHolidaysSwitch.click();
  await expect(teamsPage.offOnHolidaysPreview).toBeVisible();
  await expect(teamsPage.offOnHolidaysPreview).toContainText(fill(flag.preview.ledeOn, { team: fixture.team.name }));
  await teamsPage.offOnHolidaysSave.click();
  await expect(teamsPage.offOnHolidaysStatus).toHaveText(flag.savedOn);
  await expect(teamsPage.offOnHolidaysSwitch).toBeChecked();

  await teamsPage.offOnHolidaysSwitch.click();
  await expect(teamsPage.offOnHolidaysPreview).toContainText(fill(flag.preview.ledeOff, { team: fixture.team.name }));
  await teamsPage.offOnHolidaysSave.click();
  await expect(teamsPage.offOnHolidaysStatus).toHaveText(flag.savedOff);
  await expect(teamsPage.offOnHolidaysSwitch).not.toBeChecked();
});
