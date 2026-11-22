import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import {
  API_URL,
  APP_ORIGIN,
  addPushDeviceInSql,
  armRemindInVault,
  disarmRemindInVault,
  functionsEnvValue,
  holdMemberEmailInSql,
  holdNotificationSettings,
  holdPushDevicesInSql,
  holdReminderSettingsInSql,
  holdRotation,
  invokeRemindAsTheCronDoes,
  memberIdOf,
  organizationInstant,
  removePushEndpointInSql,
  removeSeededRotation,
  removeShiftRemindersInSql,
  restoreMemberEmailInSql,
  restorePushDevicesInSql,
  restoreReminderSettingsInSql,
  seedTeamRotation,
  setEmailNotificationsInSql,
  shiftRemindersOfInSql,
  type ArmedRemind,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays } from '../../utils/dates.ts';
import { hr } from '../../utils/i18n.ts';
import { MEMBER_STATE, readFixture } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';
import {
  INPUTS_RPC,
  REMIND_RAN,
  createHandler as createRemindHandler,
  readConfiguration as readRemindConfiguration,
} from '../../../supabase/functions/remind/handler.ts';
import { REMINDER_CODE, render, renderPush } from '../../../supabase/functions/notify/messages.ts';

/**
 * Story 17.3: a reminder reaches the member, end to end over the run's real
 * database and gateway.
 *
 * 1. THE ARMED PATH (17.2's deferred proof). The local Vault is armed as
 *    DEPLOY.md §3b arms a deployed one: `remind_url` is the gateway as the
 *    database container reaches it, `remind_invoke_secret` the served
 *    function's own (`supabase/functions/.env`, written fresh by
 *    `write-local-env`). `select private.invoke_remind()`, the cron job's own
 *    statement, must be answered 200 `REMIND_RAN` in pg_net's log: a 401
 *    means the two secrets drifted, a 503 that the read did not reach the
 *    database. Vault is disarmed again at once.
 *
 * 2. ONE LEAD, ON A FAKE CLOCK. `remind`'s clock is the database's (17.2),
 *    so its own `createHandler` runs here, over the real gateway, with only
 *    the read's `now` replaced by the due instant and its members narrowed to
 *    the test member (nobody else is written on a fake clock). The member
 *    turns on `1 h prije` and email reminders on *Podsjetnici*; the team's
 *    seeded rotation makes tomorrow a `Noć` from 19:00, so the H1 reminder is
 *    due tomorrow at 18:00. Two runs leave exactly one row per channel, each
 *    rendered by `notify`'s own renderer, and the push's link opens that day.
 *    With the lead off, a run writes nothing. Nothing is posted to Resend or
 *    a push service: CI holds no key for either; the send is Vitest's
 *    (`test/notify-reminder.test.ts`).
 *
 * Held under the notification settings lock (`reminders.spec.ts` and
 * `settings.spec.ts` read the same member's facts) and, for the seeded
 * rotation, the run's rotation lock.
 */

const copy = hr.reminders;
const lead = copy.lead;

/** The gateway as the database container reaches it on the CLI stack's network (DEPLOY.md §1, §3b). */
const LOCAL_REMIND_URL = process.env['SHIFT_E2E_REMIND_URL'] || 'http://supabase_kong_shift:8000/functions/v1/remind';

test.use({ storageState: MEMBER_STATE, viewport: { width: 1280, height: 900 } });
test.describe.configure({ mode: 'serial' });

let settingsHold: RotationHold | null = null;

test.beforeEach(async () => {
  // Waiting for the other holders may take a while.
  test.slow();
  settingsHold = holdNotificationSettings(readFixture().slug);
  await settingsHold.ready;
});

test.afterEach(async () => {
  await settingsHold?.release();
  settingsHold = null;
});

/** Neither the page nor the card scrolls sideways (17.1's deferred layout check, on the live screen). */
async function expectNoSidewaysScroll(page: Page, card: Locator): Promise<void> {
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  const cardOverflow = await card.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(cardOverflow, 'the Podsjetnici card scrolls sideways').toBeLessThanOrEqual(0);
}

