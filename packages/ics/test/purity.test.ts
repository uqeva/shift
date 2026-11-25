import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AD-20: `@shift/ics` is pure. It may import its own files and
 * `@shift/domain`, nothing else (an allowlist, as the domain's own purity
 * test), and its one declared dependency is that workspace package. The
 * clock and zone data come from the domain's `zone.ts` only (AD-6): ESLint
 * bans `Date`, `Intl`, `Temporal`, `globalThis` and `performance` in `src/`
 * scope-aware; this restates it as a test.
 */

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');

const sources = readdirSync(sourceRoot)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(sourceRoot, name), 'utf8') }));

// A line comment starts a line or follows a space: `'-//Smjenko//…'` is a string.
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

describe('@shift/ics is pure (AD-20)', () => {
  it('imports only its own files and @shift/domain', () => {
    expect(sources.length).toBeGreaterThan(2);
    for (const { name, text } of sources) {
      const specifiers = [
        ...code(text).matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g),
      ].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
      for (const specifier of specifiers) {
        expect(specifier === '@shift/domain' || specifier.startsWith('./'), `${name}: ${specifier}`).toBe(true);
      }
    }
  });

  it('names no clock or zone data of its own', () => {
    for (const { name, text } of sources) {
      expect(code(text), name).not.toMatch(/\b(?:Date|Intl|Temporal|performance|globalThis)\b|toLocale|localeCompare/);
    }
  });

  it('declares @shift/domain as its one dependency', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest['dependencies']).toEqual({ '@shift/domain': 'workspace:*' });
    expect(manifest['peerDependencies']).toBeUndefined();
    expect(manifest['optionalDependencies']).toBeUndefined();
  });
});
