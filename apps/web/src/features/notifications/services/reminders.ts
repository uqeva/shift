import type { Session } from '@supabase/supabase-js';
import { MAX_REMINDER_LEADS, REMINDER_LEADS, reminderLeadsOf, type ReminderLead } from '@shift/domain';

import {
  NOTIFICATIONS_CONTROL,
  NOTIFICATIONS_LOADING,
  NOTIFICATIONS_NO_ADDRESS,
  NOTIFICATIONS_ORGANIZATION_OFF,
  OWN_MEMBER_COLUMNS,
  type NotificationsView,
  type OneKeyTable,
  type SettingsTable,
} from '@/features/notifications/services/settings';

/**
 * *Podsjetnici* on `/obavijesti` (story 17.1; FR-85, D4, D-S6, UX-DR57): the
 * signed-in member's own reminder choice, at most two leads of
 * `@shift/domain`'s `REMINDER_LEADS` and the reminder email switch, and the
 * channel the reminders will use.
 *
 * NO ROW MEANS OFF, email off (`0069`). The member reads and writes only their
 * own row: an insert names `organization_id, member_id, leads, email`, an
 * update `leads, email`, so the write is an update first and an insert only
 * when no row was there, never a PostgREST upsert (0044's reason).
 *
 * THE CHANNELS are the server's answer, `reminder_channels()`: push is a
 * device of the member's anywhere, email is AD-18's one predicate. A failed
 * channel read leaves the line out; the card still works.
 */

export const REMINDER_SETTINGS_KEY = ['reminder-settings'] as const;
/** The channel line's read, under the settings key: invalidated after any landed write on the screen. */
export const REMINDER_CHANNELS_KEY = [...REMINDER_SETTINGS_KEY, 'channels'] as const;

export const REMINDER_SETTINGS_TABLE = 'reminder_settings';
export const REMINDER_CHANNELS_RPC = 'reminder_channels';
export const OWN_REMINDER_COLUMNS = 'leads,email';

/** The read or the write could not be answered: transport, refusal or a malformed row. */
export const REMINDER_SETTINGS_UNAVAILABLE = 'REMINDER_SETTINGS_UNAVAILABLE';
/**
 * The write was refused: by the database (42501, or an update and insert that
 * matched no row: RLS, not this member's row), or, before anything is sent, a
 * choice that is no valid lead list (more than two, or an unknown code).
 */
export const REMINDER_SETTINGS_REFUSED = 'REMINDER_SETTINGS_REFUSED';

export type ReminderSettingsFailure = typeof REMINDER_SETTINGS_UNAVAILABLE | typeof REMINDER_SETTINGS_REFUSED;

/** The member's stored choice. */
export interface ReminderChoice {
  /** At most two leads, in `REMINDER_LEADS` order; none is off. */
  readonly leads: readonly ReminderLead[];
  /** The reminder email switch. */
  readonly email: boolean;
}

/** What the card draws from. */
export interface ReminderSettings extends ReminderChoice {
  readonly memberId: string;
  readonly organizationId: string;
}

export type ReminderSettingsOutcome =
  | { readonly ok: true; readonly settings: ReminderSettings }
  | { readonly ok: false; readonly code: ReminderSettingsFailure };

export type ReminderWriteOutcome =
  | { readonly ok: true; readonly choice: ReminderChoice }
  | { readonly ok: false; readonly code: ReminderSettingsFailure };

/** The channels the reminders reach now. */
export interface ReminderChannels {
  readonly push: boolean;
  readonly email: boolean;
}

/** The PostgREST answer this module reads: rows or an error. */
interface Answer {
  readonly data: unknown;
  readonly error: { readonly code?: string | undefined; readonly message?: string | undefined } | null;
}

/** The two tables and the one RPC, named structurally so they can be stubbed. */
export interface ReminderBackend {
  members(): OneKeyTable;
  settings(): SettingsTable;
  channels(): PromiseLike<Answer>;
}

function firstRow(answer: Answer): Record<string, unknown> | null | undefined {
  if (answer.error !== null) return undefined;
  if (!Array.isArray(answer.data)) return undefined;
  const row: unknown = answer.data[0];
  if (row === undefined) return null;
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : undefined;
}

/** A stored row's choice, or `null` when it is malformed. No row is off, email off. */
export function reminderChoiceOf(row: Record<string, unknown> | null): ReminderChoice | null {
  if (row === null) return { leads: [], email: false };
  const leads = reminderLeadsOf(row['leads']);
  const email = row['email'];
  if (leads === null || typeof email !== 'boolean') return null;
  return { leads, email };
}

