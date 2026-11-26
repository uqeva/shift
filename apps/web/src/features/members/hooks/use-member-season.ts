import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { organizationLeaveRequestsReadOptions } from '@/features/leave/hooks/use-organization-leave-requests';
import type { MemberScreen } from '@/features/members/hooks/member-edit-context';
import { MEMBERS_LIST_KEY, membersTodayOf, type MemberListRow } from '@/features/members/services/list';
import {
  MEMBER_CHANGE_SEASON,
  memberErasureCheckOf,
  type MemberChange,
} from '@/features/members/services/member-erasures';
import {
  SEASON_END_BEFORE_START,
  SEASON_END_TOO_LATE,
  seasonClosedRequestsOf,
  seasonEarliestOf,
  seasonLeavesNoAdmin,
  seasonPlanOf,
  seasonRefusalIsDates,
  writeSeason,
  type SeasonRow,
  type SeasonTable,
  type SeasonWriteFailure,
} from '@/features/members/services/season';
import {
  MEMBER_STATUS_SELF,
  MEMBER_STATUS_STALE,
  MEMBER_WRITE_UNAVAILABLE,
  ORGANIZATION_WOULD_HAVE_NO_ADMIN,
} from '@/features/members/services/wire';
import { MEMBER_STATUS_TABLE, statusBlockKey } from '@/features/members/services/write';
import { MEMBERSHIP_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';
import { NO_TEXT } from '@/utils/text';

/** What a season's check and write stand on: the member, the entered range, its rows and the history they were planned on. */
export interface SeasonSubject {
  readonly memberId: string;
  readonly start: string;
  readonly end: string;
  readonly rows: readonly SeasonRow[];
  readonly history: string;
  readonly change: MemberChange;
}

/**
 * *SEZONA* (story 21.11; AD-26 *Seasons*, R16.5): the status card's season
 * dialog — *Od* and *Do*, the status versions they write (shown as they are
 * entered), the member's pending requests the season closes (0041) — and its
 * save: the entry's own refusals, the last-admin rule, then AD-5's fresh
 * erasure check over the snapshot with every row applied (the shared
 * confirmation when a conflict would go), then ONE insert of every row. Built
 * as `useMemberScheduleSource`: one in-flight latch, a pending flag, a
 * refusal, the offline gate, and a landed write re-reading the list and its
 * dependents. Every rule is `@/features/members/services/season`'s.
 */
export function useMemberSeason(screen: MemberScreen) {
  const { id, today, form, organizationMembers, callerAuthUserId, latest, readErasures } = screen;
  const queryClient = useQueryClient();
  const working = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const endField = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const erasuresSave = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const [start, setStart] = useState(NO_TEXT);
  const [end, setEnd] = useState(NO_TEXT);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<SeasonWriteFailure | null>(null);
  const [unchecked, setUnchecked] = useState(false);
  const [saved, setSaved] = useState<{ readonly erased: number } | null>(null);
  const erasures = useErasureConfirmation<SeasonSubject>(pending, () => saveButton.current ?? opener.current);
  const erasureDialog = useRef(erasures);

  useEffect(() => {
    erasureDialog.current = erasures;
  });

  /** The member the page shows now: an answer for another one, after an await, is dropped. */
  const shownMember = useRef(id);

  // ANOTHER MEMBER: nothing raised for the last one stands over this one.
  useEffect(() => {
    shownMember.current = id;
    erasureDialog.current.drop();
    setOpen(false);
    setStart(NO_TEXT);
    setEnd(NO_TEXT);
    setRefusal(null);
    setUnchecked(false);
    setSaved(null);
  }, [id]);

  const member = form.member;
  /** Offered only where the status card offers anything: never the caller's own row, never on an unknown today. */
  const offered =
    member !== null && today !== null && callerAuthUserId !== null && member.authUserId !== callerAuthUserId;
  const earliest = member === null || today === null ? null : seasonEarliestOf(member.statusVersions, today);
  const plan = useMemo(
    () => (member === null || today === null ? null : seasonPlanOf(member.statusVersions, today, start, end)),
    [member, today, start, end],
  );

  // THE REQUESTS THE SEASON CLOSES, from *Za odluku*'s own read, only while the
  // dialog is open and only as answered within this opening (never a cached
  // answer from before it), as the status dialog reads them. Never a gate.
  const requestsRead = useQuery({
    ...organizationLeaveRequestsReadOptions(),
    enabled: open,
  });
  const requestsAnswered =
    open && requestsRead.data !== undefined && !requestsRead.isFetching && openedAt <= requestsRead.dataUpdatedAt;
  const closedRequests = useMemo(
    () =>
      requestsAnswered && plan !== null && plan.ok ? seasonClosedRequestsOf(requestsRead.data, id, plan.rows) : null,
    [requestsAnswered, plan, requestsRead.data, id],
  );

  /** *Sezona*: the dialog opens on the earliest start the history admits and no end. */
  function openDialog(): void {
    if (working.current || !offered || earliest === null) return;

    setStart(earliest);
    setEnd(NO_TEXT);
    setRefusal(null);
    setUnchecked(false);
    setSaved(null);
    setOpenedAt(Date.now());
    setOpen(true);
  }

  function closeDialog(): void {
    if (working.current) return;

    setOpen(false);
    setRefusal(null);
    setUnchecked(false);
    focusLater([() => opener.current], () => null);
  }

  function enterStart(value: string): void {
    setRefusal(null);
    setUnchecked(false);
    setStart(value);
  }

  function enterEnd(value: string): void {
    setRefusal(null);
    setUnchecked(false);
    setEnd(value);
  }

  /** Runs `step` under the one latch, pending while it does. */
  async function latched(step: () => Promise<void>): Promise<void> {
    if (working.current || !writesOnline()) return;

    working.current = true;
    setPending(true);

    try {
      await step();
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setRefusal(MEMBER_WRITE_UNAVAILABLE);
    } finally {
      working.current = false;
      setPending(false);
    }
  }

  /** A refusal said in the dialog, focus where it is fixed. */
  function refuse(code: SeasonWriteFailure): void {
    setRefusal(code);

    const endsWrong = code === SEASON_END_BEFORE_START || code === SEASON_END_TOO_LATE;

    focusLater(
      [() => (seasonRefusalIsDates(code) ? (endsWrong ? endField.current : startField.current) : saveButton.current)],
      () => opener.current,
    );
  }

  /** The subject of `member`'s season as entered, as at the organization's today now, or the refusal it earns. */
  function subjectOf(
    target: MemberListRow,
    members: readonly MemberListRow[],
  ):
    { readonly ok: true; readonly subject: SeasonSubject } | { readonly ok: false; readonly code: SeasonWriteFailure } {
    const on = membersTodayOf(members, new Date()) ?? today;

    if (on === null) return { ok: false, code: MEMBER_WRITE_UNAVAILABLE };
    if (target.authUserId === callerAuthUserId) return { ok: false, code: MEMBER_STATUS_SELF };

    const planned = seasonPlanOf(target.statusVersions, on, start, end);

    if (!planned.ok) return planned;
    if (seasonLeavesNoAdmin(target, members, planned.rows))
      return { ok: false, code: ORGANIZATION_WOULD_HAVE_NO_ADMIN };

    const first = planned.rows[0];

    if (first === undefined) return { ok: false, code: MEMBER_WRITE_UNAVAILABLE };

    return {
      ok: true,
      subject: {
        memberId: target.id,
        start,
        end,
        rows: planned.rows,
        history: statusBlockKey(target),
        change: {
          kind: MEMBER_CHANGE_SEASON,
          memberId: target.id,
          day: first.effectiveFrom,
          versions: planned.rows,
        },
      },
    };
  }

  async function write(subject: SeasonSubject, erased: number): Promise<void> {
    const { member: current, members, caller } = latest.current;
    const on = membersTodayOf(members, new Date());

    if (current === null || current.id !== subject.memberId || caller === null || on === null) {
      setRefusal(MEMBER_WRITE_UNAVAILABLE);

      return;
    }

    const outcome = await writeSeason(
      supabaseClient().from(MEMBER_STATUS_TABLE) as unknown as SeasonTable,
      current.organizationId,
      current.id,
      subject,
      { member: current, members, callerAuthUserId: caller, today: on },
    );

    if (shownMember.current !== subject.memberId) {
      // Written for the member the dialog was about; the page shows another now.
    } else if (outcome.ok) {
      setSaved({ erased });
      setOpen(false);
      setStart(NO_TEXT);
      setEnd(NO_TEXT);
      focusLater([() => opener.current], () => null);
    } else {
      refuse(outcome.code);
    }

    // THE LIST CARRIES THE VERSIONS, re-read on a refusal too (the likeliest one is a list behind the database).
    try {
      await refreshAfterWrite(queryClient, MEMBERS_LIST_KEY, outcome.ok ? MEMBERSHIP_WRITE_DEPENDENTS : NO_DEPENDENTS);
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
    }
  }

  /** *Spremi sezonu*: the entry's refusals, the last-admin rule, the fresh erasure check, then the write. */
  function save(): Promise<void> {
    return latched(async () => {
      setRefusal(null);
      setUnchecked(false);
      setSaved(null);

      if (member === null) return;

      const asked = subjectOf(member, organizationMembers);

      if (!asked.ok) {
        refuse(asked.code);

        return;
      }

      const { subject } = asked;

      const check = await memberErasureCheckOf(readErasures.readAndShare, subject.change, onlineManager.isOnline());

      if (shownMember.current !== subject.memberId) return;

      if (check.kind === CHECK_UNAVAILABLE) {
        if (writesOnline()) setUnchecked(true);
        focusLater([() => saveButton.current], () => opener.current);

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        refuse(MEMBER_STATUS_STALE);
        await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });

        return;
      }

      if (check.rows.length > 0) {
        erasures.show(check.rows, subject);

        return;
      }

      await write(subject, 0);
    });
  }

  /** The erasure confirmation's save: checked afresh, followed through the one order. */
  function confirmErasures(shown: ShownErasures<SeasonSubject>): Promise<void> {
    if (!erasures.confirmed) return Promise.resolve();

    return latched(async () => {
      const check = await memberErasureCheckOf(
        readErasures.readAndShare,
        shown.subject.change,
        onlineManager.isOnline(),
      );

      await erasures.follow(shown, check, {
        stopped: () => {
          const current = latest.current.member;

          if (
            current !== null &&
            current.id === shown.subject.memberId &&
            statusBlockKey(current) === shown.subject.history
          ) {
            return false;
          }

          erasures.drop();
          refuse(MEMBER_STATUS_STALE);

          return true;
        },
        unavailable: () => {
          erasures.drop();
          if (writesOnline()) setUnchecked(true);
        },
        refused: () => {
          erasures.drop();
          refuse(MEMBER_STATUS_STALE);
        },
        write: async ({ rows }, subject) => {
          erasures.drop();
          await write(subject, rows.length);
        },
      });
    });
  }

  return {
    /** Whether the status card offers *Sezona* now. */
    offered: offered && earliest !== null,
    earliest,
    open,
    start,
    end,
    plan,
    closedRequests,
    pending,
    refusal,
    unchecked,
    saved,
    erasures,
    opener,
    startField,
    endField,
    saveButton,
    erasuresSave,
    openDialog,
    closeDialog,
    enterStart,
    enterEnd,
    save,
    confirmErasures,
  };
}

export type MemberSeason = ReturnType<typeof useMemberSeason>;
