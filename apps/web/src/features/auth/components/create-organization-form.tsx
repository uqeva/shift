import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { Rule } from '@/features/auth/components/set-password-form';
import type { CreateOrganizationScreenState } from '@/features/auth/hooks/use-create-organization';
import {
  ADMIN_NAME_MISSING,
  ALLOWANCE_INVALID,
  ALLOWANCE_MAX_LENGTH,
  CREATE_ELEMENT_IDS,
  CREATE_FIELD_IDS,
  LEAVE_START_DAY_OPTIONS,
  LEAVE_START_MISSING,
  LEAVE_START_MONTH_OPTIONS,
  NAME_MISSING,
  NOTHING_CHOSEN,
  SLUG_INVALID,
  SLUG_MAX_LENGTH,
  TIMEZONE_UNCONFIRMED,
  TYPE_MISSING,
  describedByOf,
  organizationRefusalMessageKey,
  slugFits,
} from '@/features/auth/services/create-organization';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { NAME_MAX_LENGTH } from '@/utils/name';

/**
 * Step 1, *Nova organizacija* (story 19.3, UX-DR66, AD-23): two cards and one
 * *Stvori organizaciju*, no *Preskoči*. Nothing is pre-filled or pre-selected:
 * the slug is proposed from the typed name, the zone from the device and only
 * once confirmed, the locale is read-only. The refusals on the page say what
 * to do; a taken or reserved slug answers with a proposal and never says who
 * holds it.
 */
