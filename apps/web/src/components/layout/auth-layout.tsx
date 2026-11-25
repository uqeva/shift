import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand-mark';
import { t } from '@/lib/i18n';

/**
 * The sign-in frame: a floating glass brand panel from `lg` up, and the form
 * column on the page background.
 *
 * ONE FRAME. `/prijava` and `/prijava/$slug` render the one sign-in form since
 * story 7.7, and the panel is a fact of the frame rather than of the form — the
 * product name and the headline have one place. The screen keeps its own
 * `<Card>`, heading and form; this owns only what surrounds them.
 *
 * GLASS SINCE STORY 15.3 (direction G). The panel is `glass-chrome`, inset
 * 16 px from the viewport like the desktop sidebar and as tall as the screen,
 * over the page's blobs: chrome BESIDE the content, never over it. Its text is
 * `foreground`-strength (DESIGN rule 2: muted text needs the .85 reading
 * alpha), and the tile is Smjenko's mark (`brand-mark.tsx`, story 21.24) beside
 * the name in the heading face at 600, the wordmark's weight. No glow and no
 * `blur-*`: the glass utility's fallbacks (the opaque card, or `Canvas` with a
 * `CanvasText` border) are the panel's.
 *
 * FROM `lg` UP ONLY. On a phone the form is the whole screen, because the
 * person holding it came to sign in, not to read. The panel carries no control
 * and no landmark of its own, and its headline is a paragraph rather than a
 * heading: the form's `<h1>` stays the document's only one.
 */
export function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main className="flex flex-1">
      <div className="glass-chrome hidden w-[420px] shrink-0 flex-col rounded-3xl p-10 text-foreground lg:my-4 lg:ml-4 lg:flex">
        <div className="mb-12 flex items-center gap-3">
          <BrandMark className="size-10" />
          <p className="font-heading text-xl font-semibold text-foreground">{t('auth.brand.name')}</p>
        </div>
        <p className="mb-4 font-heading text-3xl font-extrabold leading-tight text-foreground">
          {t('auth.brand.headline')}
        </p>
        <p className="text-sm leading-relaxed text-foreground">{t('auth.brand.subline')}</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">{children}</div>
    </main>
  );
}
