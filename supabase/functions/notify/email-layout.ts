/**
 * STORY 21.27 (UX-DR85): the one HTML layout every email the product sends is
 * drawn in, the GoTrue Auth templates and every `notify` email and reminder.
 *
 * THE CANONICAL FILE is `supabase/functions/notify/email-layout.ts`;
 * `apps/web/src/lib/email-layout.ts` is a byte-identical copy, because the
 * function is deployed on its own and cannot import from `apps/web`, and the
 * SPA's build may not import from `supabase/`. `test/email-layout.test.ts`
 * fails when the two differ. Edit `supabase/functions/notify/email-layout.ts`,
 * then copy it over `apps/web/src/lib/email-layout.ts`.
 *
 * What a mail client gets: a 600 px table (no flexbox, no grid, no web font;
 * a fixed 600 px "ghost" table for Outlook on Windows, which ignores
 * `max-width`);
 * the *Smjenko* mark as a PNG from the app origin, the same URL for every
 * recipient, with `alt` and fixed dimensions (Gmail and Outlook show neither
 * an inline SVG nor a `data:` image); the wordmark as text beside it, so a
 * client that blocks images still names the sender; a white card with a heading,
 * the message, one table-based button (the "bulletproof" button: the cell
 * carries the colour and, for Outlook's Word engine, the padding as
 * `mso-padding-alt`, so Outlook draws it 44 px tall too) and the link written out under
 * it; a footer in small type; and a `prefers-color-scheme: dark` block for the
 * clients that honour it, with solid colours that read on either side for the
 * ones that invert. No script, no stylesheet link, no tracking pixel.
 *
 * Every text is escaped here; an `href` or the mark's URL is escaped as an
 * attribute. The caller passes plain text, never HTML. Pure: imports nothing.
 */

/** Escapes text for an HTML text node or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The file the mark is served as, at the app origin's root (`apps/web/public/`). */
export const EMAIL_MARK_FILE = 'email-mark.png';

/** The mark's drawn size in CSS pixels; the PNG is 96 px square, sharp on dense screens. */
export const EMAIL_MARK_SIZE = 40;

/**
 * The palette, the app's own light tokens (`index.css`) and their dark
 * counterparts. The light button is the app's primary darkened one step, so
 * its label is 7.4:1 (the primary itself is 6.7:1); the dark one is the app's
 * own dark primary pair, 6.6:1. `test/email-layout.test.ts` pins each.
 */
export const EMAIL_COLOURS = {
  page: '#e8edf5',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#556275',
  accent: '#3fa0fa',
  button: '#2a4fae',
  buttonText: '#ffffff',
  link: '#2a4fae',
  darkPage: '#0a1020',
  darkCard: '#111a2e',
  darkText: '#e2e8f0',
  darkMuted: '#94a3b8',
  darkButton: '#3fa0fa',
  darkButtonText: '#0b1628',
  darkLink: '#7cc0ff',
} as const;

export interface EmailLink {
  /** Plain text. */
  readonly label: string;
  /** The URL as it should reach the client; escaped here as an attribute. */
  readonly href: string;
}

