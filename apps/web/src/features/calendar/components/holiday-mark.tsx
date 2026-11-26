import type { ReactNode } from 'react';

import { Star } from '@/components/ui/icon';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * STORY 21.18 (UX-DR78): THE HOLIDAY'S ONE DRAWING — the star, `aria-hidden`,
 * beside the holiday's name, never colour alone. A screen reader hears
 * `blagdan {name}`. Drawn by the day lists, the day detail's title area,
 * *Danas*' today card and week list, and *Ručni raspored*'s phone list.
 */
export function HolidayMark({ name, className }: { readonly name: string; readonly className?: string }): ReactNode {
  return (
    <span data-holiday className={cn('flex min-w-0 items-center gap-1 text-xs font-normal', className)}>
      <Star aria-hidden className="size-3 shrink-0" />
      <span aria-hidden className="min-w-0 [overflow-wrap:anywhere]">
        {name}
      </span>
      <span className="sr-only">{t('kalendar.holiday.label', { name })}</span>
    </span>
  );
}

/**
 * STORY 21.18: a cell the holiday emptied, in a day list — the star and the
 * word *blagdan* where `—` was; the word is the meaning, so it stays readable.
 */
export function HolidayOffWord(): ReactNode {
  return (
    <span data-holiday-off className="flex items-center gap-1">
      <Star aria-hidden className="size-3 shrink-0" />
      <span>{t('kalendar.holiday.word')}</span>
    </span>
  );
}
