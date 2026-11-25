import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addShiftSearchOf } from '@/features/planning/services/single-cell';
import {
  ADD_SHIFT_DATE_ID,
  ADD_SHIFT_DIALOG_HEADING_ID,
  ADD_SHIFT_HEADING_ID,
  ADD_SHIFT_HINT_ID,
  NO_DATE,
} from '@/features/planning/utils/element-ids';
import { t } from '@/lib/i18n';
import { isIsoDate } from '@/lib/i18n/format';
import { focusLater } from '@/utils/focus-later';

/**
 * *DODAJ SMJENU* on the member page (story 21.6; epic AC 2 as reinterpreted):
 * one person, one date — the grid's single-cell case. As every fact card of
 * the page (story 7.11), the card's header button opens its own small dialog,
 * so no form is mounted on the page while it is closed: a date, then *Odaberi
 * smjenu* opens *Ručni raspored* on that member and date with the picker open
 * (`?mjesec&osoba&dan`), so the same picker, check and save write the one
 * assignment. Nothing is written here. The page is the admin's alone.
 */
export function MemberAddShiftCard({ memberId }: { readonly memberId: string }): ReactNode {
  const navigate = useNavigate();
  const opener = useRef<HTMLButtonElement>(null);
  const addShiftDateField = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(NO_DATE);
  const valid = isIsoDate(date);

  function close(): void {
    setOpen(false);
    focusLater([() => opener.current], () => null);
  }

  return (
    <Card className="min-w-0">
      <section aria-labelledby={ADD_SHIFT_HEADING_ID} className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ADD_SHIFT_HEADING_ID}>{t('rucniRaspored.addShift.title')}</h2>
          </CardTitle>
          <Button
            ref={opener}
            className="h-11"
            type="button"
            variant="outline"
            onClick={() => {
              setDate(NO_DATE);
              setOpen(true);
            }}
          >
            {t('rucniRaspored.addShift.title')}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('rucniRaspored.addShift.hint')}</p>
        </CardContent>
      </section>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
          event.preventDefault();
          close();
        }}
        aria-labelledby={ADD_SHIFT_DIALOG_HEADING_ID}
      >
        {open ? (
          <>
            <DialogHeader closeLabel={t('rucniRaspored.addShift.close')} onClose={close}>
              <DialogTitle id={ADD_SHIFT_DIALOG_HEADING_ID}>{t('rucniRaspored.addShift.title')}</DialogTitle>
            </DialogHeader>
            <form
              noValidate
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault();

                const chosen = addShiftDateField.current?.value ?? date;

                if (!isIsoDate(chosen)) return;

                setOpen(false);
                void navigate({ to: '/rucni-raspored', search: addShiftSearchOf(memberId, chosen) });
              }}
            >
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={ADD_SHIFT_DATE_ID}>{t('rucniRaspored.addShift.date')}</Label>
                <Input
                  ref={addShiftDateField}
                  id={ADD_SHIFT_DATE_ID}
                  type="date"
                  value={date}
                  aria-describedby={ADD_SHIFT_HINT_ID}
                  onChange={(event) => {
                    setDate(event.currentTarget.value);
                  }}
                  className="h-11 min-w-0"
                />
                <p id={ADD_SHIFT_HINT_ID} className="text-sm text-muted-foreground">
                  {t('rucniRaspored.addShift.hint')}
                </p>
              </div>
              <DialogFooter>
                <Button className="h-11" type="button" variant="outline" onClick={close}>
                  {t('rucniRaspored.addShift.cancel')}
                </Button>
                <Button className="h-11" type="submit" disabled={!valid}>
                  {t('rucniRaspored.addShift.open')}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </Dialog>
    </Card>
  );
}
