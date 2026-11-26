import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CaretLeft, CaretRight } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import { HolidayCheckBody, holidayErasureCopyOf } from '@/features/holidays/components/holiday-check-body';
import { CHANGE_ADD, CHANGE_REMOVE, type HolidayChange, type HolidayCheckReady } from '@/features/holidays/services/holiday-check';
import {
  FIRST_IMPORT_YEAR,
  FIRST_PICKED_YEAR,
  HOLIDAY_OPENING_ADD,
  HOLIDAY_OPENING_RENAME,
  LAST_PICKED_YEAR,
} from '@/features/holidays/services/holidays';
import {
  HOLIDAY_DATE_FIELD,
  HOLIDAY_NAME_FIELD,
  holidayMessageKey,
  holidaySavedMessageKey,
  marksHolidayDate,
  marksHolidayName,
} from '@/features/holidays/services/write';
import type { OrganizationHolidays } from '@/features/organization/hooks/use-organization-holidays';
import {
  ORGANIZATION_HOLIDAYS_ADD_ID,
  ORGANIZATION_HOLIDAYS_ERROR_ID,
  ORGANIZATION_HOLIDAYS_HEADING_ID,
  ORGANIZATION_HOLIDAYS_IMPORT_ID,
  ORGANIZATION_HOLIDAYS_RETRY_ID,
  ORGANIZATION_HOLIDAYS_STATUS_ID,
  ORGANIZATION_HOLIDAYS_YEAR_ID,
  ORGANIZATION_HOLIDAY_CONFIRM_ID,
  ORGANIZATION_HOLIDAY_DATE_FIELD_ID,
  ORGANIZATION_HOLIDAY_DATE_REFUSED_DESCRIPTION,
  ORGANIZATION_HOLIDAY_DIALOG_HEADING_ID,
  ORGANIZATION_HOLIDAY_ERASURES_ID,
  ORGANIZATION_HOLIDAY_ERROR_ID,
  ORGANIZATION_HOLIDAY_NAME_FIELD_ID,
  ORGANIZATION_HOLIDAY_PAST_ID,
  ORGANIZATION_HOLIDAY_PREVIEW_HEADING_ID,
  ORGANIZATION_HOLIDAY_SAVE_ID,
  organizationHolidayRemoveId,
} from '@/features/organization/utils/element-ids';
import { manualDateValuesOf } from '@/features/planning/services/manual-preview';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { keepFocusOnAlert } from '@/utils/retry-focus';
import { NO_TEXT } from '@/utils/text';

/**
 * *Blagdani* (story 21.17; UX-DR78): the organization's holidays of the year
 * the `‹`/`›` picker shows (the organization's own year at first), by date —
 * each with its weekday and date, its name, *Preimenuj* and *Ukloni* — or one
 * line when the year has none. *Dodaj blagdan* opens a dialog with a date
 * (a past one warned, never refused) and a name; *Uvezi državne blagdane za
 * {godina}* proposes the official list from 2020 on, and says so when nothing
 * is new. Every write but a rename shows *Što se mijenja* first, and an
 * erasure waits for its confirmation. Everything it decides is
 * `useOrganizationHolidays`'s and `@/features/holidays/services/*`'s.
 *
 * ITS OWN READ'S STATES: the calendar snapshot is the card's alone (the
 * page never waits for it), so the card draws its own skeleton, its own
 * unavailable notice with a retry (online only, story 8.2e), and offline
 * the snapshot as cached.
 *
 * OFFLINE, every control is gated (story 8.3a), as *Poslovi*'s.
 */
