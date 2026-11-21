import { MEMBER_STATE, readFixture } from '../../utils/run-fixture.ts';
import {
  holdMemberEmailInSql,
  holdNotificationSettings,
  holdPushDevicesInSql,
  holdReminderSettingsInSql,
  reminderSettingsOf,
  restoreMemberEmailInSql,
  restorePushDevicesInSql,
  restoreReminderSettingsInSql,
  setEmailNotificationsInSql,
  type RotationHold,
} from '../../utils/database-helper.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 17.1: *Podsjetnici*, the third card on `/obavijesti`. A member turns
 * on at most two of six leads and the reminder email switch, each saved at
 * once, and reads the channel the reminders reach, or that none is available.
 * The member's address, their email row and their reminder row are set in SQL
 * for a case and restored after it, under the lock `settings.spec.ts` holds
 * too ({@link holdNotificationSettings}): both read the same member's facts.
 */

const copy = hr.reminders;
const lead = copy.lead;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

let settingsHold: RotationHold | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  // Waiting for the other holder may take a while.
  test.slow();
  settingsHold = holdNotificationSettings(readFixture().slug);
  await settingsHold.ready;
});

test.afterEach(async () => {
  await settingsHold?.release();
  settingsHold = null;
});

test.describe('a member on a phone', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE });

  test('never opened: all six off, the email switch off, and reminders are off', async ({ notificationsPage }) => {
    const fixture = readFixture();
    const held = await holdReminderSettingsInSql(fixture.slug, fixture.member.username);
    try {
      await notificationsPage.goto();
      await expect(notificationsPage.remindersSection).toBeVisible();
      await expect(notificationsPage.reminderSwitches).toHaveCount(7);
      for (const label of [lead.h1, lead.h2, lead.h3, lead.h6, lead.h12, lead.eveningBefore]) {
        await expect(notificationsPage.reminderLead(label)).not.toBeChecked();
      }
      await expect(notificationsPage.reminderEmail).not.toBeChecked();
      await expect(notificationsPage.reminderLine(copy.off)).toBeVisible();
    } finally {
      await restoreReminderSettingsInSql(held);
    }
  });

  test('turns on two leads, stores them in order, holds the other four, and keeps them across a reload', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const held = await holdReminderSettingsInSql(fixture.slug, fixture.member.username);
    try {
      await notificationsPage.goto();
      await notificationsPage.reminderLead(lead.eveningBefore).click();
      await expect(notificationsPage.savedLine(copy.saved)).toBeVisible();
      await notificationsPage.reminderLead(lead.h2).click();
      await expect(notificationsPage.reminderLead(lead.h2)).toBeChecked();
      await expect
        .poll(() => reminderSettingsOf(fixture.slug, fixture.member.username))
        .toEqual({ leads: ['H2', 'EVENING_BEFORE'], email: false });

      // Two on: the other four are held, and a line says so; a press does nothing.
      await expect(notificationsPage.reminderLine(copy.limit)).toBeVisible();
      for (const label of [lead.h1, lead.h3, lead.h6, lead.h12]) {
        await expect(notificationsPage.reminderLead(label)).toHaveAttribute('aria-disabled', 'true');
      }
      // Forced: Playwright waits for an `aria-disabled` switch to be enabled.
      await notificationsPage.reminderLead(lead.h1).click({ force: true });
      await expect(notificationsPage.reminderLead(lead.h1)).not.toBeChecked();
      expect(await reminderSettingsOf(fixture.slug, fixture.member.username)).toEqual({
        leads: ['H2', 'EVENING_BEFORE'],
        email: false,
      });

      await page.reload();
      await expect(notificationsPage.reminderLead(lead.h2)).toBeChecked();
      await expect(notificationsPage.reminderLead(lead.eveningBefore)).toBeChecked();
    } finally {
      await restoreReminderSettingsInSql(held);
    }
  });

  test('names email as the channel when it is reachable, and says why when there is no address', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    // Every fact the channel line reads, held: no device, no reminder row, an
    // address with no email row (email on), and the organization's switch on.
    const devices = await holdPushDevicesInSql(fixture.slug, fixture.member.username);
    const reminders = await holdReminderSettingsInSql(fixture.slug, fixture.member.username);
    const email = await holdMemberEmailInSql(fixture.slug, fixture.member.username, `${fixture.member.username}@example.org`);
    const organizationWas = await setEmailNotificationsInSql(fixture.slug, true);
    try {
      await notificationsPage.goto();
      await notificationsPage.reminderLead(lead.h3).click();
      await expect(notificationsPage.reminderLine(copy.channelNone)).toBeVisible();

      await notificationsPage.reminderEmail.click();
      await expect(notificationsPage.reminderEmail).toBeChecked();
      await expect(notificationsPage.reminderLine(copy.channelEmail)).toBeVisible();

      // E-pošta turned off in its own card, on the same page: the channel line
      // follows without a reload, and says why email is not sent.
      await notificationsPage.emailOff.click();
      await expect(notificationsPage.savedLine(hr.postavkeObavijesti.statusOff)).toBeVisible();
      await expect(notificationsPage.reminderLine(copy.channelNoneEmailOn)).toBeVisible();
      await expect(notificationsPage.reminderLine(copy.emailOff)).toBeVisible();

      // No address: email reminders are not sent, and the line says why.
      // (The first hold keeps what to restore; this one sets the address and
      // removes the email row again.)
      await holdMemberEmailInSql(fixture.slug, fixture.member.username, null);
      await page.reload();
      await expect(notificationsPage.reminderEmail).toBeChecked();
      await expect(notificationsPage.reminderLine(copy.emailNoAddress)).toBeVisible();
      await expect(notificationsPage.reminderLine(copy.channelNoneEmailOn)).toBeVisible();
    } finally {
      await setEmailNotificationsInSql(fixture.slug, organizationWas);
      await restoreMemberEmailInSql(email);
      await restoreReminderSettingsInSql(reminders);
      await restorePushDevicesInSql(devices);
    }
  });

  test('offline, every switch is gated: the note says why and a press sends nothing', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    const held = await holdReminderSettingsInSql(fixture.slug, fixture.member.username);
    try {
      await notificationsPage.goto();
      await expect(notificationsPage.reminderLead(lead.h1)).not.toBeChecked();
      await page.context().setOffline(true);

      await expect(notificationsPage.remindersSection.getByText(hr.offline.needsConnection, { exact: true })).toBeVisible();
      for (const label of [lead.h1, lead.h2, lead.h3, lead.h6, lead.h12, lead.eveningBefore]) {
        await expect(notificationsPage.reminderLead(label)).toHaveAttribute('aria-disabled', 'true');
      }
      await expect(notificationsPage.reminderEmail).toHaveAttribute('aria-disabled', 'true');
      // Pressed anyway: the gate refuses it.
      await notificationsPage.reminderLead(lead.h1).click({ force: true });
      await expect(notificationsPage.reminderLead(lead.h1)).not.toBeChecked();
      await page.context().setOffline(false);
      expect(await reminderSettingsOf(fixture.slug, fixture.member.username)).toBeNull();
    } finally {
      await page.context().setOffline(false);
      await restoreReminderSettingsInSql(held);
    }
  });

  test('a failed save says so and returns the switch to the stored value', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    const held = await holdReminderSettingsInSql(fixture.slug, fixture.member.username);
    try {
      // Every write to the reminders fails; the read still answers.
      await page.route('**/rest/v1/reminder_settings*', (route) =>
        route.request().method() === 'GET'
          ? route.continue()
          : route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"e2e"}' }),
      );
      await notificationsPage.goto();
      await notificationsPage.reminderLead(lead.h1).click();
      await expect(notificationsPage.reminderFailed).toBeVisible();
      await expect(notificationsPage.reminderLead(lead.h1)).not.toBeChecked();
      expect(await reminderSettingsOf(fixture.slug, fixture.member.username)).toBeNull();
    } finally {
      await page.unroute('**/rest/v1/reminder_settings*');
      await restoreReminderSettingsInSql(held);
    }
  });
});
