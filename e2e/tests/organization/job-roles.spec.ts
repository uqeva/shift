import { randomBytes } from 'node:crypto';

import { ADMIN_STATE, readFixture } from '../../utils/run-fixture.ts';
import { E2E_JOB_ROLE_PREFIX, cleanUpJobRolesInSql, jobRoleIdInSql } from '../../utils/database-helper.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { uniqueMember } from '../../utils/members.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const roles = hr.organization.jobRoles;

/**
 * Story 21.12: *Poslovi* on *Organizacija*, the member page's *Posao*, and
 * *Ljudi*'s role line and `?posao=` filter. The run's organization is shared:
 * every role this spec adds carries `E2E_JOB_ROLE_PREFIX` and a fresh suffix,
 * is given to a member this spec creates, and is removed in `afterAll`
 * (members set back to no role first). The member stays, as every member the
 * people specs create through *Dodaj osobu* does: the run's organization is
 * deleted at teardown, and no existing helper removes an unprefixed member.
 * CI only: the shared local stack lacks `0078`.
 */
test.describe.configure({ mode: 'serial' });

const added: string[] = [];

test.afterAll(async () => {
  await cleanUpJobRolesInSql(readFixture().slug, added);
});

test('adds a role, gives it to a member, and shows and filters it on Ljudi', async ({ organizationPage, peoplePage }) => {
  test.slow(); // a member create is a round trip through the Edge Function
  const fixture = readFixture();
  const name = `${E2E_JOB_ROLE_PREFIX} ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Posao');

  added.push(name);

  // *Poslovi*: add the role through its dialog.
  await organizationPage.goto();
  const region = organizationPage.jobRolesRegion;

  await organizationPage.jobRoleAdd.click();
  const dialog = organizationPage.jobRoleAddDialog;

  await organizationPage.jobRoleName(dialog).fill(name);
  await organizationPage.jobRoleSave(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(region.getByRole('status')).toHaveText(roles.added);
  await expect(region.getByText(name, { exact: true })).toBeVisible();

  // A member of this spec's own, so no other spec's list changes.
  await peoplePage.gotoNew();
  await peoplePage.submitNewMember(person.name, person.username);
  await peoplePage.closeAddDialog();

  // The member page: *Posao* in the basics dialog.
  await peoplePage.openMember(person.name);
  await peoplePage.editBasicsButton(person.name).click();
  await peoplePage.basicsDialog.getByLabel(hr.ljudi.jobRole.label, { exact: true }).selectOption({ label: name });
  await peoplePage.basicsSaveButton.click();
  await expect(peoplePage.basicsDialog).toHaveCount(0);
  await expect(peoplePage.basicsCard).toContainText(name);

  // *Ljudi*: the role under the name, and `?posao=` narrows to its holders.
  await peoplePage.goto();
  await expect(peoplePage.memberRow(person.name)).toContainText(name);

  const id = await jobRoleIdInSql(fixture.slug, name);

  if (id === null) throw new Error(`E2E: the role ${name} was not stored`);
  await peoplePage.goto(`?posao=${id}`);
  await expect(peoplePage.memberRow(person.name)).toBeVisible();
  await expect(peoplePage.table.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: fixture.admin.name }) })).toHaveCount(0);

  // *Poslovi*: archive the role (it now offers *Vrati*), then restore it.
  await organizationPage.goto();
  await organizationPage.jobRoleArchive(name).click();
  await expect(region.getByRole('status')).toHaveText(roles.archivedDone);
  await expect(organizationPage.jobRoleRestore(name)).toBeVisible();
  await organizationPage.jobRoleRestore(name).click();
  await expect(region.getByRole('status')).toHaveText(roles.restoredDone);
  await expect(organizationPage.jobRoleArchive(name)).toBeVisible();
});
