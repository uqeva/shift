import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { JOB_ROLES_TABLE, jobRolesQueryOptions } from '@/features/job-roles/services/list';
import {
  FLOATER_ROLES_TABLE,
  FLOATER_SAVE_FAILED,
  FLOATER_SAVE_STALE,
  floaterDraftChanges,
  floaterDraftOf,
  floaterDraftWithRole,
  floaterFactsOf,
  floaterRoleOptionsOf,
  floaterStaleOf,
  saveMemberFloater,
  type FloaterDraft,
  type FloaterFlagTable,
  type FloaterRolesTable,
  type FloaterSaveOutcome,
} from '@/features/members/services/floater';
import { MEMBERS_LIST_KEY, MEMBERS_TABLE, type MemberListRow } from '@/features/members/services/list';
import { MEMBER_FLOATER_SAVE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';

/** A refused save, as the dialog states it. */
export type FloaterRefusal = Extract<FloaterSaveOutcome, { readonly ok: false }>;

/**
 * ONE MEMBER AS A FLOATER (story 21.13; UX-DR77): the *Zamjena* card's facts
 * and its dialog — whether they cover gaps, and the job roles they may cover —
 * with its one save. Wiring only: every rule is
 * `@/features/members/services/floater`'s.
 *
 * THE DIALOG OPENS ON A PRESS (never on mount) on the member as stored, and
 * holds its draft until Spremi or Odustani. THE SAVE DIFFS AGAINST THE MEMBER
 * AS OPENED: if the list re-read meanwhile and their flag or roles moved
 * (another admin), nothing is written, the stale line says so and the dialog
 * re-seeds on what is stored now. Spremi with nothing changed closes
 * it and writes nothing. A save is three PostgREST calls (the flag, the
 * dropped roles, the added ones); on ANY outcome the member list is re-read
 * (`MEMBER_FLOATER_SAVE_DEPENDENTS`), so a partial save is shown as stored and
 * the next Spremi completes it. A landed save closes the dialog and leaves
 * the polite line; a refusal keeps it open with its alert and moves focus to
 * Spremi (it names no field). Offline, nothing is sent. Focus returns to the
 * button that opened it. Opening the dialog or starting a save clears the
 * saved line, so no row keeps a stale live region.
 */
export function useMemberFloater(member: MemberListRow | null) {
  const queryClient = useQueryClient();
  const rolesRead = useQuery(jobRolesQueryOptions(() => supabaseClient().from(JOB_ROLES_TABLE)));
  const roles = rolesRead.data ?? null;
  const opener = useRef<HTMLButtonElement>(null);
  /** Spremi, where a refusal that names no field sends focus. */
  const saveButton = useRef<HTMLButtonElement>(null);
  /** The member as the dialog opened on them: what a save is diffed against. */
  const [opened, setOpened] = useState<MemberListRow | null>(null);
  /** Set by a refusal: focus moves to Spremi once it is drawn. */
  const [refocus, setRefocus] = useState(false);
  const writing = useRef(false);
  /** The dialog's draft while it is open; `null` while it is closed. */
  const [draft, setDraft] = useState<FloaterDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<FloaterRefusal | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!refocus) return;

    setRefocus(false);
    saveButton.current?.focus();
  }, [refocus]);

  function open(): void {
    if (member === null) return;

    setOpened(member);
    setDraft(floaterDraftOf(member));
    setRefusal(null);
    setSaved(false);
  }

  function close(): void {
    if (writing.current) return;

    setDraft(null);
    setOpened(null);
    setRefusal(null);
    opener.current?.focus();
  }

  function setFloater(isFloater: boolean): void {
    setDraft((current) => (current === null ? null : { ...current, isFloater }));
  }

  function setRole(roleId: string, covered: boolean): void {
    setDraft((current) => (current === null ? null : floaterDraftWithRole(current, roleId, covered)));
  }

  async function save(): Promise<void> {
    if (member === null || opened === null || draft === null || writing.current || !writesOnline()) return;

    setSaved(false);

    // ANOTHER ADMIN SAVED MEANWHILE: never overwrite it; re-seed on what is stored now.
    if (floaterStaleOf(opened, member)) {
      setRefusal({ ok: false, code: FLOATER_SAVE_STALE, partial: false });
      setOpened(member);
      setDraft(floaterDraftOf(member));
      setRefocus(true);

      return;
    }

    if (!floaterDraftChanges(opened, draft)) {
      close();

      return;
    }

    writing.current = true;
    setPending(true);
    setRefusal(null);
    setSaved(false);

    let outcome: FloaterSaveOutcome;

    try {
      outcome = await saveMemberFloater(
        // Named structurally, for the reason every write is.
        supabaseClient().from(MEMBERS_TABLE) as unknown as FloaterFlagTable,
        supabaseClient().from(FLOATER_ROLES_TABLE) as unknown as FloaterRolesTable,
        opened,
        draft,
      );
    } catch (cause) {
      console.error(FLOATER_SAVE_FAILED, cause);
      outcome = { ok: false, code: FLOATER_SAVE_FAILED, partial: false };
    }

    // RE-READ ON EVERY OUTCOME: a partial save is shown as stored.
    try {
      await refreshAfterWrite(queryClient, MEMBERS_LIST_KEY, MEMBER_FLOATER_SAVE_DEPENDENTS);
    } catch (cause) {
      console.error(FLOATER_SAVE_FAILED, cause);
    }

    writing.current = false;
    setPending(false);

    if (outcome.ok) {
      setSaved(true);
      setDraft(null);
      setOpened(null);
      opener.current?.focus();
    } else {
      setRefusal(outcome);
      setRefocus(true);
    }
  }

  return {
    facts: member === null ? null : floaterFactsOf(member, roles),
    /** The roles the dialog offers, or `null` while the roles are unread. */
    options: member === null || roles === null ? null : floaterRoleOptionsOf(roles, member),
    rolesFailed: roles === null && rolesRead.isError,
    draft,
    pending,
    refusal,
    saved,
    opener,
    saveButton,
    open,
    close,
    setFloater,
    setRole,
    save,
  };
}

export type MemberFloater = ReturnType<typeof useMemberFloater>;
