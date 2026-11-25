import type { ReactNode } from 'react';

import type { HistoryRowChange } from '@/features/history/services/history-rows';
import { t } from '@/lib/i18n';

/** One field's line: `Naziv: A → B`, or one side alone where the other has no value. */
function lineOf({ field, before, after }: HistoryRowChange): string {
  if (before === null) return t('history.added', { field, after });
  if (after === null) return t('history.removedValue', { field, before });

  return t('history.change', { field, before, after });
}

/**
 * One row's *bilo → sada* (story 14.2), the same in the table and the stacked
 * rows: a line per field — `Naziv: A → B`, an addition's `sada` alone and a
 * deletion's `bilo` alone — or one muted line when no visible field changed.
 *
 * STORY 21.4: a grid save (`days` set) lists one line per date, collapsed
 * behind a native disclosure, `Prikaži {n} dana`, so one save of a month
 * stays one row tall until it is opened.
 */
export function HistoryChanges({
  changes,
  days,
}: {
  readonly changes: readonly HistoryRowChange[];
  readonly days?: number | undefined;
}): ReactNode {
  const list = (
    <ul className="grid min-w-0 gap-0.5 text-sm">
      {changes.map((change) => (
        // KEYED BY THE DOMAIN'S COLUMN, never by the translated label.
        <li key={change.column} className="wrap-anywhere">
          {lineOf(change)}
        </li>
      ))}
    </ul>
  );

  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('history.noChanges')}</p>;
  }

  return days === undefined ? (
    list
  ) : (
    <details className="min-w-0 text-sm">
      <summary className="min-h-11 cursor-pointer content-center underline-offset-4 hover:underline">
        {t('history.plannedDays', { count: days })}
      </summary>
      {list}
    </details>
  );
}
