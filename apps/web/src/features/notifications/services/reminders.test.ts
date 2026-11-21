import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  REMINDER_SETTINGS_REFUSED,
  REMINDER_SETTINGS_UNAVAILABLE,
  REMINDERS_CONTROL,
  REMINDERS_LOADING,
  REMINDERS_UNAVAILABLE,
  channelMessageKey,
  emailUnreachableMessageKey,
  leadHeld,
  leadMessageKey,
  readReminderChannels,
  readReminderSettings,
  reminderChannelsOf,
  reminderChoiceOf,
  remindersViewOf,
  toggledLeads,
  writeReminderSettings,
  type ReminderBackend,
} from '@/features/notifications/services/reminders';
import type { OneKeyTable, SettingsTable } from '@/features/notifications/services/settings';
import hr from '@/lib/i18n/locales/hr.json';

const MEMBER = { id: 'member-1', organization_id: 'organization-1', email: 'ana@example.org', role: 'member_role' };
const OWN = { memberId: 'member-1', organizationId: 'organization-1' };

interface Answer {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

const rows = (...data: unknown[]): Answer => ({ data, error: null });
const failure = (code: string): Answer => ({ data: null, error: { code, message: code } });

function oneKey(answer: Answer): OneKeyTable {
  return { select: () => ({ eq: () => ({ limit: () => Promise.resolve(answer) }) }) };
}

function settingsTable(
  read: Answer,
  writes: { update?: Answer[]; insert?: Answer[] } = {},
  log: { updated: unknown[]; inserted: unknown[] } = { updated: [], inserted: [] },
): SettingsTable {
  const updates = [...(writes.update ?? [])];
  const inserts = [...(writes.insert ?? [])];
  return {
    select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve(read) }) }) }),
    update: (values) => {
      log.updated.push(values);
      return { eq: () => ({ eq: () => ({ select: () => Promise.resolve(updates.shift() ?? rows()) }) }) };
    },
    insert: (values) => {
      log.inserted.push(values);
      return { select: () => Promise.resolve(inserts.shift() ?? rows()) };
    },
  };
}

function backendOf(member: Answer, settings: SettingsTable, channels: Answer = rows()): ReminderBackend {
  return { members: () => oneKey(member), settings: () => settings, channels: () => Promise.resolve(channels) };
}

const session = () => Promise.resolve({ user: { id: 'auth-1' } } as Session);

// The silenced `console.error` of a failure case never leaks into the next.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the reminder read', () => {
  it('is off, email off, with no row', async () => {
    const outcome = await readReminderSettings(backendOf(rows(MEMBER), settingsTable(rows())), session);
    expect(outcome).toEqual({ ok: true, settings: { ...OWN, leads: [], email: false } });
    expect(remindersViewOf(outcome)).toEqual({ kind: REMINDERS_CONTROL, choice: { leads: [], email: false } });
  });

  it('reads a stored row in the set\'s order', async () => {
    const outcome = await readReminderSettings(
      backendOf(rows(MEMBER), settingsTable(rows({ leads: ['EVENING_BEFORE', 'H2'], email: true }))),
      session,
    );
    expect(outcome).toEqual({ ok: true, settings: { ...OWN, leads: ['H2', 'EVENING_BEFORE'], email: true } });
  });

  it('is unavailable on no session, no member, a failure or a malformed row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unavailable = { ok: false, code: REMINDER_SETTINGS_UNAVAILABLE };
    expect(await readReminderSettings(backendOf(rows(MEMBER), settingsTable(rows())), () => Promise.resolve(null))).toEqual(unavailable);
    expect(await readReminderSettings(backendOf(rows(), settingsTable(rows())), session)).toEqual(unavailable);
    expect(await readReminderSettings(backendOf(rows(MEMBER), settingsTable(failure('42501'))), session)).toEqual(unavailable);
    for (const row of [{ leads: ['H1', 'H2', 'H3'], email: false }, { leads: ['H4'], email: false }, { leads: [], email: 'yes' }]) {
      expect(await readReminderSettings(backendOf(rows(MEMBER), settingsTable(rows(row))), session)).toEqual(unavailable);
    }
    expect(remindersViewOf(undefined)).toEqual({ kind: REMINDERS_LOADING });
    expect(remindersViewOf(unavailable as never)).toEqual({ kind: REMINDERS_UNAVAILABLE });
  });

  it('reads the channels, or nothing on a failure or a malformed answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const settings = settingsTable(rows());
    expect(await readReminderChannels(backendOf(rows(MEMBER), settings, { data: { push: true, email: false }, error: null }))).toEqual({
      push: true,
      email: false,
    });
    expect(await readReminderChannels(backendOf(rows(MEMBER), settings, failure('42501')))).toBeNull();
    expect(await readReminderChannels(backendOf(rows(MEMBER), settings, { data: { push: 1, email: false }, error: null }))).toBeNull();
    expect(reminderChannelsOf([true, false])).toBeNull();
    expect(reminderChannelsOf(null)).toBeNull();
    expect(reminderChoiceOf(null)).toEqual({ leads: [], email: false });
  });
});

