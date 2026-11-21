import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Session } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_NAME_MISSING,
  AFTER_NAVIGATE,
  AFTER_NOTICE,
  AFTER_SIGN_OUT,
  FALLBACK_ZONES,
  afterCreateOf,
  ALLOWANCE_INVALID,
  CREATE_UNAVAILABLE,
  LEAVE_START_DAY_OPTIONS,
  LEAVE_START_MISSING,
  LEAVE_START_MONTH_OPTIONS,
  NAME_MISSING,
  ORGANIZATION_CREATED,
  ORGANIZATION_INPUT_INVALID,
  ORGANIZATION_NOT_CREATABLE,
  ORGANIZATION_TIMEZONE_UNKNOWN,
  SLUG_INVALID,
  SLUG_UNAVAILABLE,
  TIMEZONE_UNCONFIRMED,
  TRY_LATER,
  TYPE_MISSING,
  createFailureMessageKey,
  createOrganization,
  createOutcomeOf,
  deviceZoneOf,
  organizationRefusalMessageKey,
  organizationRefusalsOf,
  organizationRequestOf,
  refreshedDestination,
  slugFits,
  slugProposalOf,
  zoneChoicesOf,
  zoneUsable,
  type CreateOrganizationClient,
  type OrganizationForm,
} from '@/features/auth/services/create-organization';

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));

const FILLED: OrganizationForm = {
  name: '  Tvrtka Primjer ',
  slug: 'tvrtka-primjer',
  organizationType: 'Udruga',
  timezone: 'Europe/Zagreb',
  leaveDay: '1',
  leaveMonth: '1',
  adminName: 'Ivana Horvat',
  allowance: '20',
};

function tokenWith(claims: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

describe('the slug (story 19.3, UX-DR66)', () => {
  it('is proposed from the typed name, Croatian letters folded, cut to 63', () => {
    expect(slugProposalOf('Tvrtka Primjer')).toBe('tvrtka-primjer');
    expect(slugProposalOf('Čakovečki Đački Šahovski Žar Ćup')).toBe('cakovecki-dacki-sahovski-zar-cup');
    expect(slugProposalOf('  --Udruga  & "Sloga" 2.0--  ')).toBe('udruga-sloga-2-0');
    expect(slugProposalOf('!!!')).toBe('');
    const long = slugProposalOf(`${'a'.repeat(62)} b`);
    expect(long).toBe('a'.repeat(62));
    expect(slugFits(long)).toBe(true);
    expect(slugProposalOf('a'.repeat(70)).length).toBe(63);
  });

  it('folds the letters NFKD leaves alone, and the digraph letters (review of 19.3)', () => {
    expect(slugProposalOf('Łódź')).toBe('lodz');
    expect(slugProposalOf('Øresund')).toBe('oresund');
    expect(slugProposalOf('Æble')).toBe('aeble');
    expect(slugProposalOf('Straße')).toBe('strasse');
    expect(slugProposalOf('Đurđevac')).toBe('durdevac');
    // U+01C4–U+01CC: DŽ, Dž, dž, LJ, Lj, lj, NJ, Nj, nj.
    expect(slugProposalOf('\u01C4ep \u01C5ep \u01C6ep')).toBe('dzep-dzep-dzep');
    expect(slugProposalOf('\u01C7ubav \u01C8ubav \u01C9ubav')).toBe('ljubav-ljubav-ljubav');
    expect(slugProposalOf('\u01CAoga \u01CBoga \u01CCoga')).toBe('njoga-njoga-njoga');
    expect(slugProposalOf('ﬁlm')).toBe('film');
  });

  it('holds 0002’s rule', () => {
    expect(slugFits('tvrtka-primjer-2')).toBe(true);
    for (const slug of ['', '-a', 'a-', 'a--b', 'Tvrtka', 'a b', 'a_b', 'a'.repeat(64)]) {
      expect(slugFits(slug), slug).toBe(false);
    }
  });
});

describe('the timezone (D11, AD-23 step 3)', () => {
  const VECTOR = JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', 'known-timezones.json'), 'utf8')) as {
    accepted: string[];
    refused: string[];
  };

  it('accepts and refuses the parity vector as private.is_known_timezone does', () => {
    expect(VECTOR.accepted.length).toBeGreaterThan(5);
    for (const zone of VECTOR.accepted) expect(zoneUsable(zone), zone).toBe(true);
    for (const zone of VECTOR.refused) expect(zoneUsable(zone), JSON.stringify(zone)).toBe(false);
  });

  it('proposes the device zone only when the database could take it', () => {
    expect(deviceZoneOf(() => 'Europe/Zagreb')).toBe('Europe/Zagreb');
    expect(deviceZoneOf(() => 'UTC')).toBeNull();
    expect(deviceZoneOf(() => undefined)).toBeNull();
    expect(
      deviceZoneOf(() => {
        throw new Error('no Intl');
      }),
    ).toBeNull();
  });

  it('offers the listed zones the shape admits, once each, sorted', () => {
    expect(zoneChoicesOf(['UTC', 'Europe/Zagreb', 'America/New_York', 'Europe/Zagreb', 'CET', 'Etc/GMT+1'])).toEqual([
      'America/New_York',
      'Europe/Zagreb',
    ]);
  });

  it('keeps the proposed zone among them, and falls back to a list when the runtime lists none (review of 19.3)', () => {
    expect(zoneChoicesOf(['America/New_York'], 'Europe/Zagreb')).toEqual(['America/New_York', 'Europe/Zagreb']);
    const fallback = zoneChoicesOf([], 'Pacific/Auckland');
    expect(fallback).toContain('Pacific/Auckland');
    for (const zone of FALLBACK_ZONES) expect(fallback).toContain(zone);
    for (const zone of FALLBACK_ZONES) expect(zoneUsable(zone), zone).toBe(true);
  });
});

