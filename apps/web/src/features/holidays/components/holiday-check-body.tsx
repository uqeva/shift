import type { ReactNode } from 'react';

import type { ErasureDialogCopy } from '@/features/conflicts/components/erasure-dialog';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { TEAM_LOST, type HolidayCheckReady } from '@/features/holidays/services/holiday-check';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import { ManualPreviewBody } from '@/features/planning/components/manual-preview-dialog';
import { manualDateValuesOf } from '@/features/planning/services/manual-preview';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import { t } from '@/lib/i18n';

/**
 * *ŠTO SE MIJENJA* OF A HOLIDAY WRITE (story 21.17): what the fresh check
 * derived, drawn the same on *Organizacija → Blagdani* and in the team
 * dialog's *Ne radi na blagdane* — the past dates' warning (for the flag,
 * how many past holidays the preview leaves out, which change too), an import's
 * proposed list (each date with its official name, *već upisano* where the
 * organization holds one, its stored name kept), the off teams' shifts lost
 * or gained (or that no team is off on holidays, so no shift changes), every member's block (`ManualPreviewBody`), the short-staffed
 * block, and how many conflicts the save erases. Nothing here blocks.
 */
export function HolidayCheckBody({ checked }: { readonly checked: HolidayCheckReady }): ReactNode {
  const { proposal } = checked;

  return (
    <div className="grid gap-4">
      {/* The flag's past holidays are left out of the preview below, and said to change too. */}
      {checked.pastNotPreviewed > 0 ? (
        <p className="text-sm font-medium">{t('organization.holidays.preview.pastNotPreviewed', { count: checked.pastNotPreviewed })}</p>
      ) : checked.past.length > 0 ? (
        <p className="text-sm font-medium">{t('organization.holidays.preview.pastNote', { count: checked.past.length })}</p>
      ) : null}
      {proposal === null ? null : (
        <section className="grid gap-1 text-sm">
          <h3 className="font-medium">{t('organization.holidays.preview.proposed', { year: String(proposal.year) })}</h3>
          <ul className="grid gap-1">
            {proposal.rows.map((row) => (
              <li key={row.date} className="flex min-w-0 flex-wrap gap-x-2">
                <span className="break-words">
                  {t('organization.holidays.preview.proposedRow', { ...manualDateValuesOf(row.date), name: row.name })}
                </span>
                {row.stored === null ? null : (
                  <span className="break-words text-muted-foreground">
                    {t('organization.holidays.preview.stored', { name: row.stored.name })}
                  </span>
                )}
                {row.past ? <span className="text-muted-foreground">{t('organization.holidays.preview.past')}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {checked.window === null ? null : (
        <section className="grid gap-1 text-sm">
          <h3 className="font-medium">{t('organization.holidays.preview.teamsHeading')}</h3>
          {checked.offTeams === 0 ? (
            <p className="text-muted-foreground">{t('organization.holidays.preview.noOffTeams')}</p>
          ) : checked.teams.length === 0 ? (
            <p className="text-muted-foreground">{t('organization.holidays.preview.noTeams')}</p>
          ) : (
            checked.teams.map((line) => {
              const values = { team: line.team, weekday: line.weekday, date: line.dayMonth, type: line.type };

              return (
                <p key={line.key}>
                  {line.side === TEAM_LOST
                    ? t('organization.holidays.preview.teamLost', values)
                    : t('organization.holidays.preview.teamGained', values)}
                </p>
              );
            })
          )}
        </section>
      )}
      {checked.window === null ? null : <ManualPreviewBody preview={checked.preview} />}
      <ShortStaffedBlock report={checked.shortStaffed} />
      {checked.rows.length === 0 ? null : (
        <p className="text-sm font-medium">{t('organization.holidays.preview.erasures', { count: checked.rows.length })}</p>
      )}
    </div>
  );
}

/**
 * The erasure confirmation's words for a holiday write: the member page's,
 * except that a row whose team the holiday empties says so, rather than that
 * the team works that day without the member.
 */
export function holidayErasureCopyOf(rows: readonly ErasureRow[], save: string): ErasureDialogCopy {
  const copy = memberErasureCopyOf(rows, save);

  return {
    ...copy,
    rowDetail: (row) =>
      row.teamWorks ? copy.rowDetail(row) : t('organization.holidays.erasureFree', { member: row.memberName, team: row.teamName }),
  };
}
