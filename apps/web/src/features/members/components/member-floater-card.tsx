import type { ReactNode, SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { useMemberFloater, type MemberFloater } from '@/features/members/hooks/use-member-floater';
import { floaterFactsLineOf, floaterRefusalMessageKey, type FloaterFacts } from '@/features/members/services/floater';
import type { MemberListRow } from '@/features/members/services/list';
import {
  MEMBER_FLOATER_DIALOG_HEADING_ID,
  MEMBER_FLOATER_ERROR_ID,
  MEMBER_FLOATER_FLAG_HINT_ID,
  MEMBER_FLOATER_FLAG_ID,
  MEMBER_FLOATER_HEADING_ID,
  MEMBER_FLOATER_ROLES_HINT_ID,
  memberFloaterRoleId,
} from '@/features/members/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/** The card's one line: no floater, a floater for anyone with no role, or the roles they cover. */
function factsText(facts: FloaterFacts): string {
  const line = floaterFactsLineOf(facts);

  return line.values === undefined ? t(line.key) : t(line.key, line.values);
}

/** The roles' boxes: loading or unreadable, none in the organization, or one box per role offered. */
function RoleBoxes({ floater }: { readonly floater: MemberFloater }): ReactNode {
  const { draft, options } = floater;

  if (draft === null) return null;
  if (options === null || options.length === 0) {
    const empty =
      options !== null ? t('ljudi.floater.noRoles') : floater.rolesFailed ? t('ljudi.floater.rolesUnavailable') : t('ljudi.floater.rolesLoading');

    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <div className="grid min-w-0 gap-1">
      {options.map((role) => (
        <label key={role.id} htmlFor={memberFloaterRoleId(role.id)} className="flex min-h-11 items-center gap-3 text-sm">
          <input
            id={memberFloaterRoleId(role.id)}
            type="checkbox"
            className="size-5 shrink-0 accent-primary"
            checked={draft.roleIds.includes(role.id)}
            onChange={(event) => {
              floater.setRole(role.id, event.currentTarget.checked);
            }}
          />
          <span className="min-w-0 break-words">{role.name}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * *ZAMJENA* (story 21.13; UX-DR77): whether the member covers gaps, and the
 * job roles they may cover. As every fact card of the member page (story
 * 7.11), the header's button opens the card's own dialog, so no form is
 * mounted while it is closed. *Za odluku* suggests a floater by it (R16);
 * nothing else reads it. Everything it decides is `useMemberFloater`'s.
 */
export function MemberFloaterCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const member = edit.form.member;
  const floater = useMemberFloater(member);

  if (member === null || floater.facts === null) return null;

  return (
    <Card className="min-w-0">
      <section aria-labelledby={MEMBER_FLOATER_HEADING_ID} className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={MEMBER_FLOATER_HEADING_ID}>{t('ljudi.floater.title')}</h2>
          </CardTitle>
          <Button
            ref={floater.opener}
            className="h-11"
            type="button"
            variant="outline"
            aria-label={t('ljudi.floater.changeNamed', { name: member.name })}
            disabled={floater.pending}
            onClick={floater.open}
          >
            {t('ljudi.floater.change')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="min-w-0 break-words text-sm">{factsText(floater.facts)}</p>
          {floater.saved ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('ljudi.floater.saved')}
            </p>
          ) : null}
        </CardContent>
      </section>
      <MemberFloaterDialog member={member} floater={floater} />
    </Card>
  );
}

/**
 * *Zamjena* for one person on *Timovi i raspored*'s people rows (story
 * 21.13): the same dialog behind a button named for them, with every rule the
 * card's, and the polite line once it landed. The button says the person's
 * state: *Zamjena · da* for a floater, *Zamjena* otherwise.
 */
export function MemberFloaterButton({ member }: { readonly member: MemberListRow }): ReactNode {
  const floater = useMemberFloater(member);

  return (
    <>
      <Button
        ref={floater.opener}
        className="h-11"
        type="button"
        variant="outline"
        aria-label={
          member.isFloater
            ? t('postaviRaspored.people.floaterNamedOn', { name: member.name })
            : t('postaviRaspored.people.floaterNamed', { name: member.name })
        }
        disabled={floater.pending}
        onClick={floater.open}
      >
        {member.isFloater ? t('postaviRaspored.people.floaterOn') : t('postaviRaspored.people.floater')}
      </Button>
      {floater.saved ? (
        <p role="status" className="sr-only">
          {t('ljudi.floater.saved')}
        </p>
      ) : null}
      <MemberFloaterDialog member={member} floater={floater} />
    </>
  );
}

/** The dialog: *Uskače kao zamjena*, the roles they cover while it is checked, its refusal and one Spremi. */
function MemberFloaterDialog({ member, floater }: { readonly member: MemberListRow; readonly floater: MemberFloater }): ReactNode {
  const { draft, pending, refusal } = floater;
  // STORY 8.3a: offline, the save is gated and the note says why.
  const gate = useWriteGate();

  return (
    <Dialog
      open={draft !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) floater.close();
      }}
      // ESCAPE closes through the hook, never while a save is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        floater.close();
      }}
      aria-labelledby={MEMBER_FLOATER_DIALOG_HEADING_ID}
    >
      {draft === null ? null : (
        <>
          <DialogHeader closeLabel={t('ljudi.page.close')} onClose={floater.close}>
            <DialogTitle id={MEMBER_FLOATER_DIALOG_HEADING_ID}>{t('ljudi.floater.dialogHeading')}</DialogTitle>
            <DialogDescription>{member.name}</DialogDescription>
          </DialogHeader>
          <form
            method="post"
            noValidate
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!gate.online) return;
              void floater.save();
            }}
          >
            <div className="grid gap-1">
              <label htmlFor={MEMBER_FLOATER_FLAG_ID} className="flex min-h-11 items-center gap-3 text-sm font-medium">
                <input
                  id={MEMBER_FLOATER_FLAG_ID}
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={draft.isFloater}
                  aria-describedby={MEMBER_FLOATER_FLAG_HINT_ID}
                  onChange={(event) => {
                    floater.setFloater(event.currentTarget.checked);
                  }}
                />
                {t('ljudi.floater.flag')}
              </label>
              <p id={MEMBER_FLOATER_FLAG_HINT_ID} className="text-sm text-muted-foreground">
                {t('ljudi.floater.flagHint')}
              </p>
            </div>
            {draft.isFloater ? (
              <fieldset className="grid min-w-0 gap-2" aria-describedby={MEMBER_FLOATER_ROLES_HINT_ID}>
                <legend className="mb-1 text-sm font-semibold leading-none">{t('ljudi.floater.rolesLegend')}</legend>
                <p id={MEMBER_FLOATER_ROLES_HINT_ID} className="text-sm text-muted-foreground">
                  {t('ljudi.floater.rolesHint')}
                </p>
                <RoleBoxes floater={floater} />
              </fieldset>
            ) : null}
            {refusal === null ? null : (
              <Notice id={MEMBER_FLOATER_ERROR_ID} role="alert">
                {t(floaterRefusalMessageKey(refusal))}
              </Notice>
            )}
            <OfflineWriteNote gate={gate} />
            <DialogFooter>
              <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={floater.close}>
                {t('ljudi.form.cancel')}
              </Button>
              <Button
                ref={floater.saveButton}
                className="h-11 aria-disabled:opacity-50"
                type="submit"
                disabled={pending}
                aria-disabled={gate.disabled}
                aria-describedby={gate.describedBy(refusal === null ? undefined : MEMBER_FLOATER_ERROR_ID)}
                aria-busy={pending}
              >
                {t('ljudi.form.save')}
              </Button>
            </DialogFooter>
          </form>
        </>
      )}
    </Dialog>
  );
}
