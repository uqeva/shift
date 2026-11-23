import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import type { LoginPage } from '../../pages/login.page.ts';
import { connect } from '../../utils/database-helper.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 19.2 (UX-DR62–64, AD-21, AD-22), and story 19.3 (UX-DR66, AD-23, C8):
 * the signup screens and step 1 of `/postavljanje` on the local
 * stack, whose door is open (`config.toml`, `seed.sql`) and whose dev server
 * is built with `VITE_SIGNUP_ENABLED=true` (`scripts/ci/write-local-env.mjs`).
 *
 * Signed out throughout. One real signup is sent, to a fresh address the mail
 * catcher receives; everything else is refused on the page, with no request,
 * or presses a link that was never issued. Written unrun: CI is its first run.
 */

test('bare Prijava offers a new organization, and an organization’s own link never does', async ({ page, loginPage, fixture }) => {
  await loginPage.goto();
  await expect(loginPage.registerLink).toBeVisible();

  await page.goto(`/prijava/${fixture.slug}`);
  await expect(loginPage.usernameInput).toBeVisible();
  await expect(loginPage.registerLink).toHaveCount(0);
});

test('an address in the entry dims the organization and signs in by email alone', async ({ loginPage }) => {
  await loginPage.goto();
  await expect(loginPage.organizationInput).toHaveAttribute('placeholder', hr.auth.organization.placeholder);

  await loginPage.usernameInput.fill('ana@example.com');
  await expect(loginPage.organizationInput).toHaveAttribute('aria-disabled', 'true');
  await expect(loginPage.emailOrganizationHint).toHaveText(hr.signup.signIn.organizationHint);

  await loginPage.passwordInput.fill(`wrong-${randomUUID()}`);
  await loginPage.submitButton.click();
  await expect(loginPage.alert).toHaveText(hr.signup.signIn.error);
});

test('Zaboravljena lozinka? offers the email path first and keeps the administrator’s text', async ({ page, loginPage }) => {
  await loginPage.goto();
  await loginPage.forgotButton.click();

  await expect(loginPage.forgotPanel).toContainText(hr.signup.forgot.emailHeading);
  await expect(loginPage.forgotPanel).toContainText(hr.auth.forgot.body);
  await loginPage.recoverByEmailLink.click();
  await expect(page).toHaveURL('/zaboravljena-lozinka');
  await expect(loginPage.heading(hr.signup.recover.heading)).toBeVisible();

  await loginPage.signupEmailInput.fill('ivan.maric');
  await loginPage.recoverButton.click();
  await expect(loginPage.alert).toHaveText(hr.signup.recover.error.address);
});

test('Registracija refuses a malformed address and a short password on the page, keeping both', async ({ page, loginPage }) => {
  await page.goto('/registracija');
  await expect(loginPage.heading(hr.signup.heading)).toBeVisible();
  await expect(loginPage.memberCallout).toBeVisible();

  await loginPage.signupEmailInput.fill('ana.example.com');
  await loginPage.signupPasswordInput.fill('kratko');
  await loginPage.signupButton.click();

  await expect(loginPage.alert).toContainText(hr.signup.form.error.address);
  await expect(loginPage.alert).toContainText(hr.signup.form.error.password);
  await expect(loginPage.signupEmailInput).toHaveValue('ana.example.com');
  await expect(page).toHaveURL('/registracija');
});

test('a valid signup lands on the one neutral screen, with the resend throttled', async ({ page, loginPage }) => {
  const address = `e2e-signup-${randomUUID()}@example.com`;
  await page.goto('/registracija');
  await loginPage.signupEmailInput.fill(address);
  await loginPage.signupPasswordInput.fill(`e2e-${randomUUID()}`);
  await loginPage.signupButton.click();

  await expect(loginPage.heading(hr.signup.sent.heading)).toBeVisible();
  await expect(loginPage.sentBody).toBeVisible();
  await expect(loginPage.sentAddress(address)).toBeVisible();
  await expect(loginPage.resendWaiting).toHaveAttribute('aria-disabled', 'true');

  await loginPage.correctAddressButton.click();
  await expect(loginPage.signupEmailInput).toHaveValue(address);
});