/**
 * `remind`'s own handler, run here on a fake clock: the real read and write
 * through the gateway with the secret key, the read's `now` set to `now` and
 * its members narrowed to `memberId`. Its invoke secret is a fresh one of its
 * own, never Vault's.
 */
function remindOnAFakeClock(now: number, memberId: string): () => Promise<{ status: number; body: Record<string, unknown> }> {
  const invokeSecret = randomBytes(32).toString('hex');
  const environment: Readonly<Record<string, string>> = {
    SUPABASE_URL: API_URL,
    SHIFT_SECRET_KEY: functionsEnvValue('SHIFT_SECRET_KEY'),
    REMIND_INVOKE_SECRET: invokeSecret,
  };
  const handle = createRemindHandler(readRemindConfiguration((name) => environment[name]), {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (!input.endsWith(`/rest/v1/rpc/${INPUTS_RPC}`) || response.status !== 200) return response;
      const answer = (await response.json()) as { members?: unknown };
      const members = (Array.isArray(answer.members) ? answer.members : []).filter(
        (member) => (member as { memberId?: unknown } | null)?.memberId === memberId,
      );
      return new Response(JSON.stringify({ ...answer, now, members }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    timeout: (milliseconds) => AbortSignal.timeout(milliseconds),
    log: () => undefined,
  });
  return async () => {
    const response = await handle(
      new Request('http://localhost/functions/v1/remind', { method: 'POST', headers: { Authorization: `Bearer ${invokeSecret}` } }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

test('the cron job’s own call reaches remind through the armed Vault and is answered REMIND_RAN', async () => {
  const fixture = readFixture();
  // Nobody of the run has a lead on, so the real clock writes nothing.
  const reminders = await holdReminderSettingsInSql(fixture.slug, fixture.member.username);
  let armed: ArmedRemind | null = null;
  try {
    armed = await armRemindInVault(LOCAL_REMIND_URL, functionsEnvValue('REMIND_INVOKE_SECRET'));
    const answer = await invokeRemindAsTheCronDoes();
    expect(answer, 'pg_net recorded no answer to the cron call').not.toBeNull();
    // 401: Vault's remind_invoke_secret is not the served function's. 503: the read failed.
    expect(answer?.status, answer?.body ?? '').toBe(200);
    expect(JSON.parse(answer?.body ?? '{}')).toMatchObject({ code: REMIND_RAN });
  } finally {
    if (armed !== null) await disarmRemindInVault(armed);
    await restoreReminderSettingsInSql(reminders);
  }
});

test('one lead on: exactly one reminder per channel on a fake clock, each opening its day; with it off, none', async ({
  page,
  notificationsPage,
  calendarPage,
}) => {
  const fixture = readFixture();
  const rotationHold = holdRotation(fixture.slug);
  await rotationHold.ready;
  const devices = await holdPushDevicesInSql(fixture.slug, fixture.member.username);
  const reminders = await holdReminderSettingsInSql(fixture.slug, fixture.member.username);
  const email = await holdMemberEmailInSql(fixture.slug, fixture.member.username, `${fixture.member.username}@example.org`);
  const organizationWas = await setEmailNotificationsInSql(fixture.slug, true);
  let endpoint: string | null = null;
  let seed: SeededRotation | null = null;
  try {
    await removeShiftRemindersInSql(fixture.slug, fixture.member.username);
    endpoint = await addPushDeviceInSql(fixture.slug, fixture.member.username);
    // From today `[Dan, Noć, Slobodno, Slobodno]`: tomorrow is a Noć, 19:00–07:00.
    seed = await seedTeamRotation(fixture.slug, fixture.team.id, `P${randomBytes(3).toString('hex')}`);
    const tomorrow = addDays(seed.today, 1);
    const night = seed.steps[1];
    const dueAt = (await organizationInstant(fixture.slug, tomorrow, '18:00')).getTime();
    const memberId = await memberIdOf(fixture.slug, fixture.member.username);

    // The member asks, on the live screen: 1 h before, by email too.
    await notificationsPage.goto();
    await notificationsPage.reminderLead(lead.h1).click();
    await expect(notificationsPage.savedLine(copy.saved)).toBeVisible();
    await notificationsPage.reminderEmail.click();
    await expect(notificationsPage.reminderEmail).toBeChecked();
    await expect(notificationsPage.reminderLine(copy.channelBoth)).toBeVisible();
    await expectNoSidewaysScroll(page, notificationsPage.remindersSection);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoSidewaysScroll(page, notificationsPage.remindersSection);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Two runs at the due instant: the second writes nothing new (Q25).
    const run = remindOnAFakeClock(dueAt, memberId);
    for (const attempt of [1, 2]) {
      const answer = await run();
      expect(answer.status, `run ${String(attempt)}`).toBe(200);
      expect(answer.body, `run ${String(attempt)}`).toMatchObject({ code: REMIND_RAN, members: 1, due: 1, accepted: 1 });
    }
    const rows = await shiftRemindersOfInSql(fixture.slug, fixture.member.username);
    expect(rows.map((row) => `${String(row.operands['lead'])} ${String(row.operands['date'])} ${row.channel}`)).toEqual([
      `H1 ${tomorrow} email`,
      `H1 ${tomorrow} push`,
    ]);

    // Each renders as notify sends it: the shift, both times, the team, and the day.
    const subject = `Za 1 h radiš: ${night} 19:00–07:00, ${fixture.team.name}`;
    const day = `/kalendar?mjesec=${tomorrow.slice(0, 7)}&dan=${tomorrow}&danSmjena=${fixture.team.id}`;
    const [emailRow, pushRow] = rows;
    if (emailRow === undefined || pushRow === undefined) throw new Error('E2E: the two reminder rows are missing');
    const target = { appUrl: APP_ORIGIN, slug: emailRow.slug, organizationName: emailRow.organizationName };
    const mail = render(REMINDER_CODE, emailRow.locale, emailRow.operands, target);
    expect(mail).toMatchObject({ ok: true, subject });
    expect(mail.ok && mail.text).toContain(`povratak=${encodeURIComponent(day)}`);
    expect(mail.ok && mail.text).toContain(copy.notice.footer.replace(': {link}', ''));
    const push = renderPush(REMINDER_CODE, pushRow.locale, pushRow.operands, target);
    if (!push.ok) throw new Error(`E2E: the push did not render (${push.code})`);
    expect(push.title).toBe(subject);

    // One tap shows the shift: the push's path, signed in, lands on that day.
    await page.goto(push.url);
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return [url.pathname, url.searchParams.get('mjesec'), url.searchParams.get('dan'), url.searchParams.get('danSmjena')];
      })
      .toEqual(['/kalendar', tomorrow.slice(0, 7), tomorrow, fixture.team.id]);
    const detail = calendarPage.detailOf(fixture.team.name, tomorrow);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(night);

    // With the lead off, the same clock writes nothing.
    await removeShiftRemindersInSql(fixture.slug, fixture.member.username);
    await notificationsPage.goto();
    await notificationsPage.reminderLead(lead.h1).click();
    await expect(notificationsPage.reminderLine(copy.off)).toBeVisible();
    await expectNoSidewaysScroll(page, notificationsPage.remindersSection);
    const off = await run();
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ code: REMIND_RAN, members: 0, due: 0 });
    expect(await shiftRemindersOfInSql(fixture.slug, fixture.member.username)).toEqual([]);
  } finally {
    await removeShiftRemindersInSql(fixture.slug, fixture.member.username);
    if (seed !== null) await removeSeededRotation(seed);
    if (endpoint !== null) await removePushEndpointInSql(endpoint);
    await setEmailNotificationsInSql(fixture.slug, organizationWas);
    await restoreMemberEmailInSql(email);
    await restoreReminderSettingsInSql(reminders);
    await restorePushDevicesInSql(devices);
    await rotationHold.release();
  }
});
