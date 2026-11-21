import { describe, expect, it } from 'vitest';

import { CRLF, contentOf, escapeText, foldLine } from '../src/index.js';

const octets = (text: string): number => Buffer.byteLength(text, 'utf8');

describe('TEXT escaping (RFC 5545 §3.3.11)', () => {
  it('escapes the backslash, the semicolon, the comma and every line break', () => {
    expect(escapeText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeText('one\ntwo\r\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
  });

  it('keeps a tab and the Croatian letters, and turns any other control character into a space', () => {
    expect(escapeText('Noć\tčćđšž ŽĆČĐŠ')).toBe('Noć\tčćđšž ŽĆČĐŠ');
    expect(escapeText('a\u0000b\u001fc\u007fd')).toBe('a b c d');
  });

  it('leaves the colon alone: a value may hold one', () => {
    expect(escapeText('Smjena: A')).toBe('Smjena: A');
  });
});

describe('folding at 75 octets (RFC 5545 §3.1)', () => {
  it('leaves a line of 75 octets as it is, and folds the 76th onto a continuation', () => {
    const exact = `SUMMARY:${'x'.repeat(75 - 'SUMMARY:'.length)}`;
    expect(foldLine(exact)).toBe(exact);
    const over = `${exact}y`;
    expect(foldLine(over)).toBe(`${exact}${CRLF} y`);
  });

  it('never splits a UTF-8 sequence, and no folded line exceeds 75 octets', () => {
    for (const filler of ['č', 'ž', '€', '𝄞', 'ab', 'aš']) {
      for (let length = 60; length < 260; length += 7) {
        const line = `SUMMARY:${filler.repeat(length)}`;
        const folded = foldLine(line);
        const segments = folded.split(CRLF);
        for (const segment of segments) expect(octets(segment), `${filler} ×${String(length)}`).toBeLessThanOrEqual(75);
        for (const segment of segments.slice(1)) expect(segment.startsWith(' ')).toBe(true);
        // Unfolding (RFC 5545: delete CRLF followed by one space) gives the line back.
        expect(folded.replaceAll(`${CRLF} `, '')).toBe(line);
      }
    }
  });

  it('refuses a raw line break inside a content line', () => {
    expect(() => foldLine('SUMMARY:a\nb')).toThrow(RangeError);
    expect(() => foldLine('SUMMARY:a\rb')).toThrow(RangeError);
  });

  it('ends every content line with CRLF, the last one included', () => {
    expect(contentOf(['BEGIN:VCALENDAR', 'END:VCALENDAR'])).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  });
});