describe('the reminder write', () => {
  it('updates the own row when there is one', async () => {
    const log = { updated: [] as unknown[], inserted: [] as unknown[] };
    const written = await writeReminderSettings(
      backendOf(rows(MEMBER), settingsTable(rows(), { update: [rows({ leads: ['H2', 'EVENING_BEFORE'], email: false })] }, log)),
      OWN,
      { leads: ['EVENING_BEFORE', 'H2'], email: false },
    );
    expect(written).toEqual({ ok: true, choice: { leads: ['H2', 'EVENING_BEFORE'], email: false } });
    expect(log.updated).toEqual([{ leads: ['H2', 'EVENING_BEFORE'], email: false }]);
    expect(log.inserted).toEqual([]);
  });

  it('inserts the four facts when no row matched, never an upsert', async () => {
    const log = { updated: [] as unknown[], inserted: [] as unknown[] };
    const written = await writeReminderSettings(
      backendOf(rows(MEMBER), settingsTable(rows(), { update: [rows()], insert: [rows({ leads: ['H1'], email: true })] }, log)),
      OWN,
      { leads: ['H1'], email: true },
    );
    expect(written).toEqual({ ok: true, choice: { leads: ['H1'], email: true } });
    expect(log.inserted).toEqual([{ organization_id: 'organization-1', member_id: 'member-1', leads: ['H1'], email: true }]);
  });

  it('updates after losing an insert race to another tab', async () => {
    const written = await writeReminderSettings(
      backendOf(
        rows(MEMBER),
        settingsTable(rows(), { update: [rows(), rows({ leads: ['H3'], email: false })], insert: [failure('23505')] }),
      ),
      OWN,
      { leads: ['H3'], email: false },
    );
    expect(written).toEqual({ ok: true, choice: { leads: ['H3'], email: false } });
  });

  it('is refused on 42501, on an insert matching no row, and on a choice of three; unavailable on any other failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refused = { ok: false, code: REMINDER_SETTINGS_REFUSED };
    expect(
      await writeReminderSettings(backendOf(rows(MEMBER), settingsTable(rows(), { update: [failure('42501')] })), OWN, {
        leads: ['H1'],
        email: false,
      }),
    ).toEqual(refused);
    expect(
      await writeReminderSettings(backendOf(rows(MEMBER), settingsTable(rows(), { update: [rows()], insert: [failure('42501')] })), OWN, {
        leads: ['H1'],
        email: false,
      }),
    ).toEqual(refused);
    // The policy's silent refusal: an insert answering no row, and the retry
    // after a lost race matching none.
    expect(
      await writeReminderSettings(backendOf(rows(MEMBER), settingsTable(rows(), { update: [rows()], insert: [rows()] })), OWN, {
        leads: ['H1'],
        email: false,
      }),
    ).toEqual(refused);
    expect(
      await writeReminderSettings(
        backendOf(rows(MEMBER), settingsTable(rows(), { update: [rows(), rows()], insert: [failure('23505')] })),
        OWN,
        { leads: ['H1'], email: false },
      ),
    ).toEqual(refused);
    const log = { updated: [] as unknown[], inserted: [] as unknown[] };
    expect(
      await writeReminderSettings(backendOf(rows(MEMBER), settingsTable(rows(), {}, log)), OWN, {
        leads: ['H1', 'H2', 'H3'],
        email: false,
      }),
    ).toEqual(refused);
    expect(log.updated, 'a choice of three was sent').toEqual([]);
    expect(
      await writeReminderSettings(backendOf(rows(MEMBER), settingsTable(rows(), { update: [failure('PGRST000')] })), OWN, {
        leads: [],
        email: false,
      }),
    ).toEqual({ ok: false, code: REMINDER_SETTINGS_UNAVAILABLE });
  });
});

