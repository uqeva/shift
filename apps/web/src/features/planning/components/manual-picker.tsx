import { PERSONAL_ASSIGNMENT_OFF, PERSONAL_ASSIGNMENT_SHIFT } from '@shift/domain';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import { MANUAL_CLEAR } from '@/features/planning/services/manual-grid';
import { OWN_TEAM, PICKER_CLEAR_HINT_ID, PICKER_HEADING_ID, PICKER_TEAM_ID } from '@/features/planning/utils/element-ids';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import { formatIsoDate } from '@/lib/i18n/format';

/**
 * THE CELL PICKER (story 21.4; UX-DR72): one dialog for one cell or a
 * selection — every shift type not archived (working first), *Slobodno*,
 * *Očisti*, and *Računaj u tim…*, the team a picked shift counts with (the
 * member's own by default). A choice puts every picked cell into the draft
 * and closes it; nothing is saved here. A bottom sheet on a phone.
 */
export function ManualPicker({ screen }: { readonly screen: ManualScreen }): ReactNode {
  const isPhone = usePhone();
  const [team, setTeam] = useState(OWN_TEAM);
  const picking = screen.picking;
  const cells = picking?.cells ?? [];
  const first = cells[0];
  const name = first === undefined ? null : (screen.snapshot?.members.find((member) => member.id === first.memberId)?.name ?? null);
  const title =
    cells.length === 1 && first !== undefined && name !== null
      ? t('rucniRaspored.picker.titleOne', { name, date: formatIsoDate(first.date) ?? first.date })
      : t('rucniRaspored.picker.title', { count: cells.length });
  const counted = team === OWN_TEAM ? null : team;

  function close(): void {
    setTeam(OWN_TEAM);
    screen.closePicker();
  }

  function choose(pick: () => void): void {
    pick();
    setTeam(OWN_TEAM);
  }

  return (
    <Dialog
      open={picking !== null}
      docked={isPhone}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      aria-labelledby={PICKER_HEADING_ID}
    >
      {picking === null ? null : (
        <>
          <DialogHeader closeLabel={t('rucniRaspored.picker.close')} onClose={close}>
            <DialogTitle id={PICKER_HEADING_ID}>{title}</DialogTitle>
            <DialogDescription>{t('rucniRaspored.picker.lede')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {/* FIRST, so the team a shift counts with is chosen before the shift that applies it. */}
            <div className="grid gap-2">
              <Label htmlFor={PICKER_TEAM_ID}>{t('rucniRaspored.picker.team')}</Label>
              <Select
                id={PICKER_TEAM_ID}
                className="h-11"
                value={team}
                onChange={(event) => {
                  setTeam(event.currentTarget.value);
                }}
              >
                <option value={OWN_TEAM}>{t('rucniRaspored.picker.ownTeam')}</option>
                {screen.teams.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </div>
            <div role="group" aria-label={t('rucniRaspored.picker.types')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {screen.types.map((type) => (
                <Button
                  key={type.id}
                  type="button"
                  variant="outline"
                  className="h-11 justify-start"
                  onClick={() => {
                    choose(() => {
                      screen.pick({ kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: type.id, teamId: counted });
                    });
                  }}
                >
                  {type.name}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                className="h-11 justify-start"
                onClick={() => {
                  choose(() => {
                    screen.pick({ kind: PERSONAL_ASSIGNMENT_OFF });
                  });
                }}
              >
                {t('rucniRaspored.picker.off')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 justify-start"
                aria-describedby={PICKER_CLEAR_HINT_ID}
                onClick={() => {
                  choose(() => {
                    screen.pick({ kind: MANUAL_CLEAR });
                  });
                }}
              >
                {t('rucniRaspored.picker.clear')}
              </Button>
            </div>
            <p id={PICKER_CLEAR_HINT_ID} className="text-sm text-muted-foreground">
              {t('rucniRaspored.picker.clearHint')}
            </p>
          </div>
        </>
      )}
    </Dialog>
  );
}
