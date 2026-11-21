#!/usr/bin/env node
// Story 19.2 (AD-21, D-S4): the LOCAL stack's Croatian Auth email templates.
//
// The Supabase CLI reads `[auth.email.template.*] content_path` from disk when
// `supabase start` runs, before any web build exists, so the three templates
// the web build emits into `dist/auth-email/` (staging's, served from the app
// origin) are also committed under `supabase/templates/auth-email/`, built by
// the same pure function from the same `hr.json`. `test/auth-email.test.ts`
// fails when the committed files and the build disagree; this script rewrites
// them:
//
//   node scripts/auth-email-templates.mjs           # write
//   node scripts/auth-email-templates.mjs --check   # exit 1 when stale
//
// Node strips the builder's TypeScript types itself: run it with the repo's
// Node (`.nvmrc`, 24), not an older one.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { authEmailTemplates } from '../apps/web/src/lib/auth-email.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const LOCAL_TEMPLATE_DIRECTORY = join('supabase', 'templates', 'auth-email');

const resource = JSON.parse(readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json'), 'utf8'));
const directory = join(repoRoot, LOCAL_TEMPLATE_DIRECTORY);
const check = process.argv.includes('--check');
let stale = 0;

mkdirSync(directory, { recursive: true });
for (const { file, html } of authEmailTemplates(resource)) {
  const path = join(directory, file);
  let current;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = null;
  }
  if (current === html) continue;
  stale += 1;
  if (check) {
    console.error(`stale: ${join(LOCAL_TEMPLATE_DIRECTORY, file)}`);
  } else {
    writeFileSync(path, html);
    console.log(`wrote ${join(LOCAL_TEMPLATE_DIRECTORY, file)}`);
  }
}

if (check && stale > 0) process.exit(1);
