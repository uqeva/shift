import { cn } from '@/lib/utils';

/**
 * STORY 21.24. Smjenko's mark, concept C (*Predaja smjene*, the founder's pick
 * on 2026-11-25): an S built from two 290° clock arcs that meet at a seam, the
 * upper one accent blue and the lower one white, on an ink-navy tile. One shift
 * handing over to the next.
 *
 * The SAME DRAWING as `public/favicon.svg`, the PWA and Apple touch icons and
 * the favicon.ico, which are rendered from it (`vite.config.ts` says how). The
 * colours are the brand's own and fixed in both themes, as an app icon's are:
 * the tile is `#0F172A` (the light theme's ink), the upper arc `#3FA0FA` (the
 * dark theme's primary) and the lower arc white. In the dark theme the tile
 * meets dark glass, so a hairline of white at 16% draws its edge, the glass
 * border's own treatment; in the light theme the hairline is not drawn.
 * Under forced colours the mark keeps its colours (`forced-color-adjust:
 * none`), as an image would: its contrast is its own, the S on its tile, and a
 * repainted mark would draw the S and the tile in one system colour.
 *
 * Decorative: always `aria-hidden`. The product's name is the text beside it
 * (`auth.brand.name`), set in the app's own heading face, so the wordmark is
 * never an image and never live `<text>` in an SVG. The landing page (story
 * 21.21) reuses the same mark.
 */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      data-brand-mark=""
      className={cn('shrink-0 forced-color-adjust-none', className)}
    >
      <rect width="512" height="512" rx="112" fill="#0F172A" />
      <g fill="none" strokeWidth="58">
        <path stroke="#3FA0FA" d="M315 154a68 68 0 1 0-63 102" />
        <path stroke="#FFF" d="M260 256a68 68 0 1 1-63 102" />
      </g>
      <rect
        x="6"
        y="6"
        width="500"
        height="500"
        rx="106"
        fill="none"
        stroke="#FFF"
        strokeOpacity=".16"
        strokeWidth="12"
        className="hidden dark:inline"
      />
    </svg>
  );
}
