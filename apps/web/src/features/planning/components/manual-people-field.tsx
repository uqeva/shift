import type { ReactNode } from 'react';

import type { ManualGroup } from '@/features/planning/services/manual-grid';
import { planPersonIdOf } from '@/features/planning/utils/element-ids';
import { t } from '@/lib/i18n';

/**
 * *OSOBE* (story 21.5; UX-DR74): the people a fill or copy is for, one
 * checkbox each, grouped by team as the grid's rows are. The list is the
 * shown month's rows; the dialog pre-checks the selection's.
 */
export function ManualPeopleField({
  groups,
  chosen,
  invalid,
  onChange,
}: {
  readonly groups: readonly ManualGroup[];
  readonly chosen: ReadonlySet<string>;
  readonly invalid: boolean;
  readonly onChange: (memberId: string, checked: boolean) => void;
}): ReactNode {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-2 text-sm font-semibold leading-none">{t('rucniRaspored.plan.people')}</legend>
      <div className="grid max-h-48 min-w-0 gap-3 overflow-y-auto rounded-md border p-3">
        {groups.map((group) => (
          <div key={group.teamId ?? group.rows[0]?.memberId} className="grid gap-1">
            <p className="text-xs font-semibold text-muted-foreground">{group.name ?? t('rucniRaspored.noTeam')}</p>
            {group.rows.map((row) => (
              <label key={row.memberId} htmlFor={planPersonIdOf(row.memberId)} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  id={planPersonIdOf(row.memberId)}
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={chosen.has(row.memberId)}
                  aria-invalid={invalid}
                  onChange={(event) => {
                    onChange(row.memberId, event.currentTarget.checked);
                  }}
                />
                <span className="min-w-0 break-words">{row.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** The chosen people in the grid's row order: the order the items are planned in. */
export function chosenInOrder(groups: readonly ManualGroup[], chosen: ReadonlySet<string>): readonly string[] {
  return groups.flatMap((group) => group.rows.map((row) => row.memberId)).filter((id) => chosen.has(id));
}
