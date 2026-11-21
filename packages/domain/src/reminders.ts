/**
 * Shift reminders (story 17.1; CAP-26, FR-85, D4, D-S6; AD-18).
 *
 * The ONE closed set of reminder leads: how long before a shift a member who
 * asked is reminded of it. 1, 2, 3, 6 or 12 real hours before the shift's real
 * start instant, or the evening before at 20:00 in the organization's zone.
 * `reminder_settings.leads` (0069) checks exactly this spelling, held equal by
 * a DB-free root pin (`test/supabase-scaffold.test.ts`); `remind` (17.2) and
 * `notify`'s variant map (17.3) read the same codes.
 *
 * A member holds at most {@link MAX_REMINDER_LEADS} distinct leads, stored in
 * {@link REMINDER_LEADS} order (shortest first, the evening last). No lead on
 * means reminders are off: there is no separate flag.
 *
 * Codes only (AD-8): the label of each lead is the web app's copy.
 *
 * Story 17.2: what each lead MEANS is here too, as numbers, so `zone.ts`'s
 * `reminderDueAt` reads it without a cycle (this module imports nothing):
 * an `H<n>` lead is {@link REMINDER_LEAD_HOURS} real hours before the
 * shift's real start instant, and `EVENING_BEFORE` is
 * {@link EVENING_BEFORE_MINUTE} local on the day before the shift's date.
 * `enqueue_shift_reminders` (0070) derives `leadHours` as
 * `substr(lead, 2)::integer`, pinned equal to this map by a root test.
 */

/** Every reminder lead, in canonical order: shortest first, the evening last. */
export const REMINDER_LEADS = ['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE'] as const;

export type ReminderLead = (typeof REMINDER_LEADS)[number];

/** How many leads a member may have on at once. */
export const MAX_REMINDER_LEADS = 2;

/** Whether a value is one of the {@link REMINDER_LEADS}. */
export function isReminderLead(value: unknown): value is ReminderLead {
  return typeof value === 'string' && (REMINDER_LEADS as readonly string[]).includes(value);
}

/**
 * A stored or chosen lead list in canonical order, duplicates dropped, or
 * `null` when the value is not an array, holds anything but a lead, or holds
 * more than {@link MAX_REMINDER_LEADS} distinct leads.
 */
export function reminderLeadsOf(value: unknown): readonly ReminderLead[] | null {
  if (!Array.isArray(value)) return null;
  const items: readonly unknown[] = value;
  if (!items.every(isReminderLead)) return null;
  const leads = REMINDER_LEADS.filter((lead) => items.includes(lead));
  return leads.length > MAX_REMINDER_LEADS ? null : leads;
}

/** The leads counted in real hours before the shift's start instant. */
export type ReminderHoursLead = Exclude<ReminderLead, 'EVENING_BEFORE'>;

/** How many real hours before the shift's real start instant each `H<n>` lead falls due. */
export const REMINDER_LEAD_HOURS: Readonly<Record<ReminderHoursLead, number>> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H6: 6,
  H12: 12,
};

/** The local minute `EVENING_BEFORE` falls due at, on the day before the shift's date: 20:00. */
export const EVENING_BEFORE_MINUTE = 20 * 60;