describe('the reminder card\'s rules', () => {
  it('turns a lead on or off in the set\'s order, and refuses a third', () => {
    expect(toggledLeads([], 'EVENING_BEFORE', true)).toEqual(['EVENING_BEFORE']);
    expect(toggledLeads(['EVENING_BEFORE'], 'H2', true)).toEqual(['H2', 'EVENING_BEFORE']);
    expect(toggledLeads(['H2', 'EVENING_BEFORE'], 'H2', false)).toEqual(['EVENING_BEFORE']);
    expect(toggledLeads(['H2', 'EVENING_BEFORE'], 'H6', true)).toBeNull();
    expect(toggledLeads(['H2'], 'H2', true)).toEqual(['H2']);
  });

  it('holds the other four switches when two are on', () => {
    expect(leadHeld(['H2', 'EVENING_BEFORE'], 'H1')).toBe(true);
    expect(leadHeld(['H2', 'EVENING_BEFORE'], 'H2')).toBe(false);
    expect(leadHeld(['H2'], 'H1')).toBe(false);
  });

  it('names the channels, or that none is available', () => {
    expect(channelMessageKey({ push: true, email: true }, true)).toBe('reminders.channelBoth');
    expect(channelMessageKey({ push: true, email: false }, false)).toBe('reminders.channelPush');
    expect(channelMessageKey({ push: true, email: false }, true)).toBe('reminders.channelPush');
    expect(channelMessageKey({ push: false, email: true }, true)).toBe('reminders.channelEmail');
    expect(channelMessageKey({ push: false, email: false }, false)).toBe('reminders.channelNone');
    // The email switch already on: never told to turn it on.
    expect(channelMessageKey({ push: false, email: false }, true)).toBe('reminders.channelNoneEmailOn');
  });

  it('says why email reminders are not sent, from the email card\'s view', () => {
    expect(emailUnreachableMessageKey({ kind: 'noAddress', organizationOff: false, admin: false })).toBe('reminders.emailNoAddress');
    expect(emailUnreachableMessageKey({ kind: 'organizationOff', address: 'a@b.c', admin: false })).toBe(
      'reminders.emailOrganizationOff',
    );
    expect(emailUnreachableMessageKey({ kind: 'control', address: 'a@b.c', email: false, admin: false })).toBe('reminders.emailOff');
    expect(emailUnreachableMessageKey({ kind: 'control', address: 'a@b.c', email: true, admin: false })).toBe(
      'reminders.emailUnreachable',
    );
    expect(emailUnreachableMessageKey({ kind: 'unavailable' })).toBe('reminders.emailUnreachable');
    // While the email card is still loading, no reason at all (no generic flash).
    expect(emailUnreachableMessageKey({ kind: 'loading' })).toBeNull();
  });

  it('labels the six leads as the spec words them', () => {
    const labels = (['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE'] as const).map((lead) => {
      const [, key] = leadMessageKey(lead).split('.lead.');
      return (hr.reminders.lead as Record<string, string>)[key ?? ''];
    });
    expect(labels).toEqual(['1 h prije', '2 h prije', '3 h prije', '6 h prije', '12 h prije', 'večer prije u 20:00']);
  });
});
