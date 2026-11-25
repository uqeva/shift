import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CellMark, cellLabelOf, sourceText } from '@/features/planning/components/manual-grid';
import { MANUAL_HEADING_ID, manualCellIdOf, type ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import type { ManualMonth } from '@/features/planning/services/manual-grid';
import { PERSON_FIELD_ID } from '@/features/planning/utils/element-ids';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * *RUČNI RASPORED* BELOW 640 px (story 21.4; UX-DR72): one member's month at
 * a time — *Osoba* picks them (grouped by team, as the grid's rows), and
 * their dates are a day list the page scrolls (UX-DR71: no horizontal
 * overflow, no inner scroller). Each date is a button opening the same
 * picker for that one date. Multi-select is the grid's, from 640 px.
 */
export function ManualMemberDays({ screen, shown }: { readonly screen: ManualScreen; readonly shown: ManualMonth }): ReactNode {
  const row = screen.person;
  const types = new Map((screen.snapshot?.types ?? []).map((type) => [type.id, type.name]));
  const teams = new Map((screen.snapshot?.teams ?? []).map((team) => [team.id, team.name]));
  const typeName = (id: string): string => types.get(id) ?? t('rucniRaspored.cell.unknownType');
  const teamName = (id: string): string => teams.get(id) ?? t('rucniRaspored.noTeam');

  if (row === null) return null;

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 px-4">
        <Label htmlFor={PERSON_FIELD_ID}>{t('rucniRaspored.phone.person')}</Label>
        <Select
          id={PERSON_FIELD_ID}
          className="h-11"
          value={row.memberId}
          onChange={(event) => {
            screen.choosePerson(event.currentTarget.value);
          }}
        >
          {shown.groups.map((group) => (
            <optgroup key={group.teamId ?? group.rows[0]?.memberId} label={group.name ?? t('rucniRaspored.noTeam')}>
              {group.rows.map((option) => (
                <option key={option.memberId} value={option.memberId}>
                  {option.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <p className="text-sm text-muted-foreground">{sourceText(row)}</p>
      </div>
      <ul aria-labelledby={MANUAL_HEADING_ID} className="grid">
        {row.cells.map((cell, index) => {
          const date = shown.dates[index];
          const ref = { memberId: row.memberId, date: cell.date };

          return (
            <li key={cell.date} aria-current={date?.today === true ? 'date' : undefined} className={date?.weekend === true ? 'bg-secondary/60' : undefined}>
              <button
                id={manualCellIdOf(ref)}
                type="button"
                aria-haspopup="dialog"
                aria-label={cellLabelOf(cell, row.name, date, typeName, teamName)}
                onClick={() => {
                  screen.openPicker([ref]);
                }}
                className="flex min-h-11 w-full items-center gap-3 border-b px-4 py-1 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span aria-hidden className={cn('w-16 shrink-0 text-sm tabular-nums', date?.today === true && 'font-bold')}>
                  {date?.dayMonth}
                  <span className="ml-1 text-xs text-muted-foreground">{date?.weekday}</span>
                </span>
                <CellMark cell={cell} />
                <span aria-hidden className={cn('min-w-0 flex-1 truncate text-sm', cell.shiftTypeId === null && !cell.off && 'text-muted-foreground')}>
                  {cell.off ? t('rucniRaspored.cell.off') : cell.shiftTypeId === null ? t('rucniRaspored.cell.empty') : typeName(cell.shiftTypeId)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