test('Potvrda sends nothing on load, and a dead link names no address', async ({ page, loginPage }) => {
  // Every verify, with or without a query (a GET `…/verify?token=…` too), and
  // how it was sent. A preflight is not a verify.
  const verifies: { method: string; body: string }[] = [];
  await page.route(/\/auth\/v1\/verify(\?|$)/, async (route) => {
    const request = route.request();
    if (request.method() !== 'OPTIONS') verifies.push({ method: request.method(), body: request.postData() ?? '' });
    await route.continue();
  });

  const tokenHash = '0'.repeat(56);
  await page.goto(`/potvrda?token_hash=${tokenHash}&type=signup`);
  await expect(loginPage.confirmButton).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(verifies, 'the page verified on load').toEqual([]);
  // The token left the address bar and the history entry once read (security review of 19.2).
  expect(page.url()).not.toContain('token_hash');

  // STORY 19.3 (C8): a signup's link is the password form; its one press
  // verifies, then saves. A form the page refuses sends nothing.
  await loginPage.confirmButton.click();
  expect(verifies, 'an empty password form verified').toEqual([]);
  const chosen = `e2e-${randomUUID()}`;
  await loginPage.linkPasswordInput.fill(chosen);
  await loginPage.linkRepeatInput.fill(chosen);
  await loginPage.confirmButton.click();
  await expect(loginPage.heading(hr.signup.dead.heading)).toBeVisible();
  // D2 (review 2 of 19.3): a dead SIGNUP link offers recovery, the way back
  // for an account confirmed with no password yet.
  await expect(loginPage.deadLinkRecoverLink).toBeVisible();
  expect(verifies).toHaveLength(1);
  expect(verifies[0]?.method).toBe('POST');
  expect(verifies[0]?.body).toContain(tokenHash);

  await page.goto('/potvrda');
  await expect(loginPage.heading(hr.signup.dead.heading)).toBeVisible();
});

/** The CLI's mail catcher (`[local_smtp]` in `config.toml`), Mailpit's API. */
const MAIL_CATCHER = 'http://127.0.0.1:54324';

