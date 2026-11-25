import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { PLAN_COPY, PLAN_FILL, type ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import { COPY_OPEN_ID, FILL_OPEN_ID } from '@/features/planning/utils/element-ids';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';

/**
 * *Popuni uzorkom* and *Kopiraj* (story 21.5; UX-DR74): each opens its dialog
 * on the selection's people and dates (on a phone, the person shown). In the
 * page toolbar from 640 px, above the day list below it.
 */
export function ManualPlanButtons({ screen }: { readonly screen: ManualScreen }): ReactNode {
  const isPhone = usePhone();
  const disabled = screen.shown === null || screen.shown.rows.length === 0 || screen.pending;

  return (
    <>
      <Button
        id={FILL_OPEN_ID}
        className="h-11"
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          screen.openPlanning(PLAN_FILL, isPhone);
        }}
      >
        {t('rucniRaspored.fill.open')}
      </Button>
      <Button
        id={COPY_OPEN_ID}
        className="h-11"
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          screen.openPlanning(PLAN_COPY, isPhone);
        }}
      >
        {t('rucniRaspored.copy.open')}
      </Button>
    </>
  );
}
