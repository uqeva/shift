import { SCHEDULE_SOURCE_MANUAL, SCHEDULE_SOURCE_PERSONAL, SCHEDULE_SOURCE_TEAM, type ScheduleSource } from '@shift/domain';
import type { ReactNode, SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import type { MemberScheduleSource } from '@/features/members/hooks/use-member-schedule-source';
import {
  CHANGE_CANCEL,
  CHANGE_SET,
  NO_CHOICE,
  changeFromOf,
  scheduleSourceMessageKey,
  scheduleSourceRefusalMessageKey,
  type PatternRun,
  type ScheduleSourceFact,
} from '@/features/members/services/schedule-source';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import {
  MEMBER_SCHEDULE_DIALOG_HEADING_ID,
  MEMBER_SCHEDULE_ERASURES_ID,
  MEMBER_SCHEDULE_ERROR_ID,
  MEMBER_SCHEDULE_FROM_HINT_ID,
  MEMBER_SCHEDULE_FROM_ID,
  MEMBER_SCHEDULE_HEADING_ID,
  MEMBER_SCHEDULE_PATTERN_ID,
  MEMBER_SCHEDULE_PREVIEW_HEADING_ID,
  MEMBER_SCHEDULE_SOURCE_HEADING_ID,
  MEMBER_SCHEDULE_START_HINT_ID,
  MEMBER_SCHEDULE_START_ID,
  memberScheduleRowCountId,
  memberScheduleRowTypeId,
} from '@/features/members/utils/element-ids';
import { ManualPreviewBody } from '@/features/planning/components/manual-preview-dialog';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { shownDate } from '@/utils/text';

/** The sources in the order the dialog offers them. */
const SOURCES: readonly ScheduleSource[] = [SCHEDULE_SOURCE_TEAM, SCHEDULE_SOURCE_PERSONAL, SCHEDULE_SOURCE_MANUAL];

/** A source's one-line explanation under its choice. */
function sourceHint(source: ScheduleSource): string {
  switch (source) {
    case SCHEDULE_SOURCE_TEAM:
      return t('rasporedOsobe.hint.team');
    case SCHEDULE_SOURCE_PERSONAL:
      return t('rasporedOsobe.hint.personal');
    case SCHEDULE_SOURCE_MANUAL:
      return t('rasporedOsobe.hint.manual');
  }
}

/** `Dan ×5, Slobodno ×2`. */
function runsText(runs: readonly PatternRun[], typeName: (id: string) => string): string {
  return runs.map((run) => t('rasporedOsobe.run', { type: typeName(run.shiftTypeId), count: run.count })).join(t('rasporedOsobe.runSeparator'));
}

/** One fact line: the source, its date, and a personal rotation's pattern and start. */
function factText(fact: ScheduleSourceFact, typeName: (id: string) => string): string {
  const source = t(scheduleSourceMessageKey(fact.source));
  const base = fact.effectiveFrom === null ? source : t('rasporedOsobe.since', { source, date: shownDate(fact.effectiveFrom) });

  if (fact.runs === null || fact.startStep === null) return base;

  return t('rasporedOsobe.withPattern', { base, pattern: runsText(fact.runs, typeName), step: fact.startStep });
}

/**
 * *RASPORED OSOBE* (story 21.10; UX-DR75): how the member is scheduled — by
 * their team's rotation, by their own, or only by hand — today and from a
 * scheduled date, which *Povuci* cancels. As every fact card of the page
 * (story 7.11), the header's button opens the card's own dialog, so no form
 * is mounted while it is closed; *Što se mijenja* and the erasure
 * confirmation are dialogs of their own. Everything it decides is
 * `useMemberScheduleSource`'s and `schedule-source`'s.
 */
export function MemberScheduleSourceCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const source = edit.scheduleSource;
  const gate = useWriteGate();
  const { facts } = source;
  const scheduled = facts?.scheduled ?? null;
  const dialogsOpen = source.formOpen || source.checked !== null || source.erasures.shown !== null;

  return (
    <Card className="min-w-0">
      <section aria-labelledby={MEMBER_SCHEDULE_HEADING_ID} className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={MEMBER_SCHEDULE_HEADING_ID}>{t('rasporedOsobe.title')}</h2>
          </CardTitle>
          <Button
            ref={source.opener}
            className="h-11"
            type="button"
            variant="outline"
            disabled={facts === null || source.pending}
            onClick={source.openForm}
          >
            {t('rasporedOsobe.change')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {facts === null ? (
            <p className="text-sm text-muted-foreground">{t('rasporedOsobe.unknown')}</p>
          ) : (
            <p className="text-sm">{t('rasporedOsobe.now', { fact: factText(facts.current, source.typeName) })}</p>
          )}
          {scheduled === null || scheduled.effectiveFrom === null ? null : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-sm">{t('rasporedOsobe.scheduled', { fact: factText(scheduled, source.typeName) })}</p>
              <Button
                ref={source.cancelOpener}
                className="h-11 aria-disabled:opacity-50"
                type="button"
                variant="outline"
                disabled={source.pending}
                aria-disabled={gate.disabled}
                aria-describedby={gate.describedBy()}
                aria-label={t('rasporedOsobe.cancelNamed', { date: shownDate(scheduled.effectiveFrom) })}
                onClick={() => {
                  if (!gate.online || scheduled.effectiveFrom === null) return;
                  void source.cancelScheduled(scheduled.effectiveFrom);
                }}
              >
                {t('rasporedOsobe.cancel')}
              </Button>
            </div>
          )}
          {source.saved === null || dialogsOpen ? null : (
            <p role="status" className="text-sm text-muted-foreground">
              {source.saved === CHANGE_SET ? t('rasporedOsobe.savedSet') : t('rasporedOsobe.savedCancel')}
            </p>
          )}
          {dialogsOpen || source.refusal === null ? null : (
            <Notice role="alert">{t(scheduleSourceRefusalMessageKey(source.refusal))}</Notice>
          )}
          {dialogsOpen || !source.unchecked ? null : <Notice role="alert">{t('rasporedOsobe.error.unchecked')}</Notice>}
        </CardContent>
      </section>
      <ScheduleSourceForm source={source} />
      <ScheduleSourcePreview source={source} />
      <ScheduleSourceErasures source={source} />
    </Card>
  );
}