/** The `/potvrda` link of type `type` in a mail to `address`, once one arrives. */
async function linkMailedTo(address: string, type: 'signup' | 'recovery' = 'signup'): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(`${MAIL_CATCHER}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    const found = (await search.json()) as { messages?: { ID: string }[] };
    for (const { ID } of found.messages ?? []) {
      const message = (await (await fetch(`${MAIL_CATCHER}/api/v1/message/${ID}`)).json()) as { HTML?: string };
      const link = new RegExp(`/potvrda\\?token_hash=([0-9a-f]+)&amp;type=${type}`).exec(message.HTML ?? '');
      if (link !== null) return `/potvrda?token_hash=${link[1] ?? ''}&type=${type}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no ${type} mail reached the catcher for ${address}`);
}

/**
 * The account, its organization (if it founded one) and their rows, as the
 * owner. BEST-EFFORT, in foreign-key order (review of 19.3): the organization
 * cascades its members and scoped rows (0002's zero-admins constraint trigger
 * lets a member go with its organization), the attempts have no foreign key,
 * the account goes last. A failing step is logged and never masks the test's
 * own failure.
 */
async function removeSignup(address: string): Promise<void> {
  let client;
  try {
    client = await connect();
  } catch (cause) {
    console.error('signup cleanup: no connection', cause);
    return;
  }
  const account = 'select id from auth.users where lower(email) = lower($1)';
  for (const [sql, label] of [
    [`delete from public.organizations where founded_by in (${account})`, 'organization'],
    [`delete from private.organization_attempts where auth_user_id in (${account})`, 'attempts'],
    ['delete from auth.users where lower(email) = lower($1)', 'account'],
  ] as const) {
    try {
      await client.query(sql, [address]);
    } catch (cause) {
      console.error(`signup cleanup (${label})`, cause);
    }
  }
  await client.end().catch(() => undefined);
}

/** Signs `address` up, opens the mailed link and sets a password on it: lands on step 1. */
async function signUpAndConfirm(page: Page, loginPage: LoginPage, address: string): Promise<void> {
  await page.goto('/registracija');
  await loginPage.signupEmailInput.fill(address);
  // GoTrue requires a password at signup; confirmation forgets it (C8).
  await loginPage.signupPasswordInput.fill(`e2e-${randomUUID()}`);
  await loginPage.signupButton.click();
  await expect(loginPage.heading(hr.signup.sent.heading)).toBeVisible();

  await page.goto(await linkMailedTo(address));
  await loginPage.setPasswordOnLink(`e2e-${randomUUID()}`);
  await expect(loginPage.heading(hr.signup.setup.heading)).toBeVisible();
}

test('a mailed signup link sets the password, and step 1 founds the organization (story 19.3)', async ({ page, loginPage, hourBandsPage }) => {
  const address = `e2e-found-${randomUUID()}@example.com`;
  const { setup } = hr.signup;
  try {
    await signUpAndConfirm(page, loginPage, address);

    // Step 1: no app shell, the signed-in address named (C9), nothing pre-filled.
    await expect(page).toHaveURL(/\/postavljanje/);
    await expect(loginPage.text(hr.signup.confirm.confirmed)).toBeVisible();
    await expect(loginPage.text(fill(setup.signedInAs, { email: address }))).toBeVisible();
    await expect(loginPage.navigation).toHaveCount(0);
    for (const label of [setup.name, setup.slug, setup.type, setup.adminName, setup.allowance, setup.leaveDay, setup.leaveMonth]) {
      await expect(loginPage.setupField(label)).toHaveValue('');
    }

    // Refused on the page, with nothing sent.
    await loginPage.setupSubmit.click();
    await expect(loginPage.alert).toContainText(setup.error.name);
    await expect(loginPage.alert).toContainText(setup.error.timezone);

    // The slug follows the name until it is edited.
    await loginPage.setupField(setup.name).fill('Tvrtka Primjer');
    await expect(loginPage.setupField(setup.slug)).toHaveValue('tvrtka-primjer');

    await loginPage.fillSetup({ name: 'Tvrtka Primjer', slug: `e2e-${randomUUID().slice(0, 8)}` });
    await loginPage.setupSubmit.click();

    // ORGANIZATION_CREATED: refreshed, claimed, and on setup's step 2 (story
    // 19.4, D2): the rail says where setup is, and nothing is set yet.
    await expect(page).toHaveURL('/postavljanje/satni-pojasi');
    await expect(loginPage.heading(hr.onboarding.step.hourBands)).toBeVisible();
    await expect(loginPage.setupSkipLink).toBeVisible();

    // Out of setup, to Danas, where the card resumes it: five steps left.
    await loginPage.setupExitLink.click();
    await expect(page).toHaveURL('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();
    await expect(loginPage.onboardingCardTitle(plural(hr.onboarding.card.title, 5))).toBeVisible();

    // Back to step 2 from the card; one band is the fact: the rail says
    // *postavljeno*, the forward control *Dalje: Smjene*, the card one fewer.
    await loginPage.onboardingCardLink(hr.onboarding.step.hourBands).click();
    await expect(page).toHaveURL('/postavljanje/satni-pojasi');
    await hourBandsPage.addBand('Jutro', '06:00');
    await expect(loginPage.setupRailStep(hr.onboarding.step.hourBands, hr.onboarding.state.set)).toBeVisible();
    await expect(loginPage.setupNextLink(hr.onboarding.step.teams)).toBeVisible();
    await loginPage.setupExitLink.click();
    await expect(loginPage.onboardingCardTitle(plural(hr.onboarding.card.title, 4))).toBeVisible();

    // Sakrij, confirmed: the card is gone, and stays gone after a reload.
    await loginPage.onboardingHideButton.click();
    await loginPage.onboardingConfirmHide.click();
    await expect(loginPage.onboardingCardTitle(plural(hr.onboarding.card.title, 4))).toHaveCount(0);
    await page.reload();
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();
    await expect(loginPage.onboardingCardTitle(plural(hr.onboarding.card.title, 4))).toHaveCount(0);
  } finally {
    await removeSignup(address);
  }
});

test('a taken slug is answered with a proposal, and the typed slug is kept (story 19.3, B6)', async ({ page, loginPage, fixture }) => {
  const address = `e2e-taken-${randomUUID()}@example.com`;
  const { setup } = hr.signup;
  try {
    await signUpAndConfirm(page, loginPage, address);
    await loginPage.fillSetup({ name: 'Tvrtka Primjer', slug: fixture.slug });
    await loginPage.setupSubmit.click();

    await expect(loginPage.text(setup.slugUnavailable.split('{proposal}')[0] ?? '', { exact: false })).toBeVisible();
    await expect(loginPage.setupField(setup.slug)).toHaveValue(fixture.slug);
    await loginPage.setupUseProposal.click();
    await expect(loginPage.setupField(setup.slug)).not.toHaveValue(fixture.slug);
  } finally {
    await removeSignup(address);
  }
});

test('an unconfirmed sign-in is offered a new link, which lands on the neutral screen (story 19.3)', async ({ page, loginPage }) => {
  const address = `e2e-unconfirmed-${randomUUID()}@example.com`;
  const signupPassword = `e2e-${randomUUID()}`;
  try {
    await page.goto('/registracija');
    await loginPage.signupEmailInput.fill(address);
    await loginPage.signupPasswordInput.fill(signupPassword);
    await loginPage.signupButton.click();
    await expect(loginPage.heading(hr.signup.sent.heading)).toBeVisible();

    await loginPage.goto();
    await loginPage.usernameInput.fill(address);
    await loginPage.passwordInput.fill(signupPassword);
    await loginPage.submitButton.click();
    await expect(loginPage.heading(hr.signup.unconfirmed.heading)).toBeVisible();
    await loginPage.unconfirmedResendButton.click();
    await expect(loginPage.heading(hr.signup.sent.heading)).toBeVisible();
  } finally {
    await removeSignup(address);
  }
});

test('a recovery link sets a new password through its own form (story 19.3)', async ({ page, loginPage }) => {
  const address = `e2e-recovery-${randomUUID()}@example.com`;
  try {
    await signUpAndConfirm(page, loginPage, address);
    // Signed out on this device: the stored session goes with the storage.
    await page.evaluate(() => {
      window.localStorage.clear();
    });

    await page.goto('/zaboravljena-lozinka');
    await loginPage.signupEmailInput.fill(address);
    await loginPage.recoverButton.click();
    await expect(loginPage.text(hr.signup.recover.sent)).toBeVisible();

    const link = await linkMailedTo(address, 'recovery');
    expect(link).toContain('type=recovery');
    await page.goto(link);
    await expect(loginPage.heading(hr.signup.recovery.heading)).toBeVisible();
    await loginPage.setPasswordOnLink(`e2e-${randomUUID()}`, 'recovery');
    // A confirmed, claimless email identity continues to step 1.
    await expect(loginPage.heading(hr.signup.setup.heading)).toBeVisible();
  } finally {
    await removeSignup(address);
  }
});

test('a deep link opened before founding is where founding lands (story 19.3, D7)', async ({ page, loginPage }) => {
  const address = `e2e-deep-${randomUUID()}@example.com`;
  try {
    await signUpAndConfirm(page, loginPage, address);

    // The claimless founder opens a destination: the app's guard sends it to
    // step 1, carrying the location.
    await page.goto('/kalendar');
    await expect(page).toHaveURL(/\/postavljanje\?povratak=%2Fkalendar/);
    await expect(loginPage.heading(hr.signup.setup.heading)).toBeVisible();

    await loginPage.fillSetup({ name: 'Tvrtka Primjer', slug: `e2e-${randomUUID().slice(0, 8)}` });
    await loginPage.setupSubmit.click();
    await expect(page).toHaveURL('/kalendar');
  } finally {
    await removeSignup(address);
  }
});