describe('the leave year start', () => {
  it('offers 1–28 and twelve named months, nothing chosen', () => {
    expect(LEAVE_START_DAY_OPTIONS).toEqual(Array.from({ length: 28 }, (_, index) => index + 1));
    expect(LEAVE_START_MONTH_OPTIONS.map((month) => month.value)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(LEAVE_START_MONTH_OPTIONS[0]?.label).toBe('siječanj');
  });
});

describe('the input (D10): refused on the page, with no request', () => {
  it('refuses an empty form field by field, in its order', () => {
    expect(
      organizationRefusalsOf({
        name: ' ',
        slug: '',
        organizationType: '',
        timezone: null,
        leaveDay: '',
        leaveMonth: '',
        adminName: '',
        allowance: '',
      }),
    ).toEqual([NAME_MISSING, SLUG_INVALID, TYPE_MISSING, TIMEZONE_UNCONFIRMED, LEAVE_START_MISSING, ADMIN_NAME_MISSING, ALLOWANCE_INVALID]);
  });

  it('refuses a leave start with one half, a day past 28, and an allowance that is not a whole number in range', () => {
    expect(organizationRefusalsOf({ ...FILLED, leaveMonth: '' })).toEqual([LEAVE_START_MISSING]);
    expect(organizationRefusalsOf({ ...FILLED, leaveDay: '29' })).toEqual([LEAVE_START_MISSING]);
    for (const allowance of ['-1', '2.5', 'dvadeset', '32768']) {
      expect(organizationRefusalsOf({ ...FILLED, allowance }), allowance).toEqual([ALLOWANCE_INVALID]);
    }
    expect(organizationRefusalsOf({ ...FILLED, allowance: '0' })).toEqual([]);
    expect(organizationRefusalsOf({ ...FILLED, name: 'a'.repeat(101) })).toEqual([NAME_MISSING]);
  });

  it('sends the trimmed names and the numbers, and nothing else', () => {
    expect(organizationRequestOf(FILLED)).toEqual({
      p_name: 'Tvrtka Primjer',
      p_slug: 'tvrtka-primjer',
      p_organization_type: 'Udruga',
      p_timezone: 'Europe/Zagreb',
      p_leave_year_start_month: 1,
      p_leave_year_start_day: 1,
      p_admin_name: 'Ivana Horvat',
      p_admin_leave_allowance_days: 20,
    });
    expect(organizationRequestOf({ ...FILLED, timezone: null })).toBeNull();
  });

  it('names a message for every refusal', () => {
    for (const refusal of [NAME_MISSING, SLUG_INVALID, TYPE_MISSING, TIMEZONE_UNCONFIRMED, LEAVE_START_MISSING, ADMIN_NAME_MISSING, ALLOWANCE_INVALID] as const) {
      expect(organizationRefusalMessageKey(refusal)).toMatch(/^signup\.setup\.error\./);
    }
  });
});

describe('the answer (AD-23)', () => {
  it('reads each returned code', () => {
    expect(
      createOutcomeOf({ data: { code: ORGANIZATION_CREATED, organizationId: 'o1', slug: 'tvrtka-primjer' }, error: null }),
    ).toEqual({ code: ORGANIZATION_CREATED, organizationId: 'o1', slug: 'tvrtka-primjer' });
    expect(createOutcomeOf({ data: { code: SLUG_UNAVAILABLE, proposal: 'tvrtka-primjer-2' }, error: null })).toEqual({
      code: SLUG_UNAVAILABLE,
      proposal: 'tvrtka-primjer-2',
    });
    expect(createOutcomeOf({ data: { code: TRY_LATER }, error: null })).toEqual({ code: TRY_LATER });
    expect(createOutcomeOf({ data: { code: 'SOMETHING_ELSE' }, error: null })).toEqual({ code: CREATE_UNAVAILABLE });
    expect(createOutcomeOf({ data: null, error: null })).toEqual({ code: CREATE_UNAVAILABLE });
  });

  it('reads each raised code, and Kong’s 429 as a limit', () => {
    expect(createOutcomeOf({ data: null, error: { code: '42501', message: ORGANIZATION_NOT_CREATABLE } })).toEqual({
      code: ORGANIZATION_NOT_CREATABLE,
    });
    expect(createOutcomeOf({ data: null, error: { code: '22023', message: ORGANIZATION_TIMEZONE_UNKNOWN } })).toEqual({
      code: ORGANIZATION_TIMEZONE_UNKNOWN,
    });
    expect(
      createOutcomeOf({ data: null, error: { code: '22023', message: ORGANIZATION_INPUT_INVALID, details: 'admin_leave_allowance_days' } }),
    ).toEqual({ code: ORGANIZATION_INPUT_INVALID, refusal: ALLOWANCE_INVALID });
    expect(createOutcomeOf({ data: null, error: { code: '22023', message: ORGANIZATION_INPUT_INVALID, details: 'unknown' } })).toEqual({
      code: CREATE_UNAVAILABLE,
    });
    expect(createOutcomeOf({ data: null, error: { message: 'API rate limit exceeded' }, status: 429 })).toEqual({ code: TRY_LATER });
    expect(createOutcomeOf({ data: null, error: { code: '42501', message: 'permission denied' } })).toEqual({ code: CREATE_UNAVAILABLE });
  });

  it('calls the definer once with the request, and never with what the page refuses', async () => {
    const calls: unknown[] = [];
    const client: CreateOrganizationClient = {
      rpc: (name, args) => {
        calls.push([name, args]);
        return Promise.resolve({ data: { code: TRY_LATER }, error: null });
      },
    };

    expect(await createOrganization(client, FILLED)).toEqual({ code: TRY_LATER });
    expect(calls).toEqual([['create_organization', organizationRequestOf(FILLED)]]);
    expect(await createOrganization(client, { ...FILLED, name: '' })).toEqual({ code: CREATE_UNAVAILABLE });
    expect(calls).toHaveLength(1);
    expect(
      await createOrganization({ rpc: () => Promise.reject(new Error('offline')) }, FILLED),
    ).toEqual({ code: CREATE_UNAVAILABLE });
  });

  it('maps the form’s failures, and none for the answers that route or offer', () => {
    expect(createFailureMessageKey({ code: TRY_LATER })).toBe('signup.setup.error.tryLater');
    expect(createFailureMessageKey({ code: ORGANIZATION_TIMEZONE_UNKNOWN })).toBe('signup.setup.error.timezoneUnknown');
    expect(createFailureMessageKey({ code: CREATE_UNAVAILABLE })).toBe('signup.setup.error.unavailable');
    expect(createFailureMessageKey({ code: SLUG_UNAVAILABLE, proposal: 'a-2' })).toBeNull();
    expect(createFailureMessageKey({ code: ORGANIZATION_NOT_CREATABLE })).toBeNull();
  });
});

describe('refresh and route (AD-23 step 8, AD-24)', () => {
  const claimed = {
    access_token: tokenWith({ sub: 'f', organization_id: '00000000-0000-4000-8000-000000000001' }),
    user: { email: 'ivana.horvat@example.com' },
  } as unknown as Session;

  it('asks the destination of the refreshed session', async () => {
    expect(await refreshedDestination({ refreshSession: () => Promise.resolve({ data: { session: claimed }, error: null }) })).toBe('app');
  });

  it('retries a failed refresh once, then gives up', async () => {
    let calls = 0;
    const flaky = {
      refreshSession: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ data: { session: claimed }, error: null });
      },
    };
    expect(await refreshedDestination(flaky)).toBe('app');
    expect(calls).toBe(2);

    calls = 0;
    const down = {
      refreshSession: () => {
        calls += 1;
        return Promise.resolve({ data: { session: null }, error: new Error('refused') });
      },
    };
    expect(await refreshedDestination(down)).toBeNull();
    expect(calls).toBe(2);
  });
});

describe('after the definer answers (review of 19.3)', () => {
  it('routes a claimed session, signs out a username identity, and otherwise stays with a neutral notice', () => {
    for (const code of [ORGANIZATION_CREATED, ORGANIZATION_NOT_CREATABLE] as const) {
      expect(afterCreateOf(code, 'app')).toEqual({ kind: AFTER_NAVIGATE });
      expect(afterCreateOf(code, 'signOut')).toEqual({ kind: AFTER_SIGN_OUT });
    }
    expect(afterCreateOf(ORGANIZATION_CREATED, 'setup')).toEqual({ kind: AFTER_NOTICE, key: 'signup.setup.error.routing' });
    expect(afterCreateOf(ORGANIZATION_CREATED, null)).toEqual({ kind: AFTER_NOTICE, key: 'signup.setup.error.routing' });
    expect(afterCreateOf(ORGANIZATION_NOT_CREATABLE, 'setup')).toEqual({ kind: AFTER_NOTICE, key: 'signup.setup.error.unavailable' });
    expect(afterCreateOf(ORGANIZATION_NOT_CREATABLE, null)).toEqual({ kind: AFTER_NOTICE, key: 'signup.setup.error.unavailable' });
  });
});