export interface EmailLayout {
  /** The document's language, `hr`. */
  readonly lang: string;
  /** The `<title>`, the subject. */
  readonly title: string;
  /** The hidden line a client previews beside the subject. */
  readonly preheader: string;
  /** The product's name: the mark's `alt` and the wordmark. */
  readonly brand: string;
  /** The mark's absolute URL on the app origin: `<origin>/email-mark.png`. */
  readonly markUrl: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** The one button. */
  readonly action: EmailLink;
  /** The line before the link written out ("Ako gumb ne radi, …"). */
  readonly fallback: string;
  /** Small lines after the link (an expiry, an "ignore if not yours"). */
  readonly notes: readonly string[];
  /** The footer's lines, and an optional link closing it (the settings). */
  readonly footer: { readonly lines: readonly string[]; readonly link?: EmailLink };
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The dark-mode block: classes only, so a client that drops `<style>` keeps the light inline colours. */
function darkStyle(): string {
  const c = EMAIL_COLOURS;
  return [
    '<style>',
    ':root{color-scheme:light dark}',
    '@media (prefers-color-scheme:dark){',
    `.sk-page{background:${c.darkPage}!important}`,
    `.sk-card{background:${c.darkCard}!important}`,
    `.sk-text{color:${c.darkText}!important}`,
    `.sk-muted{color:${c.darkMuted}!important}`,
    `.sk-link{color:${c.darkLink}!important}`,
    `.sk-button{background:${c.darkButton}!important}`,
    `.sk-button a{color:${c.darkButtonText}!important}`,
    '}',
    '</style>',
  ].join('');
}

/** The button: a one-cell table whose cell carries the fill, and a padded link inside it. */
function button({ label, href }: EmailLink): string {
  const c = EMAIL_COLOURS;
  return [
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px">',
    '<tr>',
    `<td class="sk-button" align="center" bgcolor="${c.button}" style="border-radius:8px;background:${c.button};mso-padding-alt:12px 24px">`,
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${c.buttonText};text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>`,
    '</td>',
    '</tr>',
    '</table>',
  ].join('\n');
}

/** One email's HTML document. */
export function emailHtml(layout: EmailLayout): string {
  const c = EMAIL_COLOURS;
  const text = `font-family:${FONT};color:${c.text}`;
  const small = `margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:20px;color:${c.muted}`;
  const footer = layout.footer.link;
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(layout.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    '<meta name="x-apple-disable-message-reformatting">',
    `<title>${escapeHtml(layout.title)}</title>`,
    darkStyle(),
    '</head>',
    `<body class="sk-page" style="margin:0;padding:0;background:${c.page}">`,
    // The preview line, then a run of invisible fillers so a client's preview
    // does not run on into the wordmark and the heading.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(layout.preheader)}${'&#8199;&#847;'.repeat(40)}</div>`,
    `<table role="presentation" class="sk-page" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${c.page}" style="background:${c.page}">`,
    '<tr>',
    '<td align="center" style="padding:24px 12px">',
    '<!--[if mso]><table role="presentation" width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px">',
    // The header: the mark and the wordmark, text that survives blocked images.
    '<tr>',
    '<td style="padding:0 8px 16px">',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0">',
    '<tr>',
    `<td style="padding:0 12px 0 0;vertical-align:middle"><img src="${escapeHtml(layout.markUrl)}" width="${String(EMAIL_MARK_SIZE)}" height="${String(EMAIL_MARK_SIZE)}" alt="${escapeHtml(layout.brand)}" style="display:block;width:${String(EMAIL_MARK_SIZE)}px;height:${String(EMAIL_MARK_SIZE)}px;border:0;border-radius:9px"></td>`,
    `<td class="sk-text" aria-hidden="true" style="vertical-align:middle;${text};font-size:22px;line-height:28px;font-weight:600">${escapeHtml(layout.brand)}</td>`,
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    // The card.
    '<tr>',
    `<td class="sk-card" bgcolor="${c.card}" style="background:${c.card};border-radius:12px;border-top:4px solid ${c.accent};padding:28px 24px">`,
    `<h1 class="sk-text" style="margin:0 0 16px;${text};font-size:22px;line-height:30px;font-weight:700">${escapeHtml(layout.heading)}</h1>`,
    ...layout.paragraphs.map(
      (paragraph) => `<p class="sk-text" style="margin:0 0 24px;${text};font-size:16px;line-height:24px">${escapeHtml(paragraph)}</p>`,
    ),
    button(layout.action),
    `<p class="sk-muted" style="${small}">${escapeHtml(layout.fallback)}</p>`,
    `<p style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:20px;word-break:break-all"><a class="sk-link" href="${escapeHtml(layout.action.href)}" style="color:${c.link}">${escapeHtml(layout.action.href)}</a></p>`,
    ...layout.notes.map((note) => `<p class="sk-muted" style="${small}">${escapeHtml(note)}</p>`),
    '</td>',
    '</tr>',
    // The footer: why this came, and where it is turned off.
    '<tr>',
    '<td style="padding:16px 8px 0">',
    ...layout.footer.lines.map(
      (line) => `<p class="sk-muted" style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:18px;color:${c.muted}">${escapeHtml(line)}</p>`,
    ),
    ...(footer === undefined
      ? []
      : [
          `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:18px"><a class="sk-link" href="${escapeHtml(footer.href)}" style="color:${c.link}">${escapeHtml(footer.label)}</a></p>`,
        ]),
    '</td>',
    '</tr>',
    '</table>',
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
