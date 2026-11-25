import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { initLocalization, t } from '@/lib/i18n';

/**
 * *Popuni uzorkom*'s step fields carry the names the e2e finds them by
 * (story 21.5; CI run on #372: a label of an aria-hidden `×` and a
 * screen-reader-only phrase left the count without its name in Chromium).
 * The count is named by its own `aria-label`, the choice by its `<Label>`;
 * the e2e page object reads the same two `hr.json` messages.
 */

const dialog = readFileSync(fileURLToPath(new URL('./manual-fill-dialog.tsx', import.meta.url)), 'utf8');
const pageObject = readFileSync(fileURLToPath(new URL('../../../../../../e2e/pages/manual-schedule.page.ts', import.meta.url)), 'utf8');

beforeAll(async () => {
  await initLocalization();
});

describe("Popuni uzorkom's step fields are named as the e2e finds them", () => {
  it('names a step count on the field itself, `Broj dana u koraku {n}`', () => {
    expect(t('rucniRaspored.fill.count', { position: 1 })).toBe('Broj dana u koraku 1');
    expect(dialog).toMatch(/id=\{fillStepCountIdOf\(position\)\}\s+aria-label=\{t\('rucniRaspored\.fill\.count', \{ position \}\)\}/);
    // No `<Label>` points at the count: its name is the aria-label alone.
    expect(dialog).not.toMatch(/htmlFor=\{fillStepCountIdOf/);
  });

  it('names a step choice by its label, `Korak {n}`', () => {
    expect(t('rucniRaspored.fill.choice', { position: 1 })).toBe('Korak 1');
    expect(dialog).toMatch(/<Label htmlFor=\{fillStepChoiceIdOf\(position\)\}[^>]*>\s*\{t\('rucniRaspored\.fill\.choice', \{ position \}\)\}/);
  });

  it('is what the e2e page object asks for', () => {
    expect(pageObject).toContain("getByLabel(fill(words.fill.count, { position: String(position) }), { exact: true })");
    expect(pageObject).toContain("getByLabel(fill(words.fill.choice, { position: String(position) }), { exact: true })");
  });
});
