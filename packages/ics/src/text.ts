/**
 * The content-line layer of RFC 5545 (§3.1, §3.3.11), by hand (AD-20).
 *
 * A calendar is a sequence of content lines ending in CRLF. A line longer
 * than 75 octets is folded: CRLF and one space, with no octet sequence of a
 * UTF-8 character split across the fold. A TEXT value escapes the backslash,
 * the semicolon, the comma and the line break.
 */

/** The line end every content line carries, the last one included. */
export const CRLF = '\r\n';

/** The longest content line, in octets, the line break excluded (RFC 5545 §3.1). */
export const MAX_LINE_OCTETS = 75;

/** How many UTF-8 octets one code point takes. */
function utf8Octets(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * A TEXT value as RFC 5545 §3.3.11 writes it: `\` `;` `,` escaped, any line
 * break (CRLF, LF or CR) as `\n`. Every other control character (which TEXT
 * does not admit, the tab excepted) becomes a space, so a stray one in a
 * stored name cannot break the line structure. So do the C1 controls and the
 * Unicode line and paragraph separators (U+0085, U+2028, U+2029): RFC 5545
 * admits them, but a client that reads them as line breaks must not see one.
 */
export function escapeText(value: string): string {
  let escaped = '';
  const normalized = value.replace(/\r\n|\r/g, '\n');
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '\\' || character === ';' || character === ',') escaped += `\\${character}`;
    else if (character === '\n') escaped += '\\n';
    else if (code === 0x09) escaped += character;
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) escaped += ' ';
    else escaped += character;
  }
  return escaped;
}

/**
 * One content line, folded at 75 octets: the first segment holds at most 75
 * octets, and each continuation is a space and at most 74 more. A fold never
 * falls inside a character's UTF-8 sequence.
 *
 * @throws RangeError when the line holds a CR or an LF: a content line is one
 *   line, and its values are escaped before they get here.
 */
export function foldLine(line: string): string {
  if (/[\r\n]/.test(line)) throw new RangeError('a content line holds a line break; escape the value first');
  const segments: string[] = [];
  let segment = '';
  let octets = 0;
  for (const character of line) {
    const size = utf8Octets(character.codePointAt(0) ?? 0);
    if (octets + size > MAX_LINE_OCTETS) {
      segments.push(segment);
      // A continuation starts with one space, which counts against its 75.
      segment = ' ';
      octets = 1;
    }
    segment += character;
    octets += size;
  }
  segments.push(segment);
  return segments.join(CRLF);
}

/** The calendar's text: every line folded, each ending in CRLF. */
export function contentOf(lines: readonly string[]): string {
  return lines.map((line) => `${foldLine(line)}${CRLF}`).join('');
}
