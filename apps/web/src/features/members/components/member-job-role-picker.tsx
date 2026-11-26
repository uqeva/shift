import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { NO_JOB_ROLE, jobRoleInitialValue } from '@/features/job-roles/services/list';
import { useMemberJobRole } from '@/features/members/hooks/use-member-job-role';
import type { MemberListRow } from '@/features/members/services/list';
import { memberJobRoleErrorId, memberJobRolePickerId } from '@/features/members/utils/element-ids';
import { refusalText } from '@/features/members/utils/refusal-text';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * *POSAO*, INLINE (story 21.26): one member's job role as a 44 px picker
 * that saves on change (`useMemberJobRole`), named for the person, with its
 * refusal under it and a polite line when it landed. Not on the member page,
 * where every change is a dialog (story 7.11). Drawn only once the roles are
 * read. NEVER DISABLED while its write is out — that would take the
 * keyboard's focus away mid-choice — but `aria-busy`, and the hook sends one
 * write at a time; offline it is `aria-disabled` and sends nothing.
 */
export function MemberJobRolePicker({ member }: { readonly member: MemberListRow }): ReactNode {
  const role = useMemberJobRole(member);
  const gate = useWriteGate();
  const pickerId = memberJobRolePickerId(member.id);
  const errorId = memberJobRoleErrorId(member.id);

  if (role.options === null) return null;

  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={pickerId} className="sr-only">
        {t('postaviRaspored.people.roleNamed', { name: member.name })}
      </Label>
      <Select
        // KEYED TO THE STORED ROLE, so a landed save or another admin's
        // re-reads the picker onto what the database holds.
        key={`${member.jobRole?.id ?? NO_JOB_ROLE}:${String(role.attempt)}`}
        id={pickerId}
        defaultValue={jobRoleInitialValue(member.jobRole?.id ?? null)}
        aria-disabled={gate.disabled}
        aria-busy={role.pending}
        aria-invalid={role.refusal !== null}
        aria-describedby={role.refusal === null ? gate.describedBy() : errorId}
        className="h-11 w-full min-w-40 sm:w-auto"
        onChange={(event) => {
          void role.save(event.currentTarget.value);
        }}
      >
        <option value={NO_JOB_ROLE}>{t('postaviRaspored.people.roleNone')}</option>
        {role.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
      {role.refusal === null ? null : (
        <Notice id={errorId} role="alert">
          {refusalText(role.refusal)}
        </Notice>
      )}
      {role.saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('postaviRaspored.people.roleSaved', { name: member.name })}
        </p>
      ) : null}
    </div>
  );
}
