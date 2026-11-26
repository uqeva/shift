/**
 * *Ručni raspored*'s search (story 21.4), as a pure type the route, the page's
 * hook and (story 21.13) *Za odluku*'s held line for a cover's assignment
 * share: `?mjesec=2026-12&osoba=<id>`, the month shown, and on a phone the
 * member edited. STORY 21.6: `&dan=2026-12-06` opens the picker on that
 * member's cell once (*Dodaj smjenu*), then leaves the URL. STORY 21.25:
 * `&posao=` the job role shown.
 */
export interface ManualSearch {
  readonly mjesec?: string;
  readonly osoba?: string;
  readonly dan?: string;
  readonly posao?: string;
}
