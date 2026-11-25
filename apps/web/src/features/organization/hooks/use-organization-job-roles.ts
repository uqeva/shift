import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  JOB_ROLES_LIST_KEY,
  JOB_ROLES_TABLE,
  jobRolesNoticeOf,
  jobRolesQueryOptions,
  jobRolesSurfaceStateOf,
  type JobRoleRow,
  type JobRolesFailure,
} from '@/features/job-roles/services/list';
import {
  JOB_ROLE_STALE,
  JOB_ROLE_WRITE_REFUSED,
  JOB_ROLE_WRITE_UNAVAILABLE,
  createJobRole,
  enteredJobRoleOf,
  jobRoleArchiveSavedOf,
  jobRoleSavedOf,
  renameJobRole,
  setJobRoleArchived,
  type JobRoleSaved,
  type JobRoleWriteFailure,
  type JobRoleWriteOutcome,
  type JobRoleWriteTable,
} from '@/features/job-roles/services/write';
import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import {
  ORGANIZATION_SURFACE_KEYS,
  organizationNoteZoneOf,
  organizationRefusalOf,
} from '@/features/organization/services/surface-keys';
import {
  ORGANIZATION_JOB_ROLES_HEADING_ID,
  ORGANIZATION_JOB_ROLE_NAME_FIELD_ID,
  ORGANIZATION_JOB_ROLE_SAVE_ID,
} from '@/features/organization/utils/element-ids';
import { JOB_ROLE_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { claimedOrganizationOf } from '@/lib/supabase/claims';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * One opening of the job role dialog: the role it renames (`null` adds one)
 * and a fresh key, so each opening draws its form afresh.
 */
export interface JobRoleOpening {
  readonly key: number;
  readonly role: JobRoleRow | null;
}

/** An archive's or a restore's refusal, and the role whose row it is about. */
export interface JobRoleRowFailure {
  readonly role: JobRoleRow;
  readonly code: JobRoleWriteFailure;
}

/** The element whose id this is, for a focus target. */
function byId(id: string): () => HTMLElement | null {
  return () => document.getElementById(id);
}

/**
 * *Poslovi* on *Organizacija* (story 21.12): the organization's job roles,
 * read once, the one dialog that adds or renames a role, and each row's
 * archive or restore.
 *
 * PART OF THE PAGE'S ONE SNAPSHOT, as `useOrganizationAbsenceTypes`:
 * `JOB_ROLES_LIST_KEY` is one of `ORGANIZATION_SURFACE_KEYS`, so the card is
 * drawn with the others or the page is unavailable as one.
 *
 * WRITES TOUCH `job_roles` ONLY. A landed write re-reads its key and
 * `JOB_ROLE_WRITE_DEPENDENTS` (the members list and the calendar snapshot,
 * which name each member's role). A refusal re-reads its own key alone, and
 * only when it is stale. Every rule is `@/features/job-roles/services/*`'s;
 * this hook holds state and wiring only.
 */
export function useOrganizationJobRoles() {
  const queryClient = useQueryClient();
  const openings = useRef(0);
  // A REF as well as state, for the reason `useOrganizationAbsenceTypes` gives.
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState<JobRoleOpening | null>(null);
  /** The dialog's refusal. */
  const [failure, setFailure] = useState<JobRoleWriteFailure | null>(null);
  /** An archive's or a restore's refusal, said on the card, with the role it is about. */
  const [rowFailure, setRowFailure] = useState<JobRoleRowFailure | null>(null);
  const [saved, setSaved] = useState<JobRoleSaved | null>(null);

  const answerRead = useQuery(jobRolesQueryOptions(() => supabaseClient().from(JOB_ROLES_TABLE)));
  const row = queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY);
  const { answerOf } = useSnapshotFreshness(
    ORGANIZATION_SURFACE_KEYS,
    [[JOB_ROLES_LIST_KEY, answerRead]],
    organizationNoteZoneOf(row),
  );

  const refusedPage = organizationRefusalOf(row) !== null;
  const state = jobRolesSurfaceStateOf(answerOf(answerRead));
  const roles: readonly JobRoleRow[] | null = refusedPage ? null : state.roles;
  const refusal: JobRolesFailure | null = refusedPage ? null : jobRolesNoticeOf(state);
  const loading = !refusedPage && state.loading;

  function open(role: JobRoleRow | null): void {
    if (saving.current) return;

    setFailure(null);
    setRowFailure(null);
    setSaved(null);
    openings.current += 1;
    setOpening({ key: openings.current, role });
  }

  function close(): void {
    if (saving.current) return;

    setOpening(null);
    setFailure(null);
  }

  function focusName(): void {
    focusLater(
      [byId(ORGANIZATION_JOB_ROLE_NAME_FIELD_ID), byId(ORGANIZATION_JOB_ROLE_SAVE_ID)],
      byId(ORGANIZATION_JOB_ROLES_HEADING_ID),
    );
  }

  function focusSaveAgain(): void {
    focusLater([byId(ORGANIZATION_JOB_ROLE_SAVE_ID)], byId(ORGANIZATION_JOB_ROLES_HEADING_ID));
  }

  /** The re-read after a landed write: not awaited, its failure logged, never the write's. */
  function refreshLanded(): void {
    refreshAfterWrite(queryClient, JOB_ROLES_LIST_KEY, JOB_ROLE_WRITE_DEPENDENTS).catch((cause: unknown) => {
      console.error(JOB_ROLE_WRITE_UNAVAILABLE, cause);
    });
  }

  /**
   * The dialog's Spremi: the name as entered, checked first, then an insert
   * for a new role (its tenant the session's own claim) or a rename of the
   * one being edited. A refusal keeps the dialog open with what was entered.
   */
  async function save(name: string): Promise<void> {
    if (opening === null || saving.current) return;
    if (!writesOnline()) return;

    const { role } = opening;
    const entered = enteredJobRoleOf(name);

    if (!entered.ok) {
      setFailure(entered.code);
      focusName();

      return;
    }

    saving.current = true;
    setFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const client = supabaseClient();
      const table = client.from(JOB_ROLES_TABLE) as unknown as JobRoleWriteTable;
      let outcome: JobRoleWriteOutcome;

      if (role === null) {
        const { data } = await client.auth.getSession();
        const organization = claimedOrganizationOf(data.session?.access_token);

        outcome =
          organization === null
            ? { ok: false, code: JOB_ROLE_WRITE_REFUSED }
            : await createJobRole(table, organization, name);
      } else {
        outcome = await renameJobRole(table, role, name);
      }

      if (!outcome.ok && droppedOffline(outcome.code, JOB_ROLE_WRITE_UNAVAILABLE)) {
        focusSaveAgain();

        return;
      }

      if (!outcome.ok) {
        setFailure(outcome.code);
        focusName();
        if (outcome.code === JOB_ROLE_STALE) void refreshAfterWrite(queryClient, JOB_ROLES_LIST_KEY, NO_DEPENDENTS);

        return;
      }

      setOpening(null);
      setSaved(jobRoleSavedOf(role));
      refreshLanded();
    } catch (cause) {
      console.error(JOB_ROLE_WRITE_UNAVAILABLE, cause);
      if (!writesOnline()) {
        focusSaveAgain();

        return;
      }
      setFailure(JOB_ROLE_WRITE_UNAVAILABLE);
      focusName();
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /**
   * A row's *Arhiviraj* or *Vrati*: one write, no dialog — an archive is
   * reversible and a restore is the archive undone. The outcome is said on
   * the card; a restore over a live role of the same name is the name taken.
   */
  async function setArchived(role: JobRoleRow, archived: boolean): Promise<void> {
    if (saving.current) return;
    if (!writesOnline()) return;

    saving.current = true;
    setRowFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const table = supabaseClient().from(JOB_ROLES_TABLE) as unknown as JobRoleWriteTable;
      const outcome = await setJobRoleArchived(table, role, archived);

      if (!outcome.ok && droppedOffline(outcome.code, JOB_ROLE_WRITE_UNAVAILABLE)) return;

      if (!outcome.ok) {
        setRowFailure({ role, code: outcome.code });
        if (outcome.code === JOB_ROLE_STALE) void refreshAfterWrite(queryClient, JOB_ROLES_LIST_KEY, NO_DEPENDENTS);

        return;
      }

      setSaved(jobRoleArchiveSavedOf(archived));
      refreshLanded();
    } catch (cause) {
      console.error(JOB_ROLE_WRITE_UNAVAILABLE, cause);
      if (writesOnline()) setRowFailure({ role, code: JOB_ROLE_WRITE_UNAVAILABLE });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return { roles, refusal, loading, opening, pending, failure, rowFailure, saved, open, close, save, setArchived };
}

/** What the *Poslovi* card is drawn from. */
export type OrganizationJobRoles = ReturnType<typeof useOrganizationJobRoles>;
