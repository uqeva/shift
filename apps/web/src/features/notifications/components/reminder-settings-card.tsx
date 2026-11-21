import { MAX_REMINDER_LEADS, REMINDER_LEADS, type ReminderLead } from '@shift/domain';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import type { ReminderSettingsState } from '@/features/notifications/hooks/use-reminder-settings';
import {
  REMINDERS_CONTROL,
  REMINDERS_LOADING,
  REMINDERS_UNAVAILABLE,
  channelMessageKey,
  emailUnreachableMessageKey,
  leadHeld,
  leadMessageKey,
  toggledLeads,
  type ReminderChoice,
} from '@/features/notifications/services/reminders';
import type { NotificationsView } from '@/features/notifications/services/settings';
import {
  NOTIFICATIONS_REMINDERS_EMAIL_SWITCH_ID,
  NOTIFICATIONS_REMINDERS_FAILURE_ID,
  NOTIFICATIONS_REMINDERS_HEADING_ID,
  NOTIFICATIONS_REMINDERS_LEADS_LABEL_ID,
  NOTIFICATIONS_REMINDERS_LIMIT_ID,
  notificationsReminderLeadSwitchId,
} from '@/features/notifications/utils/element-ids';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * *Podsjetnici* on `/obavijesti` (story 17.1, UX-DR57), the third card, after
 * *E-pošta* and *Obavijesti na uređaju*, which it names. Six switches in lead
 * order, at most two on: with two on the other four are `aria-disabled` (never
 * `disabled`, focus stays) and a line says to turn one off first. Then the
 * reminder email switch, always shown (it is the member's stored choice), and
 * the channel the reminders reach, or in words that none is available. With
 * the email switch on but email unreachable, a line says why, from the
 * *E-pošta* card's own view (`email`).
 */
export function ReminderSettingsCard({
  state,
  email,
}: {
  readonly state: ReminderSettingsState;
  readonly email: NotificationsView;
}): ReactNode {
  const { view } = state;

  return (
    <Card role="region" aria-labelledby={NOTIFICATIONS_REMINDERS_HEADING_ID} className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2 id={NOTIFICATIONS_REMINDERS_HEADING_ID}>{t('reminders.heading')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.kind === REMINDERS_LOADING ? (
          <div role="status" aria-busy className="grid animate-pulse gap-3">
            <span className="sr-only">{t('reminders.loading')}</span>
            <div className="h-5 w-48 rounded bg-muted" />
            <div className="h-40 rounded bg-muted" />
          </div>
        ) : null}
        {view.kind === REMINDERS_UNAVAILABLE ? (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t('reminders.unavailable')}</Notice>
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              aria-busy={state.retrying}
              onClick={() => {
                void state.retry();
              }}
            >
              {t('reminders.retry')}
            </Button>
          </div>
        ) : null}
        {view.kind === REMINDERS_CONTROL ? <ReminderControl state={state} stored={view.choice} email={email} /> : null}
      </CardContent>
    </Card>
  );
}

/** The switches, saved on change, with their pending, failure and saved states, and the channel line. */
function ReminderControl({
  state,
  stored,
  email,
}: {
  readonly state: ReminderSettingsState;
  readonly stored: ReminderChoice;
  readonly email: NotificationsView;
}): ReactNode {
  const gate = useWriteGate();
  const { pending, failed, saved, save, channels } = state;
  // WHILE A WRITE IS IN FLIGHT the chosen value is drawn; otherwise the stored
  // one, so a refused write returns every switch to what the database holds.
  const shown = pending ?? stored;
  const busy = pending !== null;
  const inert = busy || !gate.online;
  const full = shown.leads.length >= MAX_REMINDER_LEADS;
  const failure = failed ? NOTIFICATIONS_REMINDERS_FAILURE_ID : null;
  // THE CHANNEL AND REASON LINES, only while a lead is on, no write is in
  // flight and the channels were read afresh (`channels` is null while their
  // read is under way), so a stale answer never flashes.
  const lines = shown.leads.length === 0 || busy ? null : channels;
  const channelLine = lines === null ? null : channelMessageKey(lines, shown.email);
  const reasonLine = lines === null || !shown.email || lines.email ? null : emailUnreachableMessageKey(email);

  function switchLead(lead: ReminderLead, on: boolean): void {
    if (inert || leadHeld(shown.leads, lead)) return;
    // A press that changes nothing sends nothing.
    if (shown.leads.includes(lead) === on) return;
    const leads = toggledLeads(shown.leads, lead, on);
    if (leads === null) return;
    void save({ leads, email: shown.email });
  }

  function switchEmail(on: boolean): void {
    if (inert || on === shown.email) return;
    void save({ leads: shown.leads, email: on });
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('reminders.lede')}</p>
      {/* One busy container for every switch: `aria-busy` never sits on a `role="switch"`. */}
      <div aria-busy={busy} className="grid gap-4">
        <div role="group" aria-labelledby={NOTIFICATIONS_REMINDERS_LEADS_LABEL_ID} className="grid gap-1">
          <p id={NOTIFICATIONS_REMINDERS_LEADS_LABEL_ID} className="pb-2 text-sm font-semibold leading-none">
            {t('reminders.leadsLabel')}
          </p>
          {REMINDER_LEADS.map((lead) => {
            const held = leadHeld(shown.leads, lead);
            const id = notificationsReminderLeadSwitchId(lead);
            return (
              <div key={lead} className="flex min-h-11 min-w-0 items-center gap-3">
                <Switch
                  id={id}
                  checked={shown.leads.includes(lead)}
                  onCheckedChange={(on) => {
                    switchLead(lead, on);
                  }}
                  aria-disabled={inert || held ? true : undefined}
                  aria-describedby={gate.describedBy(held ? NOTIFICATIONS_REMINDERS_LIMIT_ID : null, failure)}
                />
                <Label htmlFor={id} className="min-w-0 break-words">
                  {t(leadMessageKey(lead))}
                </Label>
              </div>
            );
          })}
        </div>
        {full ? (
          <p id={NOTIFICATIONS_REMINDERS_LIMIT_ID} className="text-sm text-muted-foreground">
            {t('reminders.limit')}
          </p>
        ) : null}
        <div className="flex min-h-11 min-w-0 items-center gap-3">
          <Switch
            id={NOTIFICATIONS_REMINDERS_EMAIL_SWITCH_ID}
            checked={shown.email}
            onCheckedChange={switchEmail}
            aria-disabled={inert ? true : undefined}
            aria-describedby={gate.describedBy(failure)}
          />
          <Label htmlFor={NOTIFICATIONS_REMINDERS_EMAIL_SWITCH_ID} className="min-w-0 break-words">
            {t('reminders.emailChoice')}
          </Label>
        </div>
      </div>
      <OfflineWriteNote gate={gate} />
      {shown.leads.length === 0 ? <p className="text-sm">{t('reminders.off')}</p> : null}
      {channelLine === null ? null : <p className="text-sm">{t(channelLine)}</p>}
      {reasonLine === null ? null : <p className="text-sm">{t(reasonLine)}</p>}
      {failed ? (
        <Notice id={NOTIFICATIONS_REMINDERS_FAILURE_ID} role="alert">
          {t('reminders.saveFailed')}
        </Notice>
      ) : null}
      {saved && !failed ? <Notice role="status">{t('reminders.saved')}</Notice> : null}
    </div>
  );
}
