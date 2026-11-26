import { randomBytes } from 'node:crypto';

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
import { addDays, fullDate } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 21.10: *Raspored osobe* on the member page, end to end (UX-DR75).
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`), with a crew member
 * on it. The admin gives the member a rotation of their own from tomorrow on
 * that pattern (*Osobna rotacija*), sees *Što se mijenja*, saves one
 * `member_schedule_versions` row, is refused a repeat of the source in force,
 * and cancels the scheduled version (*Povuci*). Everything written — the
 * member with their versions, the seed and the team — is removed in the
 * `afterEach` whatever happens (the seed's removal deletes a version naming
 * its pattern first).
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const words = hr.rasporedOsobe;

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

  // The member first (their versions and notices with them), then the seed and its pattern, then the team.
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
  readonly rotation: SeededRotation;
  readonly person: SeededLeaveMember;
}

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
  const person = await seedLeaveMember(slug, team.id, rotation.today, 20);
  own.members.push(person.id);

  return { rotation, person };
}

test('gives a member their own rotation from tomorrow, refuses a repeat, and cancels the scheduled version', async ({
  fixture,
  peoplePage,
}) => {
  test.slow();
  const { rotation, person } = await setUp(fixture.slug);
  const [dan, noc, slobodno] = rotation.steps;
  const tomorrow = addDays(rotation.today, 1);
  const pattern = [
    fill(words.run, { type: dan, count: '1' }),
    fill(words.run, { type: noc, count: '1' }),
    fill(words.run, { type: slobodno, count: '2' }),
  ].join(words.runSeparator);

  await peoplePage.gotoMember(person.id);
  const card = peoplePage.scheduleSourceCard;
  await expect(card).toContainText(fill(words.now, { fact: words.source.team }));

  // OSOBNA ROTACIJA from tomorrow on the seeded pattern, from its second step.
  await card.getByRole('button', { name: words.change, exact: true }).click();
  const form = peoplePage.scheduleSourceDialog;
  await expect(form).toBeVisible();
  await form.getByRole('radio', { name: new RegExp(`^${escapeRegExp(words.source.personal)}`) }).click();
  await form.getByLabel(words.from, { exact: true }).fill(tomorrow);
  await form.getByLabel(words.pattern, { exact: true }).selectOption({ label: pattern });
  await form.getByLabel(words.start, { exact: true }).selectOption({ label: fill(words.startOption, { day: '2', name: noc }) });
  await form.getByRole('button', { name: words.next, exact: true }).click();

  // ŠTO SE MIJENJA: nothing written until *Spremi*.
  const preview = peoplePage.scheduleSourcePreview;
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(fill(words.preview.ledeSet, { date: fullDate(tomorrow), source: words.source.personal }));
  expect(await scheduleVersionsOfInSql(fixture.slug, person.id)).toEqual([]);
  await preview.getByRole('button', { name: words.preview.save, exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(card.getByRole('status')).toHaveText(words.savedSet);
  await expect.poll(() => scheduleVersionsOfInSql(fixture.slug, person.id)).toEqual([
    expect.objectContaining({ effectiveFrom: tomorrow, source: 'PERSONAL', patternId: rotation.patternId }),
  ]);
  // The card says the scheduled version: its source and its date.
  await expect(card).toContainText(
    fill(words.scheduled, { fact: fill(words.since, { source: words.source.personal, date: fullDate(tomorrow) }) }),
  );

  // A SECOND CHANGE WHILE ONE IS SCHEDULED: refused in the form, nothing written.
  await card.getByRole('button', { name: words.change, exact: true }).click();
  await expect(form).toBeVisible();
  await form.getByRole('radio', { name: new RegExp(`^${escapeRegExp(words.source.manual)}`) }).click();
  await form.getByLabel(words.from, { exact: true }).fill(addDays(rotation.today, 5));
  await form.getByRole('button', { name: words.next, exact: true }).click();
  await expect(form.getByRole('alert')).toContainText(words.error.scheduled);
  await form.getByRole('button', { name: words.dismiss, exact: true }).click();
  await expect(form).toHaveCount(0);

  // POVUCI: the scheduled version's cancel, through its own *Što se mijenja*.
  await card.getByRole('button', { name: fill(words.cancelNamed, { date: fullDate(tomorrow) }), exact: true }).click();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(fill(words.preview.ledeCancel, { date: fullDate(tomorrow) }));
  await preview.getByRole('button', { name: words.preview.cancelSave, exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(card.getByRole('status')).toHaveText(words.savedCancel);
  await expect.poll(() => scheduleVersionsOfInSql(fixture.slug, person.id)).toEqual([]);
  await expect(card).toContainText(fill(words.now, { fact: words.source.team }));
});