/** The form: the source, *Vrijedi od*, and a personal rotation's pattern and start. */
function ScheduleSourceForm({ source }: { readonly source: MemberScheduleSource }): ReactNode {
  const gate = useWriteGate();
  const { draft, pending, scheduleFromField } = source;

  return (
    <Dialog
      open={source.formOpen}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) source.closeForm();
      }}
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        source.closeForm();
      }}
      aria-labelledby={MEMBER_SCHEDULE_DIALOG_HEADING_ID}
    >
      {source.formOpen ? (
        <>
          <DialogHeader closeLabel={t('rasporedOsobe.close')} onClose={source.closeForm}>
            <DialogTitle id={MEMBER_SCHEDULE_DIALOG_HEADING_ID}>{t('rasporedOsobe.title')}</DialogTitle>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!gate.online) return;
              void source.next();
            }}
          >
            <div className="grid gap-2">
              <h3 id={MEMBER_SCHEDULE_SOURCE_HEADING_ID} className="text-sm font-medium">
                {t('rasporedOsobe.sourceHeading')}
              </h3>
              <RadioGroup
                aria-labelledby={MEMBER_SCHEDULE_SOURCE_HEADING_ID}
                value={draft.source}
                onValueChange={(value) => {
                  const chosen = SOURCES.find((one) => one === value);
                  if (chosen !== undefined) source.setSource(chosen);
                }}
                disabled={pending}
              >
                {SOURCES.map((one) => (
                  <RadioRow key={one} value={one}>
                    <span className="grid gap-0.5">
                      <span className="font-medium">{t(scheduleSourceMessageKey(one))}</span>
                      <span className="text-muted-foreground">{sourceHint(one)}</span>
                    </span>
                  </RadioRow>
                ))}
              </RadioGroup>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={MEMBER_SCHEDULE_FROM_ID}>{t('rasporedOsobe.from')}</Label>
              <Input
                ref={scheduleFromField}
                id={MEMBER_SCHEDULE_FROM_ID}
                type="date"
                value={draft.effectiveFrom}
                readOnly={pending}
                aria-describedby={MEMBER_SCHEDULE_FROM_HINT_ID}
                onChange={(event) => {
                  source.setEffectiveFrom(event.currentTarget.value);
                }}
                className="h-11 min-w-0"
              />
              <p id={MEMBER_SCHEDULE_FROM_HINT_ID} className="text-sm text-muted-foreground">
                {t('rasporedOsobe.fromHint')}
              </p>
            </div>
            {draft.source === SCHEDULE_SOURCE_PERSONAL ? <PatternFields source={source} /> : null}
            {source.refusal === null ? null : (
              <Notice id={MEMBER_SCHEDULE_ERROR_ID} role="alert">
                {t(scheduleSourceRefusalMessageKey(source.refusal))}
              </Notice>
            )}
            {source.unchecked ? <Notice role="alert">{t('rasporedOsobe.error.unchecked')}</Notice> : null}
            <OfflineWriteNote gate={gate} />
            <DialogFooter>
              <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={source.closeForm}>
                {t('rasporedOsobe.dismiss')}
              </Button>
              <Button
                ref={source.nextButton}
                className="h-11 aria-disabled:opacity-50"
                type="submit"
                disabled={pending}
                aria-disabled={gate.disabled}
                aria-describedby={gate.describedBy()}
                aria-busy={pending}
              >
                {t('rasporedOsobe.next')}
              </Button>
            </DialogFooter>
          </form>
        </>
      ) : null}
    </Dialog>
  );
}

