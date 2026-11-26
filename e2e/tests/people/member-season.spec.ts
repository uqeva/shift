import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedTeamRotation,
  statusVersionsOfInSql,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 21.11: a seasonal member's season, set in one step from the member
 * page's status card (AD-26 *Seasons*, UX-DR76).
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today, with an active crew member on it and no leave. The
 * admin opens *Sezona*, enters a season from day 5 to day 9, sees the three
 * versions it writes (inactive from today, active from day 5, inactive from
 * day 10), saves them in ONE insert, sees both changes still ahead on the
 * card, and withdraws the latest (only it is cancellable). Everything written
 * — the member with their versions, the seed and the team — is removed in
 * the `afterEach` whatever happens.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const words = hr.ljudi.season;
const status = hr.ljudi.status;

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

  // The member first (their status versions cascade with them), then the seed and its pattern, then the team.
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

async function setUp(slug: string): Promise<{ readonly rotation: SeededRotation; readonly person: SeededLeaveMember }> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const person = await seedLeaveMember(slug, team.id, rotation.today, 20);
  own.members.push(person.id);

  return { rotation, person };
}

test('sets an active member\'s season in one step, and withdraws only its latest change', async ({ fixture, peoplePage }) => {
  test.slow();
  const { rotation, person } = await setUp(fixture.slug);
  const today = rotation.today;
  const start = addDays(today, 5);
  const end = addDays(today, 9);
  const after = addDays(today, 10);

  await peoplePage.gotoMember(person.id);
  await expect(peoplePage.statusCard).toContainText(status.active);

  // SEZONA: the dialog opens on the earliest start, and says what it writes as the dates are entered.
  await peoplePage.seasonButton(person.name).click();
  const dialog = peoplePage.seasonDialog;
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(words.start, { exact: true })).toHaveValue(today);
  await dialog.getByLabel(words.start, { exact: true }).fill(start);
  await dialog.getByLabel(words.end, { exact: true }).fill(end);
  for (const line of [
    fill(words.rowInactive, { date: fullDate(today) }),
    fill(words.rowActive, { date: fullDate(start) }),
    fill(words.rowInactive, { date: fullDate(after) }),
  ]) {
    // EXACT, per line: `aktivna od …` is a substring of `neaktivna od …`.
    await expect(dialog.getByRole('listitem').filter({ hasText: new RegExp(`^${escapeRegExp(line)}$`) })).toHaveCount(1);
  }
  expect(await statusVersionsOfInSql(fixture.slug, person.id)).toEqual([]);

  // SPREMI SEZONU: no leave, so nothing to erase; one insert of the three rows.
  await dialog.getByRole('button', { name: words.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(peoplePage.statusCard.getByRole('status')).toHaveText(words.saved);
  await expect.poll(() => statusVersionsOfInSql(fixture.slug, person.id)).toEqual([
    { active: false, effectiveFrom: today },
    { active: true, effectiveFrom: start },
    { active: false, effectiveFrom: after },
  ]);
  // BOTH CHANGES STILL AHEAD are on the card.
  await expect(peoplePage.statusCard).toContainText(fill(status.scheduledActive, { date: fullDate(start) }));
  await expect(peoplePage.statusCard).toContainText(fill(status.scheduledInactive, { date: fullDate(after) }));

  // ONLY THE LATEST IS CANCELLABLE: the withdrawal names the season's end.
  await peoplePage.statusWithdrawButton(person.name).click();
  await peoplePage.statusWithdrawConfirmButton(person.name).click();
  await expect.poll(() => statusVersionsOfInSql(fixture.slug, person.id)).toEqual([
    { active: false, effectiveFrom: today },
    { active: true, effectiveFrom: start },
  ]);
  await expect(peoplePage.statusCard).toContainText(fill(status.scheduledActive, { date: fullDate(start) }));
  await expect(peoplePage.statusCard).not.toContainText(fill(status.scheduledInactive, { date: fullDate(after) }));
});
