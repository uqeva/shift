import type { ReminderLead } from '@shift/domain';

/**
 * `/obavijesti`'s element ids (story 10.3), named once so a heading's id and
 * the `aria-labelledby` that names it can never spell one differently.
 * Identifiers, never copy.
 */
export const NOTIFICATIONS_HEADING_ID = 'notifications-heading';
export const NOTIFICATIONS_EMAIL_HEADING_ID = 'notifications-email-heading';
export const NOTIFICATIONS_EMAIL_LABEL_ID = 'notifications-email-label';
export const NOTIFICATIONS_EMAIL_FAILURE_ID = 'notifications-email-failure';
/** Story 10.4: the push section, beside the email one. */
export const NOTIFICATIONS_PUSH_HEADING_ID = 'notifications-push-heading';
export const NOTIFICATIONS_PUSH_LABEL_ID = 'notifications-push-label';
export const NOTIFICATIONS_PUSH_FAILURE_ID = 'notifications-push-failure';
/** Story 17.1: the reminders section, after the push one. */
export const NOTIFICATIONS_REMINDERS_HEADING_ID = 'notifications-reminders-heading';
export const NOTIFICATIONS_REMINDERS_LEADS_LABEL_ID = 'notifications-reminders-leads-label';
export const NOTIFICATIONS_REMINDERS_LIMIT_ID = 'notifications-reminders-limit';
export const NOTIFICATIONS_REMINDERS_EMAIL_SWITCH_ID = 'notifications-reminders-email-switch';
export const NOTIFICATIONS_REMINDERS_FAILURE_ID = 'notifications-reminders-failure';
/** One lead's switch, by its code. */
export function notificationsReminderLeadSwitchId(lead: ReminderLead): string {
  return `notifications-reminders-lead-${lead.toLowerCase().replaceAll('_', '-')}`;
}
