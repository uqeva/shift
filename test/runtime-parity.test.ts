import { createHash, webcrypto } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as fixtures from '../packages/domain/parity/fixtures.js';
import { runtimeParityProbe } from '../packages/domain/parity/probe.js';

/**
 * AD-19's runtime parity, the Node half (story 16.2; AD-7).
 *
 * The probe runs here over the BUILT `packages/domain/dist`, the very files
 * the pinned `edge-runtime` loads through `deploy/parity/deno.json`. With
 * `SHIFT_PARITY_OUT` set (CI's `runtime-parity` job sets it), the answer is
 * written to that file, and `scripts/ci/runtime-parity.sh` compares it byte
 * for byte with the same probe served by `edge-runtime` with no network.
 *
 * Build-gated: it needs `pnpm build` first, as CI's `test` job runs it.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');
const distEntry = `${root}packages/domain/dist/index.js`;

/** The token vector's SHA-256, computed once by an implementation other than WebCrypto's and pinned (16.3's SQL suite pins it too). */
const PARITY_VECTOR_DIGEST = '2375020bdd6e9ec86da48c727c62d31ca48a92d7ae541c1b47e8b9ec67dcc232';

async function probeOverDist(): Promise<string> {
  const domain = (await import(/* @vite-ignore */ distEntry)) as typeof import('@shift/domain');
  return runtimeParityProbe(domain, fixtures, webcrypto.subtle);
}

describe('runtime parity: the probe under Node (AD-19)', () => {
  it('has a built dist to probe', () => {
    expect(existsSync(distEntry), 'run `pnpm build` first: the probe reads packages/domain/dist').toBe(true);
  });

  it('answers the same bytes every time, and writes them where CI asks', async () => {
    const first = await probeOverDist();
    const second = await probeOverDist();

    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(10_000);

    const out = process.env['SHIFT_PARITY_OUT'];
    if (out !== undefined && out !== '') writeFileSync(out, first);
  });

  it('hashes the token vector as a second implementation does', async () => {
    const answer = JSON.parse(await probeOverDist()) as { token: { vector: string; sha256: string } };

    expect(answer.token.vector).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
    expect(createHash('sha256').update(answer.token.vector, 'utf8').digest('hex')).toBe(PARITY_VECTOR_DIGEST);
    expect(answer.token.sha256).toBe(PARITY_VECTOR_DIGEST);
  });

  it('covers both transitions of both years in Europe/Zagreb', async () => {
    const answer = JSON.parse(await probeOverDist()) as {
      zones: { zone: string; transitions: { iso: string; offsetFromMinutes: number; offsetToMinutes: number }[] }[];
    };
    const zagreb = answer.zones.find((zone) => zone.zone === 'Europe/Zagreb');

    expect(zagreb?.transitions.map((transition) => [transition.iso, transition.offsetFromMinutes, transition.offsetToMinutes])).toEqual([
      ['2026-03-29T01:00:00Z', 60, 120],
      ['2026-10-25T01:00:00Z', 120, 60],
      ['2027-03-28T01:00:00Z', 60, 120],
      ['2027-10-31T01:00:00Z', 120, 60],
    ]);
  });

  it('covers every reminder lead on both transition dates of both years, and the reminders due around them (story 17.2)', async () => {
    interface Due {
      readonly lead: string;
      readonly iso: string;
    }
    const answer = JSON.parse(await probeOverDist()) as {
      reminders: {
        dueAt: { zone: string; dates: { date: string; minutes: { minute: number; leads: Due[] }[] }[] }[];
        due: { fixture: string; clocks: { iso: string; members: { memberId: string; reminders: Record<string, unknown>[] }[] }[] }[];
      };
    };
    const zagreb = answer.reminders.dueAt.find((zone) => zone.zone === 'Europe/Zagreb');
    const leadsOn = (date: string, minute: number): Record<string, string> =>
      Object.fromEntries(
        (zagreb?.dates.find((one) => one.date === date)?.minutes.find((one) => one.minute === minute)?.leads ?? []).map(
          (due) => [due.lead, due.iso],
        ),
      );

    expect(zagreb?.dates.map((one) => one.date)).toEqual(['2026-03-29', '2026-10-25', '2027-03-28', '2027-10-31']);
    // Real hours before 07:00 across the gap and the overlap; 20:00 local the day before.
    expect(leadsOn('2026-03-29', 420)).toEqual({
      H1: '2026-03-29T04:00:00Z',
      H2: '2026-03-29T03:00:00Z',
      H3: '2026-03-29T02:00:00Z',
      H6: '2026-03-28T23:00:00Z',
      H12: '2026-03-28T17:00:00Z',
      EVENING_BEFORE: '2026-03-28T19:00:00Z',
    });
    expect(leadsOn('2026-10-25', 420)).toMatchObject({ H3: '2026-10-25T03:00:00Z', H6: '2026-10-25T00:00:00Z' });
    expect(leadsOn('2027-03-28', 420)).toMatchObject({ H6: '2027-03-27T23:00:00Z', EVENING_BEFORE: '2027-03-27T19:00:00Z' });
    expect(leadsOn('2027-10-31', 1500)).toMatchObject({ H1: '2027-10-31T23:00:00Z', EVENING_BEFORE: '2027-10-30T18:00:00Z' });

    const pilot = answer.reminders.due.find((one) => one.fixture === 'pilot');
    const spring = pilot?.clocks.find((clock) => clock.iso === '2026-03-29T02:00:00Z');
    expect(spring?.members.find((member) => member.memberId === 'pilot-m5')?.reminders).toEqual([
      {
        memberId: 'pilot-m5',
        date: '2026-03-29',
        teamId: 'pilot-smjena-a',
        shiftTypeId: 'pilot-dan',
        lead: 'H3',
        start: 420,
        end: 1140,
        startsAt: '2026-03-29T05:00:00Z',
      },
    ]);
    const autumn = pilot?.clocks.find((clock) => clock.iso === '2027-10-31T00:00:00Z');
    // A worked second half, from 13:00: twelve real hours before it.
    expect(autumn?.members.find((member) => member.memberId === 'pilot-m1')?.reminders).toMatchObject([
      { date: '2027-10-31', lead: 'H12', start: 780, startsAt: '2027-10-31T12:00:00Z' },
    ]);
  });
});