/** The RPC's answer, or `null` when it is not `{ push, email }` booleans. */
export function reminderChannelsOf(value: unknown): ReminderChannels | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { push, email } = value as Record<string, unknown>;
  return typeof push === 'boolean' && typeof email === 'boolean' ? { push, email } : null;
}

const UNAVAILABLE = { ok: false, code: REMINDER_SETTINGS_UNAVAILABLE } as const;
const REFUSED = { ok: false, code: REMINDER_SETTINGS_REFUSED } as const;

/** The card's read. Never throws: every failure is the unavailable outcome. */
export async function readReminderSettings(
  backend: ReminderBackend,
  session: () => Promise<Session | null>,
): Promise<ReminderSettingsOutcome> {
  try {
    const current = await session();
    if (current === null) return UNAVAILABLE;

    const member = firstRow(await backend.members().select(OWN_MEMBER_COLUMNS).eq('auth_user_id', current.user.id).limit(1));
    if (member === undefined || member === null) return UNAVAILABLE;

    const memberId = member['id'];
    const organizationId = member['organization_id'];
    if (typeof memberId !== 'string' || typeof organizationId !== 'string') return UNAVAILABLE;

    const row = firstRow(
      await backend
        .settings()
        .select(OWN_REMINDER_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('member_id', memberId)
        .limit(1),
    );
    if (row === undefined) return UNAVAILABLE;
    const choice = reminderChoiceOf(row);

    return choice === null ? UNAVAILABLE : { ok: true, settings: { memberId, organizationId, ...choice } };
  } catch (cause) {
    console.error(REMINDER_SETTINGS_UNAVAILABLE, cause);
    return UNAVAILABLE;
  }
}

/** The channel line's read: the channels, or `null` on any failure (the line is then left out). */
export async function readReminderChannels(backend: ReminderBackend): Promise<ReminderChannels | null> {
  try {
    const answer = await backend.channels();
    if (answer.error !== null) return null;
    return reminderChannelsOf(answer.data);
  } catch (cause) {
    console.error(REMINDER_SETTINGS_UNAVAILABLE, cause);
    return null;
  }
}

const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

/** A write's answer: the choice its row now holds, `null` when it matched no row, or the failure. */
function storedChoice(answer: Answer): ReminderChoice | null | ReminderWriteOutcome {
  if (answer.error?.code === INSUFFICIENT_PRIVILEGE) return REFUSED;
  const row = firstRow(answer);
  if (row === undefined) return UNAVAILABLE;
  if (row === null) return null;
  return reminderChoiceOf(row) ?? UNAVAILABLE;
}

function isOutcome(value: ReminderChoice | ReminderWriteOutcome): value is ReminderWriteOutcome {
  return 'ok' in value;
}

/**
 * Stores the member's whole choice: an update of `leads, email` on their own
 * row, or, when no row exists, an insert of it. An insert that loses a race to
 * another tab's (23505) updates instead. Never throws.
 */
export async function writeReminderSettings(
  backend: ReminderBackend,
  own: { readonly organizationId: string; readonly memberId: string },
  choice: ReminderChoice,
): Promise<ReminderWriteOutcome> {
  const leads = reminderLeadsOf(choice.leads);
  if (leads === null) return REFUSED;
  const values = { leads: [...leads], email: choice.email };

  const update = () =>
    backend
      .settings()
      .update(values)
      .eq('organization_id', own.organizationId)
      .eq('member_id', own.memberId)
      .select(OWN_REMINDER_COLUMNS);

  // A row matched by neither the update nor the retry after a lost insert
  // race is a row this session may not reach: the policy's silent refusal.
  const outcomeOf = (stored: ReminderChoice | null | ReminderWriteOutcome): ReminderWriteOutcome => {
    if (stored === null) return REFUSED;
    return isOutcome(stored) ? stored : { ok: true, choice: stored };
  };

  try {
    const updated = storedChoice(await update());
    if (updated !== null) return outcomeOf(updated);

    const inserted = await backend
      .settings()
      .insert({ organization_id: own.organizationId, member_id: own.memberId, ...values })
      .select(OWN_REMINDER_COLUMNS);

    if (inserted.error?.code === UNIQUE_VIOLATION) return outcomeOf(storedChoice(await update()));

    return outcomeOf(storedChoice(inserted));
  } catch (cause) {
    console.error(REMINDER_SETTINGS_UNAVAILABLE, cause);
    return UNAVAILABLE;
  }
}

// ------------------------------------------------------------------ the view

/**
 * The leads after one switch: `lead` on or off, in `REMINDER_LEADS` order, or
 * `null` when turning it on would exceed {@link MAX_REMINDER_LEADS} (the press
 * does nothing).
 */
export function toggledLeads(stored: readonly ReminderLead[], lead: ReminderLead, on: boolean): readonly ReminderLead[] | null {
  const next = REMINDER_LEADS.filter((candidate) => (candidate === lead ? on : stored.includes(candidate)));
  return next.length > MAX_REMINDER_LEADS ? null : next;
}

/** Whether a lead's switch is held: the maximum is on and this lead is not one of them. */
export function leadHeld(leads: readonly ReminderLead[], lead: ReminderLead): boolean {
  return leads.length >= MAX_REMINDER_LEADS && !leads.includes(lead);
}

const LEAD_MESSAGE_KEYS = {
  H1: 'reminders.lead.h1',
  H2: 'reminders.lead.h2',
  H3: 'reminders.lead.h3',
  H6: 'reminders.lead.h6',
  H12: 'reminders.lead.h12',
  EVENING_BEFORE: 'reminders.lead.eveningBefore',
} as const satisfies Record<ReminderLead, string>;

/** A lead's label: `1 h prije` … `12 h prije`, `večer prije u 20:00`. */
export function leadMessageKey(
  lead: ReminderLead,
):
  | 'reminders.lead.h1'
  | 'reminders.lead.h2'
  | 'reminders.lead.h3'
  | 'reminders.lead.h6'
  | 'reminders.lead.h12'
  | 'reminders.lead.eveningBefore' {
  return LEAD_MESSAGE_KEYS[lead];
}

/** The channel line: the channels named, or in words that none is available. */
export function channelMessageKey(
  channels: ReminderChannels,
  emailSwitchOn: boolean,
):
  | 'reminders.channelBoth'
  | 'reminders.channelPush'
  | 'reminders.channelEmail'
  | 'reminders.channelNone'
  | 'reminders.channelNoneEmailOn' {
  if (channels.push && channels.email) return 'reminders.channelBoth';
  if (channels.push) return 'reminders.channelPush';
  if (channels.email) return 'reminders.channelEmail';
  // With the reminder email switch already on, never tell the member to turn it on.
  return emailSwitchOn ? 'reminders.channelNoneEmailOn' : 'reminders.channelNone';
}

/**
 * Why email reminders are not sent though their switch is on, from the
 * *E-pošta* card's own view: no address, the organization's switch off, the
 * member's email off, or, when that view says none of these (unavailable, or
 * on but the server still says no), that they are not sent now. `null` while
 * that view is loading, so the generic line never flashes before the reason.
 */
export function emailUnreachableMessageKey(
  email: NotificationsView,
): 'reminders.emailNoAddress' | 'reminders.emailOrganizationOff' | 'reminders.emailOff' | 'reminders.emailUnreachable' | null {
  if (email.kind === NOTIFICATIONS_LOADING) return null;
  if (email.kind === NOTIFICATIONS_NO_ADDRESS) return 'reminders.emailNoAddress';
  if (email.kind === NOTIFICATIONS_ORGANIZATION_OFF) return 'reminders.emailOrganizationOff';
  if (email.kind === NOTIFICATIONS_CONTROL && !email.email) return 'reminders.emailOff';
  return 'reminders.emailUnreachable';
}

export const REMINDERS_LOADING = 'loading';
export const REMINDERS_UNAVAILABLE = 'unavailable';
export const REMINDERS_CONTROL = 'control';

export type RemindersView =
  | { readonly kind: typeof REMINDERS_LOADING }
  | { readonly kind: typeof REMINDERS_UNAVAILABLE }
  | { readonly kind: typeof REMINDERS_CONTROL; readonly choice: ReminderChoice };

/** The card's state, from the read's answer alone. */
export function remindersViewOf(outcome: ReminderSettingsOutcome | undefined): RemindersView {
  if (outcome === undefined) return { kind: REMINDERS_LOADING };
  if (!outcome.ok) return { kind: REMINDERS_UNAVAILABLE };
  return { kind: REMINDERS_CONTROL, choice: { leads: outcome.settings.leads, email: outcome.settings.email } };
}
