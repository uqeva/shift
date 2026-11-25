import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { ManualPeopleField, chosenInOrder } from '@/features/planning/components/manual-people-field';
import { PLAN_FILL, type ManualPlanning, type ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import {
  NO_COUNT,
  REFUSED_PEOPLE,
  REFUSED_RANGE,
  REFUSED_STEP_COUNT,
  REFUSED_STEP_TYPE,
  REFUSED_TOO_LONG,
  STEP_NONE,
  STEP_OFF,
  cycleDaysOf,
  isStepCount,
  plannedRefusalMessageKey,
  type FillStepForm,
  type PlannedRefusal,
} from '@/features/planning/services/manual-fill';
import type { ManualMonth } from '@/features/planning/services/manual-grid';
import {
  FILL_FROM_ID,
  FILL_HEADING_ID,
  FILL_OFFSET_HINT_ID,
  FILL_OFFSET_ID,
  FILL_TO_ID,
  fillStepChoiceIdOf,
  fillStepCountIdOf,
} from '@/features/planning/utils/element-ids';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';

/** A step row with a stable key, so removing one keeps the others' fields. */
interface StepRow extends FillStepForm {
  readonly key: number;
}

/**
 * *POPUNI UZORKOM* (story 21.5; UX-DR74): the people, *Od* and *Do*, the
 * pattern's steps (a shift type or *Slobodno*, × a count of days) and
 * *Počni od koraka*, the day of the cycle the first date takes. *Popuni*
 * puts the days into the draft and closes; nothing is saved here, and every
 * cell stays editable. A refused field is an alert above the buttons.
 */
export function ManualFillDialog({ screen }: { readonly screen: ManualScreen }): ReactNode {
  const isPhone = usePhone();
  const planning = screen.planning;
  const open = planning !== null && planning.kind === PLAN_FILL && screen.shown !== null;

  return (
    <Dialog
      open={open}
      docked={isPhone}
      onOpenChange={(next) => {
        if (!next) screen.closePlanning();
      }}
      aria-labelledby={FILL_HEADING_ID}
    >
      {open && screen.shown !== null ? <FillBody screen={screen} planning={planning} shown={screen.shown} /> : null}
    </Dialog>
  );
}

function FillBody({
  screen,
  planning,
  shown,
}: {
  readonly screen: ManualScreen;
  readonly planning: ManualPlanning;
  readonly shown: ManualMonth;
}): ReactNode {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(planning.memberIds));
  const [from, setFrom] = useState(planning.from);
  const [to, setTo] = useState(planning.to);
  const [steps, setSteps] = useState<readonly StepRow[]>([{ key: 0, choice: STEP_NONE, count: NO_COUNT }]);
  const [offset, setOffset] = useState(0);
  const [refusal, setRefusal] = useState<PlannedRefusal | null>(null);
  const days = cycleDaysOf(steps);
  const nameOf = (choice: string): string =>
    choice === STEP_OFF ? t('rucniRaspored.fill.off') : (screen.types.find((type) => type.id === choice)?.name ?? choice);

  // A CHANGED PATTERN STARTS ON ITS FIRST DAY AGAIN (review): an offset kept
  // across an edit would point at another step than the one the admin picked.
  function change(key: number, patch: Partial<FillStepForm>): void {
    setSteps((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setOffset(0);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // A TYPE ARCHIVED SINCE IT WAS CHOSEN (a re-read) is no choice: the step is refused, never skipped day by day.
    const choices = new Set([STEP_OFF, ...screen.types.map((type) => type.id)]);

    setRefusal(
      screen.fill({
        memberIds: chosenInOrder(shown.groups, chosen),
        from,
        to,
        steps: steps.map(({ choice, count }) => ({ choice: choices.has(choice) ? choice : STEP_NONE, count })),
        offset: offset < days.length ? offset : 0,
      }),
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
        <DialogTitle id={FILL_HEADING_ID}>{t('rucniRaspored.fill.title')}</DialogTitle>
        <DialogDescription>{t('rucniRaspored.fill.lede')}</DialogDescription>
      </DialogHeader>
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
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={FILL_FROM_ID}>{t('rucniRaspored.fill.from')}</Label>
          <Input
            id={FILL_FROM_ID}
            type="date"
            className="h-11 min-w-0"
            value={from}
            aria-invalid={refusal === REFUSED_RANGE || refusal === REFUSED_TOO_LONG}
            onChange={(event) => {
              setFrom(event.currentTarget.value);
            }}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={FILL_TO_ID}>{t('rucniRaspored.fill.to')}</Label>
          <Input
            id={FILL_TO_ID}
            type="date"
            className="h-11 min-w-0"
            value={to}
            aria-invalid={refusal === REFUSED_RANGE || refusal === REFUSED_TOO_LONG}
            onChange={(event) => {
              setTo(event.currentTarget.value);
            }}
          />
        </div>
      </div>
      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-2 text-sm font-semibold leading-none">{t('rucniRaspored.fill.steps')}</legend>
        <ol className="grid min-w-0 gap-2">
          {steps.map((row, index) => {
            const position = index + 1;

            return (
              <li key={row.key} className="flex min-w-0 items-end gap-2">
                <div className="grid min-w-0 flex-1 gap-1">
                  <Label htmlFor={fillStepChoiceIdOf(position)} className="text-xs">
                    {t('rucniRaspored.fill.choice', { position })}
                  </Label>
                  <Select
                    id={fillStepChoiceIdOf(position)}
                    className="h-11"
                    value={row.choice}
                    aria-invalid={refusal === REFUSED_STEP_TYPE && row.choice === STEP_NONE}
                    onChange={(event) => {
                      change(row.key, { choice: event.currentTarget.value });
                    }}
                  >
                    <option value={STEP_NONE}>{t('rucniRaspored.fill.choose')}</option>
                    {screen.types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                    <option value={STEP_OFF}>{t('rucniRaspored.fill.off')}</option>
                  </Select>
                </div>
                <div className="grid w-20 shrink-0 gap-1">
                  <Label htmlFor={fillStepCountIdOf(position)} className="text-xs">
                    <span aria-hidden>{t('rucniRaspored.fill.times')}</span>
                    <span className="sr-only">{t('rucniRaspored.fill.count', { position })}</span>
                  </Label>
                  <Input
                    id={fillStepCountIdOf(position)}
                    className="h-11 min-w-0 tabular-nums"
                    inputMode="numeric"
                    value={row.count}
                    aria-invalid={refusal === REFUSED_STEP_COUNT && !isStepCount(row.count)}
                    onChange={(event) => {
                      change(row.key, { count: event.currentTarget.value });
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-11 shrink-0 p-0"
                  aria-label={t('rucniRaspored.fill.remove', { position })}
                  disabled={steps.length === 1}
                  onClick={() => {
                    setSteps((current) => current.filter((candidate) => candidate.key !== row.key));
                    setOffset(0);
                  }}
                >
                  <Trash aria-hidden />
                </Button>
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-self-start"
          onClick={() => {
            setSteps((current) => [...current, { key: Math.max(0, ...current.map((row) => row.key)) + 1, choice: STEP_NONE, count: NO_COUNT }]);
            setOffset(0);
          }}
        >
          {t('rucniRaspored.fill.add')}
        </Button>
      </fieldset>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={FILL_OFFSET_ID}>{t('rucniRaspored.fill.offset')}</Label>
        <Select
          id={FILL_OFFSET_ID}
          className="h-11"
          value={String(offset < days.length ? offset : 0)}
          disabled={days.length === 0}
          aria-describedby={FILL_OFFSET_HINT_ID}
          onChange={(event) => {
            setOffset(Number(event.currentTarget.value));
          }}
        >
          {days.map((day) => (
            <option key={day.day} value={String(day.day)}>
              {t('rucniRaspored.fill.offsetOption', {
                day: day.day + 1,
                position: day.step + 1,
                name: nameOf(steps[day.step]?.choice ?? STEP_NONE),
              })}
            </option>
          ))}
        </Select>
        <p id={FILL_OFFSET_HINT_ID} className="text-sm text-muted-foreground">
          {days.length === 0 ? t('rucniRaspored.fill.offsetEmpty') : t('rucniRaspored.fill.offsetHint')}
        </p>
      </div>
      {refusal === null ? null : <Notice role="alert">{t(plannedRefusalMessageKey(refusal))}</Notice>}
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" onClick={screen.closePlanning}>
          {t('rucniRaspored.plan.cancel')}
        </Button>
        <Button className="h-11" type="submit">
          {t('rucniRaspored.fill.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