describe('runtime parity: the Deno half is the one a function would run (AD-7)', () => {
  it('maps @shift/domain onto the built dist by relative path, and nothing else', () => {
    const map = JSON.parse(read('deploy/parity/deno.json')) as Record<string, unknown>;

    expect(map).toEqual({ imports: { '@shift/domain': '../../packages/domain/dist/index.js' } });
  });

  it('imports the domain by its bare specifier and the probe and fixture by path, and nothing remote', () => {
    const entry = read('deploy/parity/index.ts');
    const specifiers = [...entry.matchAll(/^import\s[^'"]*from\s*'([^']+)'/gm)].map((match) => match[1]);

    expect(specifiers.sort()).toEqual(
      ['../../packages/domain/parity/fixtures.ts', '../../packages/domain/parity/probe.ts', '@shift/domain'].sort(),
    );
  });

  it('imports nothing at run time from the probe or the fixture', () => {
    for (const path of ['packages/domain/parity/probe.ts', 'packages/domain/parity/fixtures.ts']) {
      const runtimeImports = read(path)
        .split('\n')
        .filter((line) => /^\s*(import|export)\b[^;]*\bfrom\s*['"]/.test(line) && !/^\s*import\s+type\b/.test(line));

      expect(runtimeImports, path).toEqual([]);
    }
  });

  it('runs under the same edge-runtime pin the functions image is built on', () => {
    const base = /^FROM\s+(\S+)\s*$/m.exec(read('deploy/functions/Dockerfile'))?.[1];
    const pipeline = read('.github/workflows/pipeline.yml');
    const job = /\n {2}runtime-parity:\n([\s\S]*?)(?=\n {2}[a-z][a-z-]*:\n)/.exec(pipeline)?.[1] ?? '';
    const pins = [...job.matchAll(/EDGE_RUNTIME_IMAGE:\s*(\S+)/g)].map((match) => match[1]);

    expect(base).toBe('supabase/edge-runtime:v1.74.3');
    expect(pins).toEqual([base]);
    expect(job).toContain('scripts/ci/runtime-parity.sh');
    expect(job).toContain('SHIFT_PARITY_OUT');
  });

  it('gates CI on the runtime-parity job', () => {
    const pipeline = read('.github/workflows/pipeline.yml');
    const needs = /\n {2}ci-passed:[\s\S]*?needs:\s*\[([^\]]*)\]/.exec(pipeline)?.[1] ?? '';

    expect(needs.split(',').map((need) => need.trim())).toContain('runtime-parity');
  });
});