/** A personal rotation's pattern — one the organization holds, or new step rows — and its start step. */
function PatternFields({ source }: { readonly source: MemberScheduleSource }): ReactNode {
  const { draft, pending, sequence, scheduleCountField } = source;
  const isNew = draft.patternId === source.newPattern;

  return (
    <>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={MEMBER_SCHEDULE_PATTERN_ID}>{t('rasporedOsobe.pattern')}</Label>
        <Select
          id={MEMBER_SCHEDULE_PATTERN_ID}
          className="h-11"
          value={draft.patternId ?? NO_CHOICE}
          disabled={pending}
          onChange={(event) => {
            const value = event.currentTarget.value;
            source.setPattern(value === NO_CHOICE ? null : value);
          }}
        >
          <option value={NO_CHOICE}>{t('rasporedOsobe.choose')}</option>
          {source.patterns.map((option) => (
            <option key={option.patternId} value={option.patternId}>
              {runsText(option.runs, source.typeName)}
            </option>
          ))}
          <option value={source.newPattern}>{t('rasporedOsobe.newPattern')}</option>
        </Select>
      </div>
      {isNew ? (
        <fieldset className="grid min-w-0 gap-3">
          <legend className="mb-2 text-sm font-medium">{t('rasporedOsobe.steps')}</legend>
          {draft.rows.map((row, index) => (
            // Rows have no identity of their own but their place; a removal re-reads every row's values.
            <div key={index} className="flex min-w-0 flex-wrap items-end gap-2">
              <div className="grid min-w-0 flex-1 gap-1">
                <Label htmlFor={memberScheduleRowTypeId(index)}>{t('rasporedOsobe.stepType', { position: index + 1 })}</Label>
                <Select
                  id={memberScheduleRowTypeId(index)}
                  className="h-11"
                  value={row.shiftTypeId}
                  disabled={pending}
                  onChange={(event) => {
                    source.setRow(index, { shiftTypeId: event.currentTarget.value });
                  }}
                >
                  <option value={NO_CHOICE}>{t('rasporedOsobe.choose')}</option>
                  {source.types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid w-24 gap-1">
                <Label htmlFor={memberScheduleRowCountId(index)}>{t('rasporedOsobe.stepCount', { position: index + 1 })}</Label>
                <Input
                  ref={scheduleCountField}
                  id={memberScheduleRowCountId(index)}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={row.count}
                  readOnly={pending}
                  onChange={(event) => {
                    source.setRow(index, { count: event.currentTarget.value });
                  }}
                  className="h-11"
                />
              </div>
              {draft.rows.length === 1 ? null : (
                <Button
                  className="h-11"
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    source.removeRow(index);
                  }}
                >
                  {t('rasporedOsobe.removeStep', { position: index + 1 })}
                </Button>
              )}
            </div>
          ))}
          <Button className="h-11 justify-self-start" type="button" variant="outline" disabled={pending} onClick={source.addRow}>
            {t('rasporedOsobe.addStep')}
          </Button>
        </fieldset>
      ) : null}
      {sequence === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={MEMBER_SCHEDULE_START_ID}>{t('rasporedOsobe.start')}</Label>
          <Select
            id={MEMBER_SCHEDULE_START_ID}
            className="h-11"
            value={String(draft.startStep)}
            disabled={pending}
            aria-describedby={MEMBER_SCHEDULE_START_HINT_ID}
            onChange={(event) => {
              source.setStartStep(Number(event.currentTarget.value));
            }}
          >
            {sequence.map((shiftTypeId, day) => (
              // A day of the cycle is its place in it.
              <option key={day} value={String(day)}>
                {t('rasporedOsobe.startOption', { day: day + 1, name: source.typeName(shiftTypeId) })}
              </option>
            ))}
          </Select>
          <p id={MEMBER_SCHEDULE_START_HINT_ID} className="text-sm text-muted-foreground">
            {t('rasporedOsobe.startHint')}
          </p>
        </div>
      )}
    </>
  );
}

