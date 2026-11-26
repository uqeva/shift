import type { ScheduleSource } from '@shift/domain';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, PencilSimple, Plus, Repeat, X } from '@/components/ui/icon';
import { NO_JOB_ROLE } from '@/features/job-roles/services/list';
import type { MemberListRow } from '@/features/members/services/list';
import {
  NO_LETTER,
  SETUP_PEOPLE_HEADING_ID,
  SETUP_TYPES_HEADING_ID,
  firstRunActionMessageKey,
  firstRunHintMessageKey,
  firstRunTitleMessageKey,
  lettersByTypeOf,
  setupTeamHeadingId,
  type FirstRunEntry,
  type FirstRunStep,
  type TeamCard,
  type TeamMemberChip,
  type UnrotatedGroup,
  type UnrotatedPerson,
} from '@/features/setup/services/setup';
import type { ShiftTypeDisplayRow, ShiftTypeList } from '@/features/shift-types/services/list';
import { t } from '@/lib/i18n';
import { shownDate } from '@/utils/text';

/** A press's own button, for focus to come back to. */
type Opener = HTMLButtonElement | null;

/** A type chip's words: its letter, its name and its times, or that it is no working shift. */
function typeChipText(row: ShiftTypeDisplayRow, letter: string): string {
  const times = row.type.isWorking
    ? (row.times?.range ?? t('postaviRaspored.types.noTimes'))
    : t('postaviRaspored.types.notWorking');

  return t('postaviRaspored.types.chip', { letter, name: row.type.name, times });
}

/**
 * *TIPOVI SMJENA* (UX-DR84): every type in use as a chip — its calendar
 * letter, its name and its times (or *ne radi*) — and *Dodaj tip*, which
 * opens `/postavke-rotacije`'s own add dialog. Wraps, never scrolls sideways.
 */
