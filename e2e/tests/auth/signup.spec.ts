import { randomUUID } from 'node:crypto';

import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 19.2 (UX-DR62–64, AD-21, AD-22): the signup screens on the local
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

  await loginPage.confirmButton.click();
  await expect(loginPage.heading(hr.signup.dead.heading)).toBeVisible();
  expect(verifies).toHaveLength(1);
  expect(verifies[0]?.method).toBe('POST');
  expect(verifies[0]?.body).toContain(tokenHash);

  await page.goto('/potvrda');
  await expect(loginPage.heading(hr.signup.dead.heading)).toBeVisible();
});
