import type { ReactNode } from 'react';

import type { ToolbarSlots } from '@/components/filter-bar';
import { OptionFilterBar, type OptionChipView } from '@/components/option-filter-bar';
import { ALL_ROLES, NO_ROLE, roleChipShown, type RoleFilterOption } from '@/features/members/services/list';
import type { ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import { MANUAL_ROLE_CHIP } from '@/features/planning/services/manual-grid';
import { t } from '@/lib/i18n';

/** A role option's words: the role's own name (data), *Svi poslovi* or *Bez posla*. */
function roleName(value: string, options: readonly RoleFilterOption[]): string {
  if (value === ALL_ROLES) return t('filter.allRoles');
  if (value === NO_ROLE) return t('filter.noRole');

  return options.find((option) => option.value === value)?.roleName ?? value;
}

/**
 * *Ručni raspored*'s compact toolbar (stories 21.4, 21.23) with its *Filtri*
 * panel (story 21.25, deferred from 21.12 and 21.5): one chip, *Posao*, on
 * *Ljudi*'s semantics — `?posao=` every role, a role or nobody's, an id no row
 * holds being every role — drawn only while somebody in the month holds a
 * role or one is chosen (`roleChipShown`); otherwise the toolbar alone, as
 * before. The rows shown are the role's; the draft keeps every row's cells.
 */
export function ManualFilters({
  screen,
  title,
  lead,
  after,
}: {
  readonly screen: ManualScreen;
  readonly title: ReactNode;
  readonly lead: ReactNode;
  readonly after: ReactNode;
}): ReactNode {
  const toolbar: ToolbarSlots = { title, lead, after };
  const filter = screen.roleFilter;
  const options = filter?.options ?? [];
  const role = filter?.applied ?? ALL_ROLES;
  const absent = filter === null || screen.surface.refusal !== null || !roleChipShown(options, role);
  const chips: OptionChipView[] = [
    {
      key: MANUAL_ROLE_CHIP,
      active: role !== ALL_ROLES,
      text: t('filter.chip.role', { value: roleName(role, options) }),
      removeLabel: t('filter.remove.role', { value: roleName(role, options) }),
      pickerLabel: t('filter.rolePicker'),
      heading: t('filter.role'),
      options: options.map((option) => ({
        id: option.value,
        label: roleName(option.value, options),
        count: t('filter.personCount', { count: option.count }),
      })),
      chosen: role,
      allId: ALL_ROLES,
    },
  ];

  return (
    <OptionFilterBar
      chips={chips}
      summary={t('filter.personCount', { count: screen.shown?.rows.length ?? 0 })}
      showClear={role !== ALL_ROLES}
      stateKey={screen.roleState}
      absent={absent}
      toolbar={toolbar}
      onPick={(_key, id) => screen.chooseRole(id)}
      onRemove={() => screen.chooseRole(null)}
      onClear={() => {
        screen.chooseRole(null);
      }}
      onReset={() => {
        screen.chooseRole(null);
      }}
    />
  );
}