export function SetupTypeStrip({ list, onAdd }: { readonly list: ShiftTypeList | null; readonly onAdd: () => void }): ReactNode {
  if (list === null) return null;

  // THE LETTERS OVER EVERY TYPE, as the team strips letter them.
  const letters = lettersByTypeOf([...list.active, ...list.archived]);

  return (
    <Card className="min-w-0">
      <section aria-labelledby={SETUP_TYPES_HEADING_ID} className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={SETUP_TYPES_HEADING_ID} tabIndex={-1}>
              {t('postaviRaspored.types.heading')}
            </h2>
          </CardTitle>
          <Button className="h-11" type="button" variant="outline" onClick={onAdd}>
            <Plus aria-hidden />
            {t('postaviRaspored.types.add')}
          </Button>
        </CardHeader>
        <CardContent>
          {list.active.length === 0 ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.types.empty')}</p> : null}
          {list.active.length === 0 ? null : (
            <ul className="flex min-w-0 flex-wrap gap-2" aria-label={t('postaviRaspored.types.heading')}>
              {list.active.map((row) => (
                <li key={row.type.id} className="min-w-0 max-w-full">
                  {/* THE CHIP: the slot's colour, and always the name as text. */}
                  <span className={`${row.chipClass} max-w-full`}>
                    <span className="truncate">{typeChipText(row, letters.get(row.type.id) ?? NO_LETTER)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

/** A team's rotation strip: one chip per step from today's, each its letter with its full name. */
function RotationStrip({ card }: { readonly card: TeamCard }): ReactNode {
  const strip = card.strip;

  return strip === null ? (
    <p className="text-sm text-muted-foreground">{t('postaviRaspored.team.noRotation')}</p>
  ) : (
    <div className="grid min-w-0 gap-1">
      <p className="text-xs text-muted-foreground">
        {strip.scheduled
          ? t('postaviRaspored.team.rotationFrom', { date: shownDate(strip.from) })
          : t('postaviRaspored.team.rotationToday')}
      </p>
      <ol className="flex min-w-0 flex-wrap gap-1" aria-label={t('postaviRaspored.team.rotationLabel', { team: card.team.name })}>
        {strip.chips.map((chip) => (
          <li key={chip.index}>
            <span className={`${chip.chipClass} min-w-9 justify-center`} title={chip.name}>
              <span aria-hidden>{chip.letter}</span>
              <span className="sr-only">{chip.name}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** *Najmanje ljudi* as the card states it: the team's own, the organization's, or none. */
function minimumText(card: TeamCard): string {
  if (card.minimum === null) return t('postaviRaspored.team.minimumNone');
  if (card.minimum.own) return t('postaviRaspored.team.minimumOwn', { count: card.minimum.value });

  return t('postaviRaspored.team.minimumOrganization', { count: card.minimum.value });
}

/** A member chip: a link to the person's page, the scheduled date, and — on the team today with nothing scheduled — ✕. */
function MemberChip({
  member,
  teamName,
  onRemove,
}: {
  readonly member: TeamMemberChip;
  readonly teamName: string;
  readonly onRemove: (memberId: string, opener: Opener) => void;
}): ReactNode {
  const removable = member.joins === null && member.leaves === null;

  return (
    <li data-member-chip className="flex min-h-11 min-w-0 max-w-full items-center rounded-full border border-input">
      <Button asChild variant="ghost" className="h-11 min-w-0 max-w-full rounded-full px-3">
        <Link to="/ljudi/$id" params={{ id: member.id }}>
          <span className="truncate">{member.name}</span>
          {member.joins === null ? null : (
            <span className="text-xs text-muted-foreground">{t('postaviRaspored.team.joins', { date: shownDate(member.joins) })}</span>
          )}
          {member.leaves === null ? null : (
            <span className="text-xs text-muted-foreground">{t('postaviRaspored.team.leaves', { date: shownDate(member.leaves) })}</span>
          )}
        </Link>
      </Button>
      {removable ? (
        <Button
          className="h-11 w-11 shrink-0 rounded-full"
          type="button"
          variant="ghost"
          aria-label={t('postaviRaspored.team.remove', { name: member.name, team: teamName })}
          onClick={(event) => {
            onRemove(member.id, event.currentTarget);
          }}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/**
 * ONE TEAM'S CARD (UX-DR84): its *Ne radi na blagdane* and *Najmanje ljudi*
 * with *Uredi tim* (the team dialog); its members as chips — each a link to
 * the person's page and, for a member on it today with nothing scheduled, a
 * 44 px ✕ (`onRemove`: the member page's team dialog with *Bez tima*
 * picked); *Dodaj člana*; and the rotation strip with *Uredi rotaciju*. A
 * scheduled join or leave carries its date.
 */
export function SetupTeamCard({
  card,
  onEdit,
  onAddMember,
  onRemove,
  onEditRotation,
}: {
  readonly card: TeamCard;
  readonly onEdit: (opener: Opener) => void;
  readonly onAddMember: (opener: Opener) => void;
  readonly onRemove: (memberId: string, opener: Opener) => void;
  readonly onEditRotation: (opener: Opener) => void;
}): ReactNode {
  const team = card.team;
  const headingId = setupTeamHeadingId(team.id);

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h3 id={headingId} tabIndex={-1} className="min-w-0 break-words">
              {team.name}
            </h3>
          </CardTitle>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            aria-label={t('postaviRaspored.team.editNamed', { team: team.name })}
            onClick={(event) => {
              onEdit(event.currentTarget);
            }}
          >
            <PencilSimple aria-hidden />
            {t('postaviRaspored.team.edit')}
          </Button>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {team.offOnHolidays ? t('postaviRaspored.team.holidaysOn') : t('postaviRaspored.team.holidaysOff')}
            </Badge>
            <Badge variant="outline">{minimumText(card)}</Badge>
          </div>
          <div className="grid min-w-0 gap-2">
            <h4 className="text-sm font-semibold">{t('postaviRaspored.team.members')}</h4>
            {card.members.length === 0 ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.team.noMembers')}</p> : null}
            {card.members.length === 0 ? null : (
              <ul className="flex min-w-0 flex-wrap gap-2" aria-label={t('postaviRaspored.team.members')}>
                {card.members.map((member) => (
                  <MemberChip key={member.id} member={member} teamName={team.name} onRemove={onRemove} />
                ))}
              </ul>
            )}
            <Button
              className="h-11 justify-self-start"
              type="button"
              variant="outline"
              aria-label={t('postaviRaspored.team.addMemberNamed', { team: team.name })}
              onClick={(event) => {
                onAddMember(event.currentTarget);
              }}
            >
              <Plus aria-hidden />
              {t('postaviRaspored.team.addMember')}
            </Button>
          </div>
          <div className="grid min-w-0 gap-2">
            <h4 className="text-sm font-semibold">{t('postaviRaspored.team.rotation')}</h4>
            <RotationStrip card={card} />
            <Button
              className="h-11 justify-self-start"
              type="button"
              variant="outline"
              aria-label={t('postaviRaspored.team.editRotationNamed', { team: team.name })}
              onClick={(event) => {
                onEditRotation(event.currentTarget);
              }}
            >
              <Repeat aria-hidden />
              {t('postaviRaspored.team.editRotation')}
            </Button>
          </div>
        </CardContent>
      </section>
    </Card>
  );
}

/** What each person's row draws beside their name: their schedule's words, *Posao*, *Raspored osobe*. */
interface PersonSlots<Fact extends { readonly source: ScheduleSource }> {
  readonly summaryOf: (fact: Fact) => string;
  readonly role: (member: MemberListRow) => ReactNode;
  readonly onSchedule: (memberId: string, opener: Opener) => void;
}

function PersonRow<Fact extends { readonly source: ScheduleSource }>({
  person,
  slots,
}: {
  readonly person: UnrotatedPerson<Fact>;
  readonly slots: PersonSlots<Fact>;
}): ReactNode {
  const { member } = person;

  return (
    <li className="grid min-w-0 gap-3 border-t py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="grid min-w-0 gap-1">
        <Link
          to="/ljudi/$id"
          params={{ id: member.id }}
          className="inline-flex min-h-11 items-center break-words font-medium underline-offset-4 hover:underline"
        >
          {member.name}
        </Link>
        <p className="text-sm text-muted-foreground">{slots.summaryOf(person.fact)}</p>
        {person.scheduled === null ? null : (
          <p className="text-sm text-muted-foreground">
            {t('postaviRaspored.people.scheduled', { fact: slots.summaryOf(person.scheduled) })}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        {slots.role(member)}
        <Button
          className="h-11"
          type="button"
          variant="outline"
          aria-label={t('postaviRaspored.people.scheduleNamed', { name: member.name })}
          onClick={(event) => {
            slots.onSchedule(member.id, event.currentTarget);
          }}
        >
          {t('postaviRaspored.people.schedule')}
        </Button>
      </div>
    </li>
  );
}

/** The section's body: loading, nobody, or the groups by role. */
function PeopleBody<Fact extends { readonly source: ScheduleSource }>({
  groups,
  slots,
}: {
  readonly groups: readonly UnrotatedGroup<Fact>[] | null;
  readonly slots: PersonSlots<Fact>;
}): ReactNode {
  return (
    <>
      {groups === null ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.loading')}</p> : null}
      {groups?.length === 0 ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.people.empty')}</p> : null}
      {(groups ?? []).map((group) => (
        <section
          key={group.role?.id ?? NO_JOB_ROLE}
          aria-label={group.role?.name ?? t('postaviRaspored.people.noRole')}
          className="grid min-w-0 gap-1"
        >
          <h3 className="text-sm font-semibold">{group.role?.name ?? t('postaviRaspored.people.noRole')}</h3>
          <ul className="grid min-w-0">
            {group.people.map((person) => (
              <PersonRow key={person.member.id} person={person} slots={slots} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * *LJUDI BEZ TURNUSA* (UX-DR84): the active people on a personal rotation or
 * manual only today, grouped by job role (*Bez posla* last). Each person
 * links to their page and shows `summaryOf` (the member page's own words for
 * their schedule) and, when a change is scheduled, that too; the page's
 * `role` slot (*Posao*, inline); and *Raspored osobe* (`onSchedule`: the
 * member page's dialog). *Postavi raspored osobe* opens it for anybody.
 */
export function SetupPeopleSection<Fact extends { readonly source: ScheduleSource }>({
  groups,
  summaryOf,
  role,
  onSchedule,
  onSet,
}: PersonSlots<Fact> & {
  readonly groups: readonly UnrotatedGroup<Fact>[] | null;
  readonly onSet: ((opener: Opener) => void) | null;
}): ReactNode {
  return (
    <Card className="min-w-0">
      <section aria-labelledby={SETUP_PEOPLE_HEADING_ID} className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <CardTitle asChild>
              <h2 id={SETUP_PEOPLE_HEADING_ID} tabIndex={-1}>
                {t('postaviRaspored.people.heading')}
              </h2>
            </CardTitle>
            <CardDescription>{t('postaviRaspored.people.lede')}</CardDescription>
          </div>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={onSet === null}
            onClick={(event) => {
              onSet?.(event.currentTarget);
            }}
          >
            {t('postaviRaspored.people.set')}
          </Button>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          <PeopleBody groups={groups} slots={{ summaryOf, role, onSchedule }} />
        </CardContent>
      </section>
    </Card>
  );
}

/** One step's state: done, its action, or waiting on an earlier step. */
function StepState({
  entry,
  onAct,
}: {
  readonly entry: FirstRunEntry;
  readonly onAct: (opener: Opener) => void;
}): ReactNode {
  return (
    <>
      {entry.done ? (
        <p className="flex items-center gap-1 text-sm font-medium">
          <Check aria-hidden className="size-4" />
          {t('postaviRaspored.firstRun.done')}
        </p>
      ) : null}
      {!entry.done && !entry.next ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.firstRun.waiting')}</p> : null}
      {!entry.done && entry.next ? (
        <Button
          className="h-11"
          type="button"
          onClick={(event) => {
            onAct(event.currentTarget);
          }}
        >
          {t(firstRunActionMessageKey(entry.step))}
        </Button>
      ) : null}
    </>
  );
}

/**
 * *PRVI KORACI* (UX-DR84): while the organization lacks a type, a team,
 * somebody placed or a rotation, the four steps in their order — each done
 * (✓ *Gotovo*), the next (its action enabled, `aria-current="step"`), or
 * waiting on an earlier one. Each action is one of the page's own (`actions`).
 */
export function SetupFirstRun({
  steps,
  actions,
}: {
  readonly steps: readonly FirstRunEntry[] | null;
  /** Each step's action, by step: *Dodaj tip*, *Dodaj tim*, *Dodaj člana* (the first team), *Uredi rotaciju*. */
  readonly actions: Readonly<Record<FirstRunStep, (opener: Opener) => void>>;
}): ReactNode {
  if (steps === null) return null;

  return (
    <Card className="min-w-0">
      <section aria-labelledby="setup-first-run-heading" className="min-w-0">
        <CardHeader>
          <CardTitle asChild>
            <h2 id="setup-first-run-heading">{t('postaviRaspored.firstRun.heading')}</h2>
          </CardTitle>
          <CardDescription>{t('postaviRaspored.firstRun.lede')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid min-w-0 gap-3" aria-label={t('postaviRaspored.firstRun.listLabel')}>
            {steps.map((entry, index) => (
              <li
                key={entry.step}
                aria-current={entry.next ? 'step' : undefined}
                data-next={entry.next}
                className="grid min-w-0 gap-2 rounded-lg border p-3 data-[next=true]:border-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="grid min-w-0 gap-0.5">
                  <p className="font-semibold">
                    {t('postaviRaspored.firstRun.stepTitle', { n: index + 1, title: t(firstRunTitleMessageKey(entry.step)) })}
                  </p>
                  <p className="text-sm text-muted-foreground">{t(firstRunHintMessageKey(entry.step))}</p>
                </div>
                <StepState entry={entry} onAct={actions[entry.step]} />
              </li>
            ))}
          </ol>
        </CardContent>
      </section>
    </Card>
  );
}