export function CreateOrganizationForm({
  screen,
  email,
}: {
  readonly screen: CreateOrganizationScreenState;
  readonly email: string;
}): ReactNode {
  const gate = useWriteGate();
  const refused = (refusal: (typeof screen.refusals)[number]): boolean => screen.refusals.includes(refusal);
  const describedBy = (refusal: (typeof screen.refusals)[number], ...hints: string[]): string | undefined =>
    describedByOf([refused(refusal) ? CREATE_ELEMENT_IDS.refusal : null, ...hints]);

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        if (!gate.online) {
          event.preventDefault();
          return;
        }
        void screen.submit(event);
      }}
      className="grid gap-6"
    >
      <Card className="w-full min-w-0">
        <CardHeader>
          <CardTitle asChild>
            <h2>{t('signup.setup.organizationHeading')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor={CREATE_FIELD_IDS.NAME_MISSING}>{t('signup.setup.name')}</Label>
            <Input
              id={CREATE_FIELD_IDS.NAME_MISSING}
              name="organization-name"
              autoComplete="organization"
              maxLength={NAME_MAX_LENGTH}
              value={screen.name}
              onChange={screen.nameInput}
              aria-invalid={refused(NAME_MISSING)}
              aria-describedby={describedBy(NAME_MISSING)}
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={CREATE_FIELD_IDS.SLUG_INVALID}>{t('signup.setup.slug')}</Label>
            <Input
              id={CREATE_FIELD_IDS.SLUG_INVALID}
              name="organization-slug"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={SLUG_MAX_LENGTH}
              value={screen.slug}
              onChange={screen.slugInput}
              aria-invalid={refused(SLUG_INVALID) || screen.proposal !== null}
              aria-describedby={describedBy(
                SLUG_INVALID,
                ...(screen.proposal === null ? [] : [CREATE_ELEMENT_IDS.slugProposal]),
                CREATE_ELEMENT_IDS.slugHint,
                CREATE_ELEMENT_IDS.slugRule,
              )}
              className="h-11 font-mono"
            />
            {screen.proposal === null ? null : (
              <Notice id={CREATE_ELEMENT_IDS.slugProposal} role="status" className="grid gap-3">
                <span>{t('signup.setup.slugUnavailable', { proposal: screen.proposal })}</span>
                <Button
                  id={CREATE_ELEMENT_IDS.useProposal}
                  type="button"
                  variant="outline"
                  className="h-11 w-full sm:w-auto"
                  onClick={screen.takeProposal}
                >
                  {t('signup.setup.useProposal')}
                </Button>
              </Notice>
            )}
            <p id={CREATE_ELEMENT_IDS.slugHint} className="min-w-0 break-words text-sm text-muted-foreground">
              {t('signup.setup.slugHint', { slug: screen.slug })}
            </p>
            <div role="status" aria-atomic={false} className="text-sm">
              <Rule id={CREATE_ELEMENT_IDS.slugRule} met={slugFits(screen.slug)}>
                {t('signup.setup.slugRule')}
              </Rule>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={CREATE_FIELD_IDS.TYPE_MISSING}>{t('signup.setup.type')}</Label>
            <Input
              id={CREATE_FIELD_IDS.TYPE_MISSING}
              name="organization-type"
              maxLength={NAME_MAX_LENGTH}
              value={screen.organizationType}
              onChange={screen.typeInput}
              aria-invalid={refused(TYPE_MISSING)}
              aria-describedby={describedBy(TYPE_MISSING, CREATE_ELEMENT_IDS.typeHint)}
              className="h-11"
            />
            <p id={CREATE_ELEMENT_IDS.typeHint} className="text-sm text-muted-foreground">
              {t('signup.setup.typeHint')}
            </p>
          </div>
          <TimezoneField screen={screen} describedBy={describedBy(TIMEZONE_UNCONFIRMED, CREATE_ELEMENT_IDS.timezoneHint)} />
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t('signup.setup.locale')}</p>
            <p>{t('signup.setup.localeValue')}</p>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t('signup.setup.leaveStart')}</legend>
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
              <div className="grid min-w-0 gap-1">
                <Label htmlFor={CREATE_FIELD_IDS.LEAVE_START_MISSING}>{t('signup.setup.leaveDay')}</Label>
                <Select
                  id={CREATE_FIELD_IDS.LEAVE_START_MISSING}
                  name="leave-year-start-day"
                  value={screen.leaveDay}
                  onChange={screen.leaveDayChosen}
                  aria-invalid={refused(LEAVE_START_MISSING)}
                  aria-describedby={describedBy(LEAVE_START_MISSING)}
                  className="h-11"
                >
                  <option value={NOTHING_CHOSEN}>{t('signup.setup.choose')}</option>
                  {LEAVE_START_DAY_OPTIONS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid min-w-0 gap-1">
                <Label htmlFor={CREATE_ELEMENT_IDS.leaveMonth}>{t('signup.setup.leaveMonth')}</Label>
                <Select
                  id={CREATE_ELEMENT_IDS.leaveMonth}
                  name="leave-year-start-month"
                  value={screen.leaveMonth}
                  onChange={screen.leaveMonthChosen}
                  aria-invalid={refused(LEAVE_START_MISSING)}
                  aria-describedby={describedBy(LEAVE_START_MISSING)}
                  className="h-11"
                >
                  <option value={NOTHING_CHOSEN}>{t('signup.setup.choose')}</option>
                  {LEAVE_START_MONTH_OPTIONS.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </fieldset>
        </CardContent>
      </Card>
      <Card className="w-full min-w-0">
        <CardHeader>
          <CardTitle asChild>
            <h2>{t('signup.setup.adminHeading')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor={CREATE_FIELD_IDS.ADMIN_NAME_MISSING}>{t('signup.setup.adminName')}</Label>
            <Input
              id={CREATE_FIELD_IDS.ADMIN_NAME_MISSING}
              name="admin-name"
              autoComplete="name"
              maxLength={NAME_MAX_LENGTH}
              value={screen.adminName}
              onChange={screen.adminNameInput}
              aria-invalid={refused(ADMIN_NAME_MISSING)}
              aria-describedby={describedBy(ADMIN_NAME_MISSING)}
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={CREATE_FIELD_IDS.ALLOWANCE_INVALID}>{t('signup.setup.allowance')}</Label>
            <Input
              id={CREATE_FIELD_IDS.ALLOWANCE_INVALID}
              name="admin-leave-allowance"
              inputMode="numeric"
              maxLength={ALLOWANCE_MAX_LENGTH}
              value={screen.allowance}
              onChange={screen.allowanceInput}
              aria-invalid={refused(ALLOWANCE_INVALID)}
              aria-describedby={describedBy(ALLOWANCE_INVALID, CREATE_ELEMENT_IDS.allowanceHint)}
              className="h-11"
            />
            <p id={CREATE_ELEMENT_IDS.allowanceHint} className="text-sm text-muted-foreground">
              {t('signup.setup.allowanceHint')}
            </p>
          </div>
          <p className="min-w-0 break-words text-sm">{t('signup.setup.signedInAs', { email })}</p>
        </CardContent>
      </Card>
      {screen.refusals.length === 0 ? null : (
        <Notice id={CREATE_ELEMENT_IDS.refusal} role="alert" className="grid gap-1">
          {screen.refusals.map((refusal) => (
            <span key={refusal}>{t(organizationRefusalMessageKey(refusal))}</span>
          ))}
        </Notice>
      )}
      {screen.failure === null ? null : <Notice role="alert">{t(screen.failure)}</Notice>}
      <OfflineWriteNote gate={gate} />
      <Button
        type="submit"
        className="h-11 w-full aria-disabled:opacity-50"
        aria-disabled={gate.disabled || screen.pending}
        aria-describedby={gate.describedBy()}
        aria-busy={screen.pending}
      >
        {screen.pending ? t('signup.setup.pending') : t('signup.setup.submit')}
      </Button>
    </form>
  );
}

/**
 * *Vremenska zona* (D11): the device's zone with *Potvrdi* and *Odaberi
 * drugu*, or, once another is wanted or the device names none, a list with
 * nothing selected. Locked afterwards, and the hint says so.
 */
function TimezoneField({
  screen,
  describedBy,
}: {
  readonly screen: CreateOrganizationScreenState;
  readonly describedBy: string | undefined;
}): ReactNode {
  const { proposedZone, timezone, choosingZone, zones } = screen;

  return (
    <div className="grid gap-2">
      {choosingZone || proposedZone === null ? (
        <>
          <Label htmlFor={CREATE_FIELD_IDS.TIMEZONE_UNCONFIRMED}>{t('signup.setup.timezone')}</Label>
          <Select
            id={CREATE_FIELD_IDS.TIMEZONE_UNCONFIRMED}
            name="timezone"
            value={timezone ?? NOTHING_CHOSEN}
            onChange={screen.zoneChosen}
            aria-invalid={screen.refusals.includes(TIMEZONE_UNCONFIRMED) || screen.zoneRefused}
            aria-describedby={describedBy}
            className="h-11"
          >
            <option value={NOTHING_CHOSEN}>{t('signup.setup.choose')}</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">{t('signup.setup.timezone')}</p>
          <p className="min-w-0 break-words">
            {timezone === null
              ? t('signup.setup.timezoneDevice', { zone: proposedZone })
              : t('signup.setup.timezoneConfirmed', { zone: timezone })}
          </p>
          <div className="flex flex-wrap gap-3">
            {timezone === null ? (
              <Button
                id={CREATE_FIELD_IDS.TIMEZONE_UNCONFIRMED}
                type="button"
                variant="outline"
                className="h-11"
                aria-describedby={describedBy}
                onClick={screen.confirmZone}
              >
                {t('signup.setup.timezoneConfirm')}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="h-11" onClick={screen.chooseOtherZone}>
              {t('signup.setup.timezoneChoose')}
            </Button>
          </div>
        </>
      )}
      <p id={CREATE_ELEMENT_IDS.timezoneHint} className="text-sm text-muted-foreground">
        {t('signup.setup.timezoneHint')}
      </p>
    </div>
  );
}
