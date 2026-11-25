import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { jobRolesMessageKey, type JobRoleRow } from '@/features/job-roles/services/list';
import {
  JOB_ROLE_NAME_FIELD,
  jobRoleSavedMessageKey,
  jobRoleWriteMessageKey,
  marksJobRoleName,
} from '@/features/job-roles/services/write';
import type { OrganizationJobRoles } from '@/features/organization/hooks/use-organization-job-roles';
import {
  ORGANIZATION_JOB_ROLES_ERROR_ID,
  ORGANIZATION_JOB_ROLES_HEADING_ID,
  ORGANIZATION_JOB_ROLE_DIALOG_HEADING_ID,
  ORGANIZATION_JOB_ROLE_ERROR_ID,
  ORGANIZATION_JOB_ROLE_NAME_FIELD_ID,
  ORGANIZATION_JOB_ROLE_SAVE_ID,
} from '@/features/organization/utils/element-ids';
import { NAME_MAX_LENGTH } from '@/utils/name';
import { NO_TEXT } from '@/utils/text';

/**
 * *Poslovi* (story 21.12): the organization's job roles, live ones by name,
 * then archived ones marked *arhiviran*. `Dodaj` in the header opens the one
 * name dialog; each row has `Uredi` (the same dialog) and `Arhiviraj`, or
 * `Vrati` on an archived role. Nothing deletes a role, and nothing is seeded:
 * an organization with no role sees the card with `Dodaj` alone.
 *
 * OFFLINE, every control is gated (story 8.3a): focusable, a press does
 * nothing, and the note says why.
 */
