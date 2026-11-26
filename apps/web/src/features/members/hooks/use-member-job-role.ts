import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  JOB_ROLES_TABLE,
  chosenJobRoleId,
  jobRoleOptionsFor,
  jobRolesQueryOptions,
} from '@/features/job-roles/services/list';
import { MEMBERS_LIST_KEY, MEMBERS_TABLE, type MemberListRow } from '@/features/members/services/list';
import {
  MEMBER_WRITE_UNAVAILABLE,
  saveMember,
  type MemberFunctions,
  type MemberWriteRefusal,
} from '@/features/members/services/write';
import { MEMBER_JOB_ROLE_SAVE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * ONE MEMBER'S *POSAO*, SAVED ON CHANGE (story 21.26): *Timovi i raspored*'s
 * inline picker. The member page's basics dialog sets the role among other
 * fields (story 21.12); this writes it alone, through the same `saveMember`
 * with `{ jobRoleId }` and the same re-read of everything that names a role
 * (`MEMBER_JOB_ROLE_SAVE_DEPENDENTS`). The options are the basics dialog's
 * (`jobRoleOptionsFor`: every live role, and the member's own whatever its
 * state). An unchanged pick, or one the options no longer hold, writes
 * nothing. Offline, nothing is sent.
 *
 * WHAT THE PICKER SHOWS IS WHAT IS STORED: a pick that wrote nothing (refused,
 * offline, mid-write, stale) bumps `attempt`, which the picker is keyed to,
 * so it redraws on the stored role rather than keep a choice that never landed.
 */
export function useMemberJobRole(member: MemberListRow) {
  const queryClient = useQueryClient();
  const jobRolesRead = useQuery(jobRolesQueryOptions(() => supabaseClient().from(JOB_ROLES_TABLE)));
  const roles = jobRolesRead.data ?? null;
  const options = roles === null ? null : jobRoleOptionsFor(roles, member.jobRole);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<MemberWriteRefusal | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /** The picker back on the stored role. */
  function redraw(): void {
    setAttempt((count) => count + 1);
  }

  async function save(value: string): Promise<void> {
    const jobRoleId = options === null ? undefined : chosenJobRoleId(value, options);

    if (writing.current || options === null || !writesOnline() || jobRoleId === undefined) {
      redraw();

      return;
    }
    if (jobRoleId === (member.jobRole?.id ?? null)) return;

    writing.current = true;
    setPending(true);
    setRefusal(null);
    setSaved(false);

    try {
      const outcome = await saveMember(
        supabaseClient().from(MEMBERS_TABLE),
        supabaseClient().functions as MemberFunctions,
        member,
        { jobRoleId },
      );

      if (outcome.ok) setSaved(true);
      else {
        setRefusal(outcome.refusal);
        redraw();
      }

      // RE-READ ON BOTH OUTCOMES, as the basics dialog does: a refusal most
      // likely means the list is behind the database.
      try {
        await refreshAfterWrite(queryClient, MEMBERS_LIST_KEY, MEMBER_JOB_ROLE_SAVE_DEPENDENTS);
      } catch (cause) {
        console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setRefusal({ code: MEMBER_WRITE_UNAVAILABLE, saved: false });
      redraw();
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  return { options, pending, refusal, saved, attempt, save };
}
