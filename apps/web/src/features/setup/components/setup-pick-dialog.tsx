import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { MEMBERS_ADD_OPEN, memberTeamOf, type MemberListRow } from '@/features/members/services/list';
import type { SetupPick } from '@/features/setup/hooks/use-setup';
import {
  NO_PICK,
  SETUP_PICK_ERROR_ID,
  SETUP_PICK_MEMBER_ID,
  activeMembersOf,
  joinableMembersOf,
} from '@/features/setup/services/setup';
import { t } from '@/lib/i18n';

/**
 * THE PERSON PICKER (story 21.26): *Dodaj člana* for one team, or *Postavi
 * raspored osobe*. One `<select>` of the people it offers — a team's add
 * offers the active people neither on it nor joining it, each with the team
 * they are on today — and *Dalje*, which hands the person on (`onPick`) to
 * the member page's own dialog: the team dialog with this team picked, or
 * *Raspored osobe*. It writes nothing. *Nova osoba* opens *Ljudi*'s add dialog.
 */
export function SetupPickDialog({
  pick,
  members,
  today,
  onPick,
  onClose,
}: {
  readonly pick: SetupPick | null;
  readonly members: readonly MemberListRow[] | null;
  readonly today: string | null;
  readonly onPick: (pick: SetupPick, member: MemberListRow) => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      open={pick !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      aria-labelledby="setup-pick-heading"
    >
      {pick === null || members === null || today === null ? null : (
        <PickBody
          key={pick.card?.team.id ?? NO_PICK}
          pick={pick}
          members={members}
          today={today}
          onPick={onPick}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

/** The picker's title and lede: a team's add, or a person's schedule. */
function PickHead({ pick, onClose }: { readonly pick: SetupPick; readonly onClose: () => void }): ReactNode {
  const card = pick.card;

  return (
    <DialogHeader closeLabel={t('postaviRaspored.pick.close')} onClose={onClose}>
      <DialogTitle id="setup-pick-heading">
        {card === null ? t('postaviRaspored.pick.scheduleTitle') : t('postaviRaspored.pick.teamTitle', { team: card.team.name })}
      </DialogTitle>
      <DialogDescription>
        {card === null ? t('postaviRaspored.pick.scheduleLede') : t('postaviRaspored.pick.teamLede')}
      </DialogDescription>
    </DialogHeader>
  );
}

function PickBody({
  pick,
  members,
  today,
  onPick,
  onClose,
}: {
  readonly pick: SetupPick;
  readonly members: readonly MemberListRow[];
  readonly today: string;
  readonly onPick: (pick: SetupPick, member: MemberListRow) => void;
  readonly onClose: () => void;
}): ReactNode {
  const [value, setValue] = useState(NO_PICK);
  const [unpicked, setUnpicked] = useState(false);
  const offered = pick.card === null ? activeMembersOf(members, today) : joinableMembersOf(members, pick.card, today);

  function next(): void {
    const member = offered.find((candidate) => candidate.id === value);

    if (member === undefined) {
      setUnpicked(true);
      document.getElementById(SETUP_PICK_MEMBER_ID)?.focus();

      return;
    }
    onPick(pick, member);
  }

  return (
    <>
      <PickHead pick={pick} onClose={onClose} />
      <form
        method="post"
        noValidate
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          next();
        }}
      >
        {offered.length === 0 ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.pick.none')}</p> : null}
        {offered.length === 0 ? null : (
          <div className="grid gap-2">
            <Label htmlFor={SETUP_PICK_MEMBER_ID}>{t('postaviRaspored.pick.label')}</Label>
            <Select
              id={SETUP_PICK_MEMBER_ID}
              name="member"
              className="h-11"
              value={value}
              aria-invalid={unpicked}
              aria-describedby={unpicked ? SETUP_PICK_ERROR_ID : undefined}
              onChange={(event) => {
                setValue(event.currentTarget.value);
                setUnpicked(false);
              }}
            >
              <option value={NO_PICK}>{t('postaviRaspored.pick.choose')}</option>
              {offered.map((member) => (
                <option key={member.id} value={member.id}>
                  {t('postaviRaspored.pick.currentTeam', {
                    name: member.name,
                    team: memberTeamOf(member, today).team?.name ?? t('smjene.membership.none'),
                  })}
                </option>
              ))}
            </Select>
          </div>
        )}
        {unpicked ? (
          <Notice id={SETUP_PICK_ERROR_ID} role="alert">
            {t('postaviRaspored.pick.unpicked')}
          </Notice>
        ) : null}
        <DialogFooter>
          <Button asChild variant="ghost" className="h-11">
            <Link to="/ljudi" search={{ dodaj: MEMBERS_ADD_OPEN }}>
              {t('postaviRaspored.pick.newPerson')}
            </Link>
          </Button>
          <Button className="h-11" type="button" variant="outline" onClick={onClose}>
            {t('postaviRaspored.pick.cancel')}
          </Button>
          <Button className="h-11" type="submit" disabled={offered.length === 0}>
            {t('postaviRaspored.pick.next')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