export function OrganizationHolidaysCard({ holidays }: { readonly holidays: OrganizationHolidays }): ReactNode {
  const { calendar, unavailable, loading, year, pending, cardFailure, saved, proposal } = holidays;
  const gate = useWriteGate();
  const dialogsOpen = holidays.opening !== null || holidays.checked !== null || holidays.erasures.shown !== null;
  const ready = calendar !== null && year !== null;

  function renderImport(): ReactNode {
    if (year === null) return null;

    if (year < FIRST_IMPORT_YEAR) {
      return <p className="text-sm text-muted-foreground">{t('organization.holidays.importBefore', { first: String(FIRST_IMPORT_YEAR) })}</p>;
    }

    if (proposal === null) return null;

    const none = proposal.missing.length === 0;

    return (
      <Button
        id={ORGANIZATION_HOLIDAYS_IMPORT_ID}
        className="h-11 justify-self-start whitespace-normal aria-disabled:opacity-50"
        type="button"
        variant="outline"
        disabled={none}
        aria-disabled={gate.disabled || pending}
        aria-describedby={gate.describedBy()}
        aria-busy={pending}
        onClick={() => {
          if (!gate.online || pending || none) return;
          void holidays.askImport();
        }}
      >
        {none
          ? t('organization.holidays.importNone', { year: String(year) })
          : t('organization.holidays.import', { year: String(year) })}
      </Button>
    );
  }

  function renderList(): ReactNode {
    const list = holidays.holidays;

    if (list === null || year === null) return null;

    if (list.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('organization.holidays.none', { year: String(year) })}</p>;
    }

    return (
      <ul className="grid min-w-0 divide-y divide-border">
        {list.map((holiday) => (
          <li key={holiday.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="grid min-w-0 gap-1">
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('organization.holidays.rowDate', manualDateValuesOf(holiday.date))}
              </span>
              <span className="break-words text-sm font-medium">{holiday.name}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-11 aria-disabled:opacity-50"
                type="button"
                variant="outline"
                aria-label={t('organization.holidays.renameLabel', { name: holiday.name })}
                aria-disabled={gate.disabled || pending}
                aria-describedby={gate.describedBy()}
                onClick={() => {
                  if (!gate.online || pending) return;
                  holidays.openRename(holiday);
                }}
              >
                {t('organization.holidays.rename')}
              </Button>
              <Button
                id={organizationHolidayRemoveId(holiday.id)}
                className="h-11 aria-disabled:opacity-50"
                type="button"
                variant="outline"
                aria-label={t('organization.holidays.removeLabel', { name: holiday.name })}
                aria-disabled={gate.disabled || pending}
                aria-describedby={gate.describedBy()}
                onClick={() => {
                  if (!gate.online || pending) return;
                  void holidays.askRemove(holiday);
                }}
              >
                {t('organization.holidays.remove')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_HOLIDAYS_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_HOLIDAYS_HEADING_ID} tabIndex={-1}>
              {t('organization.holidays.heading')}
            </h2>
          </CardTitle>
          {ready ? (
            <Button
              id={ORGANIZATION_HOLIDAYS_ADD_ID}
              className="h-11 aria-disabled:opacity-50"
              type="button"
              variant="outline"
              aria-disabled={gate.disabled || pending}
              aria-describedby={gate.describedBy()}
              onClick={() => {
                if (!gate.online || pending) return;
                holidays.openAdd();
              }}
            >
              {t('organization.holidays.add')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {unavailable ? (
            // ONE WRAPPER FOR THE MESSAGE AND ITS RETRY (story 8.2e); no read retry offline.
            <div className="grid min-w-0 gap-2">
              <Notice role="alert">{t('organization.holidays.error.unavailable')}</Notice>
              {gate.online ? (
                <Button
                  ref={keepFocusOnAlert}
                  id={ORGANIZATION_HOLIDAYS_RETRY_ID}
                  className="h-11 w-full sm:w-auto sm:justify-self-start"
                  type="button"
                  variant="outline"
                  onClick={holidays.retry}
                >
                  {t('shell.retry')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {cardFailure === null || dialogsOpen ? null : (
            <Notice id={ORGANIZATION_HOLIDAYS_ERROR_ID} role="alert">
              {t(holidayMessageKey(cardFailure))}
            </Notice>
          )}
          {saved === null || dialogsOpen ? null : (
            <Notice id={ORGANIZATION_HOLIDAYS_STATUS_ID} role="status">
              {t(holidaySavedMessageKey(saved.saved), { count: saved.count })}
            </Notice>
          )}
          {ready ? <OfflineWriteNote gate={gate} /> : null}
          {!ready && loading ? <div aria-hidden className="h-10 w-56 max-w-full animate-pulse rounded-md bg-muted" /> : null}
          {ready ? (
            <div className="flex items-center gap-2">
              <Button
                className="h-11 w-11 px-0"
                type="button"
                variant="outline"
                aria-label={t('organization.holidays.yearPrevious')}
                disabled={pending || year <= FIRST_PICKED_YEAR}
                onClick={() => {
                  holidays.stepYear(-1);
                }}
              >
                <CaretLeft aria-hidden />
              </Button>
              <span id={ORGANIZATION_HOLIDAYS_YEAR_ID} aria-live="polite" className="min-w-16 text-center text-sm font-medium tabular-nums">
                {t('organization.holidays.yearShown', { year: String(year) })}
              </span>
              <Button
                className="h-11 w-11 px-0"
                type="button"
                variant="outline"
                aria-label={t('organization.holidays.yearNext')}
                disabled={pending || year >= LAST_PICKED_YEAR}
                onClick={() => {
                  holidays.stepYear(1);
                }}
              >
                <CaretRight aria-hidden />
              </Button>
            </div>
          ) : null}
          {renderList()}
          {ready ? renderImport() : null}
        </CardContent>
      </Card>
      <HolidayDialog holidays={holidays} />
      <HolidayPreview holidays={holidays} />
      <HolidayErasures holidays={holidays} />
    </>
  );
}

/** The one dialog, for adding and renaming: mounted always, its body keyed to the opening. */
function HolidayDialog({ holidays }: { readonly holidays: OrganizationHolidays }): ReactNode {
  const { opening, pending, close } = holidays;

  return (
    <Dialog
      open={opening !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) close();
      }}
      aria-labelledby={ORGANIZATION_HOLIDAY_DIALOG_HEADING_ID}
    >
      {opening === null ? null : (
        <>
          <DialogHeader closeLabel={t('organization.holidays.close')} onClose={close}>
            <DialogTitle id={ORGANIZATION_HOLIDAY_DIALOG_HEADING_ID}>
              {opening.kind === HOLIDAY_OPENING_ADD ? t('organization.holidays.addHeading') : t('organization.holidays.renameHeading')}
            </DialogTitle>
          </DialogHeader>
          <Fragment key={opening.key}>
            <HolidayForm holidays={holidays} />
          </Fragment>
        </>
      )}
    </Dialog>
  );
}

/** *Dodaj blagdan*'s date and name with *Dalje*, or *Preimenuj*'s name with *Spremi*: never controlled (UX-DR34). */
function HolidayForm({ holidays }: { readonly holidays: OrganizationHolidays }): ReactNode {
  const { opening, pending, failure, draft, draftPast, close } = holidays;
  const gate = useWriteGate();

  if (opening === null) return null;

  const adding = opening.kind === HOLIDAY_OPENING_ADD;
  const nameShown = opening.kind === HOLIDAY_OPENING_RENAME ? opening.holiday.name : draft.name;

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!gate.online) return;

        const fields = event.currentTarget.elements;
        const name = fields.namedItem(HOLIDAY_NAME_FIELD);
        const date = fields.namedItem(HOLIDAY_DATE_FIELD);

        if (!(name instanceof HTMLInputElement)) return;
        if (!adding) {
          void holidays.rename(name.value);

          return;
        }
        if (date instanceof HTMLInputElement) void holidays.next(date.value, name.value);
      }}
      className="grid gap-5"
    >
      {adding ? (
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ORGANIZATION_HOLIDAY_DATE_FIELD_ID}>{t('organization.holidays.date')}</Label>
          <Input
            id={ORGANIZATION_HOLIDAY_DATE_FIELD_ID}
            name={HOLIDAY_DATE_FIELD}
            type="date"
            defaultValue={draft.date}
            required
            readOnly={pending}
            aria-invalid={marksHolidayDate(failure)}
            aria-describedby={failure === null ? ORGANIZATION_HOLIDAY_PAST_ID : ORGANIZATION_HOLIDAY_DATE_REFUSED_DESCRIPTION}
            onChange={(event) => {
              holidays.noteDate(event.currentTarget.value);
            }}
            className="h-11 min-w-0"
          />
          {/* A WARNING, NEVER A REFUSAL (AD-2): ALWAYS MOUNTED, so the live
              region is in place before its text changes as the date is chosen. */}
          <p id={ORGANIZATION_HOLIDAY_PAST_ID} role="status" className="text-sm text-muted-foreground">
            {draftPast ? t('organization.holidays.pastWarning') : NO_TEXT}
          </p>
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor={ORGANIZATION_HOLIDAY_NAME_FIELD_ID}>{t('organization.holidays.name')}</Label>
        <Input
          id={ORGANIZATION_HOLIDAY_NAME_FIELD_ID}
          name={HOLIDAY_NAME_FIELD}
          type="text"
          required
          autoComplete="off"
          defaultValue={nameShown}
          readOnly={pending}
          aria-invalid={marksHolidayName(failure)}
          aria-describedby={failure === null ? undefined : ORGANIZATION_HOLIDAY_ERROR_ID}
          className="h-11 w-full"
        />
      </div>
      {failure === null ? null : (
        <Notice id={ORGANIZATION_HOLIDAY_ERROR_ID} role="alert">
          {t(holidayMessageKey(failure))}
        </Notice>
      )}
      <OfflineWriteNote gate={gate} />
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={close}>
          {t('organization.holidays.cancel')}
        </Button>
        <Button
          id={ORGANIZATION_HOLIDAY_SAVE_ID}
          className="h-11 aria-disabled:opacity-50"
          type="submit"
          disabled={pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
        >
          {adding ? t('organization.holidays.next') : t('organization.holidays.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The lede of *Što se mijenja*: the holiday added or removed, or the import's count and year. */
function ledeOf(checked: HolidayCheckReady): string {
  const { change } = checked;

  if (change.kind === CHANGE_REMOVE) {
    return t('organization.holidays.preview.ledeRemove', { name: change.name, ...manualDateValuesOf(change.date) });
  }

  if (change.kind === CHANGE_ADD && change.year !== null) {
    return t('organization.holidays.preview.ledeImport', { count: change.holidays.length, year: String(change.year) });
  }

  if (change.kind === CHANGE_ADD) {
    const [added] = change.holidays;

    return added === undefined ? NO_TEXT : t('organization.holidays.preview.ledeAdd', { name: added.name, ...manualDateValuesOf(added.date) });
  }

  return NO_TEXT;
}

/** *Što se mijenja*: what the fresh check derived for an add, a removal or an import. */
function HolidayPreview({ holidays }: { readonly holidays: OrganizationHolidays }): ReactNode {
  const gate = useWriteGate();
  const { checked, pending } = holidays;

  return (
    <Dialog
      open={checked !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) holidays.closePreview();
      }}
      aria-labelledby={ORGANIZATION_HOLIDAY_PREVIEW_HEADING_ID}
    >
      {checked === null ? null : (
        <>
          <DialogHeader closeLabel={t('organization.holidays.close')} onClose={holidays.closePreview}>
            <DialogTitle id={ORGANIZATION_HOLIDAY_PREVIEW_HEADING_ID}>{t('organization.holidays.preview.title')}</DialogTitle>
            <DialogDescription>{ledeOf(checked)}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60svh] gap-4 overflow-y-auto">
            {holidays.changedAgain ? <Notice role="status">{t('organization.holidays.preview.changed')}</Notice> : null}
            <HolidayCheckBody checked={checked} />
          </div>
          {holidays.cardFailure === null ? null : <Notice role="alert">{t(holidayMessageKey(holidays.cardFailure))}</Notice>}
          <OfflineWriteNote gate={gate} />
          <DialogFooter>
            <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={holidays.closePreview}>
              {t('organization.holidays.preview.back')}
            </Button>
            <Button
              id={ORGANIZATION_HOLIDAY_CONFIRM_ID}
              className="h-11 aria-disabled:opacity-50"
              type="button"
              disabled={pending}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              aria-busy={pending}
              onClick={() => {
                if (!gate.online) return;
                void holidays.confirm();
              }}
            >
              {saveLabelOf(checked.change)}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

/** The preview's confirm, in the change's own word; the erasure confirmation's save says the same. */
function saveLabelOf(change: HolidayChange): string {
  if (change.kind === CHANGE_REMOVE) return t('organization.holidays.preview.removeSave');
  if (change.kind === CHANGE_ADD && change.year !== null) return t('organization.holidays.preview.importSave');

  return t('organization.holidays.preview.save');
}

/** THE SAVE'S ERASURE DIALOG (AD-5): the shared `ErasureDialog`, one row per conflict the change would erase. */
function HolidayErasures({ holidays }: { readonly holidays: OrganizationHolidays }): ReactNode {
  const gate = useWriteGate();
  const shown = holidays.erasures.shown;

  if (shown === null) return null;

  return (
    <ErasureDialog
      id={ORGANIZATION_HOLIDAY_ERASURES_ID}
      rows={shown.rows}
      changed={shown.changed}
      decisions={holidays.erasures.decisions}
      busy={holidays.pending}
      firstErasure={holidays.erasures.firstErasure}
      copy={holidayErasureCopyOf(shown.rows, saveLabelOf(shown.subject))}
      scrollRows
      gate={gate}
      onDecide={holidays.erasures.decide}
      onBack={holidays.erasures.close}
      onSave={() => {
        void holidays.confirmErasures(shown);
      }}
    />
  );
}