export function OrganizationJobRolesCard({ jobRoles }: { readonly jobRoles: OrganizationJobRoles }): ReactNode {
  const { roles, refusal, loading, saved, rowFailure, pending, open, setArchived } = jobRoles;
  const gate = useWriteGate();

  function renderRoles(): ReactNode {
    if (roles === null) {
      return loading ? <div aria-hidden className="h-10 w-56 max-w-full animate-pulse rounded-md bg-muted" /> : null;
    }

    if (roles.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('organization.jobRoles.none')}</p>;
    }

    return (
      <ul className="grid min-w-0 divide-y divide-border">
        {roles.map((role) => (
          <li key={role.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="grid min-w-0 gap-1">
              <span className="break-words text-sm font-medium">{role.name}</span>
              {role.archived ? (
                <span className="text-xs text-muted-foreground">{t('organization.jobRoles.archived')}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-11 aria-disabled:opacity-50"
                type="button"
                variant="outline"
                aria-label={t('organization.jobRoles.editLabel', { name: role.name })}
                aria-disabled={gate.disabled || pending}
                aria-describedby={gate.describedBy()}
                onClick={() => {
                  if (!gate.online || pending) return;
                  open(role);
                }}
              >
                {t('organization.jobRoles.edit')}
              </Button>
              <Button
                className="h-11 aria-disabled:opacity-50"
                type="button"
                variant="outline"
                aria-label={
                  role.archived
                    ? t('organization.jobRoles.restoreLabel', { name: role.name })
                    : t('organization.jobRoles.archiveLabel', { name: role.name })
                }
                aria-disabled={gate.disabled || pending}
                // Only the row whose write was refused points at the refusal, beside the gate's note.
                aria-describedby={
                  rowFailure?.role.id === role.id ? gate.describedBy(ORGANIZATION_JOB_ROLES_ERROR_ID) : gate.describedBy()
                }
                onClick={() => {
                  if (!gate.online || pending) return;
                  void setArchived(role, !role.archived);
                }}
              >
                {role.archived ? t('organization.jobRoles.restore') : t('organization.jobRoles.archive')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_JOB_ROLES_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_JOB_ROLES_HEADING_ID} tabIndex={-1}>
              {t('organization.jobRoles.heading')}
            </h2>
          </CardTitle>
          {roles === null ? null : (
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="button"
              variant="outline"
              aria-label={t('organization.jobRoles.addLabel')}
              aria-disabled={gate.disabled || pending}
              aria-describedby={gate.describedBy()}
              onClick={() => {
                if (!gate.online || pending) return;
                open(null);
              }}
            >
              {t('organization.jobRoles.add')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {refusal === null ? null : <Notice role="alert">{t(jobRolesMessageKey(refusal))}</Notice>}
          {rowFailure === null ? null : (
            <Notice id={ORGANIZATION_JOB_ROLES_ERROR_ID} role="alert">
              {t('organization.jobRoles.rowError', {
                name: rowFailure.role.name,
                message: t(jobRoleWriteMessageKey(rowFailure.code)),
              })}
            </Notice>
          )}
          {saved === null ? null : <Notice role="status">{t(jobRoleSavedMessageKey(saved))}</Notice>}
          {roles === null ? null : <OfflineWriteNote gate={gate} />}
          {renderRoles()}
        </CardContent>
      </Card>
      <JobRoleDialog jobRoles={jobRoles} />
    </>
  );
}

/**
 * The one dialog, for adding and renaming: MOUNTED ALWAYS and driven by the
 * hook's opening, its body keyed to the opening, as the absence type dialog.
 */
function JobRoleDialog({ jobRoles }: { readonly jobRoles: OrganizationJobRoles }): ReactNode {
  const { opening, pending, close } = jobRoles;

  return (
    <Dialog
      open={opening !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) close();
      }}
      aria-labelledby={ORGANIZATION_JOB_ROLE_DIALOG_HEADING_ID}
    >
      {opening === null ? null : (
        <>
          <DialogHeader closeLabel={t('organization.jobRoles.close')} onClose={close}>
            <DialogTitle id={ORGANIZATION_JOB_ROLE_DIALOG_HEADING_ID}>
              {opening.role === null ? t('organization.jobRoles.addHeading') : t('organization.jobRoles.editHeading')}
            </DialogTitle>
          </DialogHeader>
          <Fragment key={opening.key}>
            <JobRoleForm jobRoles={jobRoles} role={opening.role} />
          </Fragment>
        </>
      )}
    </Dialog>
  );
}

/** The name, the refusal and one Spremi. */
function JobRoleForm({
  jobRoles,
  role,
}: {
  readonly jobRoles: OrganizationJobRoles;
  readonly role: JobRoleRow | null;
}): ReactNode {
  const { pending, failure, close, save } = jobRoles;
  const gate = useWriteGate();

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!gate.online) return;

        const field = event.currentTarget.elements.namedItem(JOB_ROLE_NAME_FIELD);

        if (!(field instanceof HTMLInputElement)) return;
        void save(field.value);
      }}
      className="grid gap-5"
    >
      <div className="grid gap-2">
        <Label htmlFor={ORGANIZATION_JOB_ROLE_NAME_FIELD_ID}>{t('organization.jobRoles.name')}</Label>
        <Input
          id={ORGANIZATION_JOB_ROLE_NAME_FIELD_ID}
          name={JOB_ROLE_NAME_FIELD}
          type="text"
          maxLength={NAME_MAX_LENGTH}
          required
          autoComplete="off"
          defaultValue={role === null ? NO_TEXT : role.name}
          disabled={pending}
          aria-invalid={marksJobRoleName(failure)}
          aria-describedby={failure === null ? undefined : ORGANIZATION_JOB_ROLE_ERROR_ID}
          className="h-11 w-full"
        />
      </div>
      {failure === null ? null : (
        <Notice id={ORGANIZATION_JOB_ROLE_ERROR_ID} role="alert">
          {t(jobRoleWriteMessageKey(failure))}
        </Notice>
      )}
      <OfflineWriteNote gate={gate} />
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={close}>
          {t('organization.jobRoles.cancel')}
        </Button>
        <Button
          id={ORGANIZATION_JOB_ROLE_SAVE_ID}
          className="h-11 aria-disabled:opacity-50"
          type="submit"
          disabled={pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
        >
          {t('organization.jobRoles.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