/** *Što se mijenja*: what the fresh check derived for the version, or for its cancel. */
function ScheduleSourcePreview({ source }: { readonly source: MemberScheduleSource }): ReactNode {
  const gate = useWriteGate();
  const checked = source.checked;

  return (
    <Dialog
      open={checked !== null}
      dismissible={!source.pending}
      onOpenChange={(next) => {
        if (!next) source.closePreview();
      }}
      aria-labelledby={MEMBER_SCHEDULE_PREVIEW_HEADING_ID}
    >
      {checked === null ? null : (
        <>
          <DialogHeader closeLabel={t('rasporedOsobe.close')} onClose={source.closePreview}>
            <DialogTitle id={MEMBER_SCHEDULE_PREVIEW_HEADING_ID}>{t('rasporedOsobe.preview.title')}</DialogTitle>
            <DialogDescription>
              {checked.change.kind === CHANGE_CANCEL
                ? t('rasporedOsobe.preview.ledeCancel', { date: shownDate(changeFromOf(checked.change)) })
                : t('rasporedOsobe.preview.ledeSet', {
                    date: shownDate(changeFromOf(checked.change)),
                    source: t(scheduleSourceMessageKey(checked.change.resolved.version.source)),
                  })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60svh] gap-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              {t('rasporedOsobe.preview.window', { from: shownDate(checked.window.from), to: shownDate(checked.window.to) })}
            </p>
            <ManualPreviewBody preview={checked.preview} />
            <ShortStaffedBlock report={checked.shortStaffed} />
          </div>
          <OfflineWriteNote gate={gate} />
          <DialogFooter>
            <Button className="h-11" type="button" variant="outline" disabled={source.pending} onClick={source.closePreview}>
              {t('rasporedOsobe.preview.back')}
            </Button>
            <Button
              ref={source.confirmButton}
              className="h-11 aria-disabled:opacity-50"
              type="button"
              disabled={source.pending}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              aria-busy={source.pending}
              onClick={() => {
                if (!gate.online) return;
                void source.confirm();
              }}
            >
              {checked.change.kind === CHANGE_CANCEL ? t('rasporedOsobe.preview.cancelSave') : t('rasporedOsobe.preview.save')}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

/** THE SAVE'S ERASURE DIALOG (AD-5): the shared `ErasureDialog`, one row per conflict the change would erase. */
function ScheduleSourceErasures({ source }: { readonly source: MemberScheduleSource }): ReactNode {
  const gate = useWriteGate();
  const shown = source.erasures.shown;

  if (shown === null) return null;

  return (
    <ErasureDialog
      saveButton={source.erasuresSave}
      id={MEMBER_SCHEDULE_ERASURES_ID}
      rows={shown.rows}
      changed={shown.changed}
      decisions={source.erasures.decisions}
      busy={source.pending}
      firstErasure={source.erasures.firstErasure}
      copy={memberErasureCopyOf(shown.rows, t('rasporedOsobe.preview.save'))}
      scrollRows
      gate={gate}
      onDecide={source.erasures.decide}
      onBack={source.erasures.close}
      onSave={() => {
        void source.confirmErasures(shown);
      }}
    />
  );
}
