import { adjacentMonth, datesOfMonth } from '@shift/domain';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { monthHeaderOf } from '@/features/calendar/utils/month';
import { ManualPeopleField, chosenInOrder } from '@/features/planning/components/manual-people-field';
import { PLAN_COPY, type ManualPlanning, type ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import {
  COPY_MONTH,
  COPY_WEEK,
  REFUSED_PEOPLE,
  REFUSED_SAME,
  REFUSED_SOURCE,
  REFUSED_TARGET,
  mondayOf,
  plannedRefusalMessageKey,
  type CopyMode,
  type PlannedRefusal,
} from '@/features/planning/services/manual-fill';
import type { ManualMonth } from '@/features/planning/services/manual-grid';
import { COPY_HEADING_ID, COPY_MODE_ID, COPY_SOURCE_ID, COPY_TARGET_ID } from '@/features/planning/utils/element-ids';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import { datesFrom } from '@/utils/dates';

/** How far either side of the shown month *Mjesec* offers. */
const MONTHS_AROUND = 12;

/** The months around `month`, oldest first: what the two month fields offer. */
function monthsAround(month: string): readonly string[] {
  const before: string[] = [];
  const after: string[] = [];
  let back: string | null = month;
  let ahead: string | null = month;

  for (let step = 0; step < MONTHS_AROUND; step += 1) {
    back = back === null ? null : adjacentMonth(back, -1);
    ahead = ahead === null ? null : adjacentMonth(ahead, 1);
    if (back !== null) before.unshift(back);
    if (ahead !== null) after.push(ahead);
  }

  return [...before, month, ...after];
}

/**
 * *KOPIRAJ* (story 21.5; UX-DR74): *Tjedan* or *Mjesec*, the source and the
 * target start, and the people. Only assignments are copied, as the grid
 * shows them (the draft applied); a source day with none clears its target;
 * a day naming an archived shift type or team is left out and counted. The
 * days go into the draft, previewed and saved like any change.
 */
export function ManualCopyDialog({ screen }: { readonly screen: ManualScreen }): ReactNode {
  const isPhone = usePhone();
  const planning = screen.planning;
  const open = planning !== null && planning.kind === PLAN_COPY && screen.shown !== null;

  return (
    <Dialog
      open={open}
      docked={isPhone}
      onOpenChange={(next) => {
        if (!next) screen.closePlanning();
      }}
      aria-labelledby={COPY_HEADING_ID}
    >
      {open && screen.shown !== null ? <CopyBody screen={screen} planning={planning} shown={screen.shown} /> : null}
    </Dialog>
  );
}

function CopyBody({
  screen,
  planning,
  shown,
}: {
  readonly screen: ManualScreen;
  readonly planning: ManualPlanning;
  readonly shown: ManualMonth;
}): ReactNode {
  const firstMonday = mondayOf(planning.from);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(planning.memberIds));
  const [mode, setMode] = useState<CopyMode>(COPY_WEEK);
  const [week, setWeek] = useState({ source: firstMonday, target: datesFrom(firstMonday, 8)[7] ?? firstMonday });
  const [month, setMonth] = useState({ source: shown.month, target: adjacentMonth(shown.month, 1) ?? shown.month });
  const [refusal, setRefusal] = useState<PlannedRefusal | null>(null);
  const months = monthsAround(shown.month);
  const fields = mode === COPY_WEEK ? week : month;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    setRefusal(screen.copy({ mode, memberIds: chosenInOrder(shown.groups, chosen), source: fields.source, target: fields.target }));
  }

  function monthOption(value: string): ReactNode {
    const header = monthHeaderOf(value, screen.today ?? datesOfMonth(value)[0] ?? value);

    return (
      <option key={value} value={value}>
        {t('rucniRaspored.copy.monthOption', { month: header.monthName, year: header.year })}
      </option>
    );
  }

  return (
    // ANY EDIT CLEARS A REFUSAL (review): the alert speaks of the form as submitted.
    <form
      className="grid min-w-0 gap-4"
      noValidate
      onSubmit={submit}
      onChange={() => {
        setRefusal(null);
      }}
    >
      <DialogHeader closeLabel={t('rucniRaspored.plan.close')} onClose={screen.closePlanning}>
        <DialogTitle id={COPY_HEADING_ID}>{t('rucniRaspored.copy.title')}</DialogTitle>
        <DialogDescription>{t('rucniRaspored.copy.lede')}</DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 gap-2">
        <p id={COPY_MODE_ID} className="text-sm font-semibold leading-none">
          {t('rucniRaspored.copy.mode')}
        </p>
        <RadioGroup
          aria-labelledby={COPY_MODE_ID}
          className="grid-cols-2 gap-2"
          value={mode}
          onValueChange={(value) => {
            setMode(value === COPY_MONTH ? COPY_MONTH : COPY_WEEK);
            setRefusal(null);
          }}
        >
          <RadioRow value={COPY_WEEK}>{t('rucniRaspored.copy.week')}</RadioRow>
          <RadioRow value={COPY_MONTH}>{t('rucniRaspored.copy.month')}</RadioRow>
        </RadioGroup>
      </div>
      {mode === COPY_WEEK ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={COPY_SOURCE_ID}>{t('rucniRaspored.copy.sourceWeek')}</Label>
            <Input
              id={COPY_SOURCE_ID}
              type="date"
              className="h-11 min-w-0"
              value={week.source}
              aria-invalid={refusal === REFUSED_SOURCE || refusal === REFUSED_SAME}
              onChange={(event) => {
                const source = event.currentTarget.value;

                setWeek((current) => ({ ...current, source }));
              }}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={COPY_TARGET_ID}>{t('rucniRaspored.copy.targetWeek')}</Label>
            <Input
              id={COPY_TARGET_ID}
              type="date"
              className="h-11 min-w-0"
              value={week.target}
              aria-invalid={refusal === REFUSED_TARGET || refusal === REFUSED_SAME}
              onChange={(event) => {
                const target = event.currentTarget.value;

                setWeek((current) => ({ ...current, target }));
              }}
            />
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 gap-2">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={COPY_SOURCE_ID}>{t('rucniRaspored.copy.sourceMonth')}</Label>
              <Select
                id={COPY_SOURCE_ID}
                className="h-11"
                value={month.source}
                aria-invalid={refusal === REFUSED_SOURCE || refusal === REFUSED_SAME}
                onChange={(event) => {
                  const source = event.currentTarget.value;

                  setMonth((current) => ({ ...current, source }));
                }}
              >
                {months.map(monthOption)}
              </Select>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={COPY_TARGET_ID}>{t('rucniRaspored.copy.targetMonth')}</Label>
              <Select
                id={COPY_TARGET_ID}
                className="h-11"
                value={month.target}
                aria-invalid={refusal === REFUSED_TARGET || refusal === REFUSED_SAME}
                onChange={(event) => {
                  const target = event.currentTarget.value;

                  setMonth((current) => ({ ...current, target }));
                }}
              >
                {months.map(monthOption)}
              </Select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('rucniRaspored.copy.monthNote')}</p>
        </div>
      )}
      <ManualPeopleField
        groups={shown.groups}
        chosen={chosen}
        invalid={refusal === REFUSED_PEOPLE}
        onChange={(memberId, checked) => {
          setChosen((current) => {
            const next = new Set(current);

            if (checked) next.add(memberId);
            else next.delete(memberId);

            return next;
          });
        }}
      />
      {refusal === null ? null : <Notice role="alert">{t(plannedRefusalMessageKey(refusal))}</Notice>}
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" onClick={screen.closePlanning}>
          {t('rucniRaspored.plan.cancel')}
        </Button>
        <Button className="h-11" type="submit">
          {t('rucniRaspored.copy.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
